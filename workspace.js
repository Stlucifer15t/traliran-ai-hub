/*
 * Workspace page: browse the project files and read git state inside the Linux
 * root filesystem. Everything goes through LinuxShell.run; no writes happen here.
 *
 * Paths are checked to stay under /root/projects, and every value placed into a
 * shell command is single-quoted.
 */
(function () {
    'use strict';

    const cap = window.Capacitor;
    const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
    const LS = isNative && cap.Plugins ? cap.Plugins.LinuxShell : null;
    const ROOT = '/root/projects';
    const VIEW_LIMIT = 200000;
    const DIFF_LIMIT = 150000;

    const $ = (id) => document.getElementById(id);
    const el = {
        project: $('project'), openTerm: $('openTerm'), tabFiles: $('tabFiles'), tabGit: $('tabGit'),
        unsupported: $('unsupported'), empty: $('empty'), filesPanel: $('filesPanel'), gitPanel: $('gitPanel'),
        upBtn: $('upBtn'), refreshFiles: $('refreshFiles'), crumbs: $('crumbs'), entries: $('entries'),
        viewer: $('viewer'), viewerNote: $('viewerNote'), refreshGit: $('refreshGit'), gitBranch: $('gitBranch'),
        gitBody: $('gitBody'),
    };

    let project = null;   // absolute path of the selected project
    let current = null;   // directory being listed

    /** Single-quotes a value for sh. */
    function q(value) {
        return "'" + String(value).replace(/'/g, "'\\''") + "'";
    }

    function clean(text) {
        return String(text || '').replace(/\r\n?/g, '\n');
    }

    /** True for paths at or below the projects root with no parent references. */
    function inside(path) {
        if (typeof path !== 'string' || path.indexOf('\0') !== -1) return false;
        if (path.split('/').indexOf('..') !== -1) return false;
        return path === ROOT || path.indexOf(ROOT + '/') === 0;
    }

    async function run(command, timeoutSec) {
        return LS.run({ command, cwd: project || ROOT, timeoutSec: timeoutSec || 60 });
    }

    // ---- tabs and project picker ------------------------------------------------------

    function showTab(name) {
        const files = name === 'files';
        el.tabFiles.classList.toggle('on', files);
        el.tabGit.classList.toggle('on', !files);
        el.filesPanel.classList.toggle('hidden', !files);
        el.gitPanel.classList.toggle('hidden', files);
        if (!files) loadGit();
    }

    async function loadProjects(selectName) {
        const names = await GitHubImport.listProjects(LS);
        el.project.textContent = '';
        for (const name of names) {
            const opt = document.createElement('option');
            opt.value = ROOT + '/' + name;
            opt.textContent = name;
            el.project.appendChild(opt);
        }
        const hasAny = names.length > 0;
        el.empty.classList.toggle('hidden', hasAny);
        el.project.disabled = !hasAny;
        if (!hasAny) return false;
        const wanted = selectName && inside(selectName) ? selectName : el.project.options[0].value;
        el.project.value = wanted;
        project = wanted;
        el.openTerm.href = 'terminal.html?cwd=' + encodeURIComponent(project);
        return true;
    }

    // ---- files ----------------------------------------------------------------------------

    function renderCrumbs() {
        el.crumbs.textContent = '';
        const rel = current.slice(ROOT.length).split('/').filter(Boolean);
        const parts = [{ label: 'projects', path: ROOT }];
        let acc = ROOT;
        for (const seg of rel) {
            acc += '/' + seg;
            parts.push({ label: seg, path: acc });
        }
        parts.forEach((p, i) => {
            if (i > 0) el.crumbs.appendChild(document.createTextNode(' / '));
            const b = document.createElement('button');
            b.textContent = p.label;
            b.addEventListener('click', () => loadDir(p.path));
            el.crumbs.appendChild(b);
        });
    }

    function entry(name, isDir, onClick) {
        const b = document.createElement('button');
        b.className = 'entry' + (isDir ? ' dir' : '');
        const kind = document.createElement('span');
        kind.className = 'kind';
        kind.textContent = isDir ? 'dir' : 'file';
        const label = document.createElement('span');
        label.textContent = name + (isDir ? '/' : '');
        b.append(kind, label);
        b.addEventListener('click', onClick);
        return b;
    }

    async function loadDir(dir) {
        if (!inside(dir)) return;
        current = dir;
        el.viewer.classList.add('hidden');
        el.viewerNote.textContent = '';
        renderCrumbs();
        el.upBtn.disabled = dir === project;
        el.entries.textContent = '';
        const res = await run('ls -1Ap -- ' + q(dir));
        if (res.code !== 0) {
            el.entries.textContent = '';
            el.viewerNote.textContent = clean(res.output).trim() || 'Could not list this folder.';
            return;
        }
        const names = clean(res.output).split('\n').filter(Boolean);
        const dirs = names.filter((n) => n.endsWith('/')).map((n) => n.slice(0, -1));
        const files = names.filter((n) => !n.endsWith('/'));
        if (!names.length) {
            el.viewerNote.textContent = 'Empty folder.';
            return;
        }
        for (const d of dirs) {
            el.entries.appendChild(entry(d, true, () => loadDir(dir + '/' + d)));
        }
        for (const f of files) {
            el.entries.appendChild(entry(f, false, () => openFile(dir + '/' + f)));
        }
    }

    async function openFile(path) {
        if (!inside(path)) return;
        el.viewerNote.textContent = 'Opening ' + path.slice(ROOT.length + 1) + '…';
        const p = q(path);
        const res = await run(
            'if grep -Iq . -- ' + p + ' || [ ! -s ' + p + ' ]; then head -c ' + VIEW_LIMIT + ' -- ' + p
            + '; else echo "[binary file, not shown]"; fi',
            60
        );
        el.viewer.textContent = clean(res.output);
        el.viewer.classList.remove('hidden');
        const truncated = res.output.length >= VIEW_LIMIT;
        el.viewerNote.textContent = (res.code === 0 ? '' : 'Could not read the file. ')
            + (truncated ? 'Showing the first part of the file.' : '');
    }

    el.upBtn.addEventListener('click', () => {
        if (!current || current === project) return;
        const parent = current.slice(0, current.lastIndexOf('/'));
        loadDir(inside(parent) ? parent : project);
    });
    el.refreshFiles.addEventListener('click', () => loadDir(current || project));

    // ---- git ---------------------------------------------------------------------------

    /** Splits the sectioned output of the git script into { NAME: text }. */
    function sections(text) {
        const out = {};
        let name = null;
        for (const line of clean(text).split('\n')) {
            const m = /^=== (\w+)$/.exec(line);
            if (m) {
                name = m[1];
                out[name] = '';
            } else if (name) {
                out[name] += line + '\n';
            }
        }
        return out;
    }

    function block(title, body) {
        const h = document.createElement('h3');
        h.textContent = title;
        const pre = document.createElement('pre');
        pre.textContent = body && body.trim() ? body.replace(/\n+$/, '') : '(none)';
        el.gitBody.append(h, pre);
    }

    async function loadGit() {
        el.gitBody.textContent = '';
        el.gitBranch.textContent = '';
        if (!project) {
            el.gitBody.textContent = 'Pick a project.';
            return;
        }
        const script = [
            'command -v git >/dev/null 2>&1 || { echo "=== NO_GIT"; exit 0; }',
            'cd ' + q(project) + ' || exit 1',
            'git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "=== NOT_A_REPO"; exit 0; }',
            'echo "=== BRANCH"; git -c color.ui=never branch --show-current 2>&1',
            'echo "=== STATUS"; git -c color.ui=never status --short --branch 2>&1',
            'echo "=== LOG"; git -c color.ui=never log --oneline --decorate -n 20 2>&1',
            'echo "=== DIFF_STAT"; git -c color.ui=never diff --stat 2>&1',
            'echo "=== DIFF"; git -c color.ui=never diff --no-ext-diff 2>&1 | head -c ' + DIFF_LIMIT,
        ].join('; ');
        const res = await run(script, 120);
        const s = sections(res.output);
        if (s.NO_GIT !== undefined) {
            el.gitBody.textContent = 'git is not installed yet. Clone a repository from the Terminal page (Projects) to install it.';
            return;
        }
        if (s.NOT_A_REPO !== undefined) {
            el.gitBody.textContent = 'This folder is not a git repository.';
            return;
        }
        if (res.code !== 0 && !s.STATUS) {
            el.gitBody.textContent = clean(res.output) || 'Could not read git state.';
            return;
        }
        el.gitBranch.textContent = (s.BRANCH || '').trim() ? 'branch ' + s.BRANCH.trim() : '';
        block('Status', s.STATUS);
        block('Recent commits', s.LOG);
        block('Changes (stat)', s.DIFF_STAT);
        block('Diff', s.DIFF);
    }

    el.refreshGit.addEventListener('click', loadGit);
    el.tabFiles.addEventListener('click', () => showTab('files'));
    el.tabGit.addEventListener('click', () => showTab('git'));
    el.project.addEventListener('change', async () => {
        project = el.project.value;
        el.openTerm.href = 'terminal.html?cwd=' + encodeURIComponent(project);
        await loadDir(project);
        if (!el.gitPanel.classList.contains('hidden')) loadGit();
    });

    async function init() {
        if (!LS) {
            el.unsupported.classList.remove('hidden');
            el.project.disabled = true;
            return;
        }
        try {
            const { installed } = await LS.status();
            if (!installed) {
                el.empty.textContent = 'Linux is not installed yet. Install it from the Terminal page.';
                el.empty.classList.remove('hidden');
                return;
            }
            const preset = new URLSearchParams(location.search).get('project');
            const ok = await loadProjects(preset);
            if (ok) await loadDir(project);
        } catch (e) {
            el.empty.textContent = e.message || String(e);
            el.empty.classList.remove('hidden');
        }
    }

    init();
})();
