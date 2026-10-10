/*
 * Linux terminal page. Drives the native LinuxShell plugin (android/.../LinuxShellPlugin.java):
 * install the Alpine root filesystem if needed, then run a shell on a pseudo-terminal.
 * Output and input cross the bridge as base64, so multi-byte UTF-8 stays intact.
 */
(function () {
    'use strict';

    const cap = window.Capacitor;
    const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
    const LS = isNative && cap.Plugins ? cap.Plugins.LinuxShell : null;

    const $ = (id) => document.getElementById(id);
    const el = {
        state: $('state'), setup: $('setup'), installBtn: $('installBtn'), barWrap: $('barWrap'),
        bar: $('bar'), stage: $('stage'), error: $('error'), termWrap: $('term-wrap'), keys: $('keys'),
        ctrlBtn: $('ctrlBtn'), restartBtn: $('restartBtn'), stopBtn: $('stopBtn'), unsupported: $('unsupported'),
        projectsBtn: $('projectsBtn'), projects: $('projects'), ghToken: $('ghToken'), saveTokenBtn: $('saveTokenBtn'),
        loadReposBtn: $('loadReposBtn'), cloneName: $('cloneName'), cloneBtn: $('cloneBtn'),
        repoFilter: $('repoFilter'), repoList: $('repoList'), projectList: $('projectList'),
        projStatus: $('projStatus'), closeProjectsBtn: $('closeProjectsBtn'), wsLink: $('wsLink'),
    };

    const enc = new TextEncoder();
    let running = false;
    let ctrlArmed = false;

    // ---- terminal -----------------------------------------------------------------

    const term = new Terminal({
        fontFamily: '"Geist Mono", ui-monospace, Menlo, monospace',
        fontSize: 13,
        cursorBlink: true,
        scrollback: 5000,
        theme: {
            background: '#0B0C10', foreground: '#EDEFF4', cursor: '#F5BD5C',
            selectionBackground: '#2E3546',
        },
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(el.termWrap);

    function bytesToB64(bytes) {
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
            s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return btoa(s);
    }

    function b64ToBytes(b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function send(text) {
        if (!running || !LS) return;
        LS.write({ data: bytesToB64(enc.encode(text)) }).catch(() => {});
    }

    function setCtrl(on) {
        ctrlArmed = on;
        el.ctrlBtn.classList.toggle('on', on);
    }

    term.onData((data) => {
        if (ctrlArmed && data.length === 1) {
            const code = data.toUpperCase().charCodeAt(0);
            // Ctrl+@ .. Ctrl+_ map to control characters 0x00..0x1f
            send(code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : data);
            setCtrl(false);
            return;
        }
        send(data);
    });

    term.onResize(({ cols, rows }) => {
        if (running && LS) LS.resize({ cols, rows }).catch(() => {});
    });

    const KEYS = {
        esc: '\x1b', tab: '\t', left: '\x1b[D', right: '\x1b[C', up: '\x1b[A', down: '\x1b[B',
        pipe: '|', tilde: '~', slash: '/', dash: '-',
    };
    el.keys.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-key]');
        if (!btn) return;
        const key = btn.dataset.key;
        if (key === 'ctrl') {
            setCtrl(!ctrlArmed);
            term.focus();
            return;
        }
        send(KEYS[key] || '');
        term.focus();
    });

    // ---- layout -------------------------------------------------------------------

    function refit() {
        try {
            fit.fit();
        } catch (_) {
            // The element may be hidden during layout; the next resize will fit it.
        }
    }
    window.addEventListener('resize', refit);
    if (window.ResizeObserver) new ResizeObserver(refit).observe(el.termWrap);

    function showTerminal(on) {
        el.termWrap.classList.toggle('hidden', !on);
        el.keys.classList.toggle('hidden', !on);
        el.setup.classList.toggle('hidden', on);
        el.projects.classList.toggle('hidden', on);
        if (on) {
            refit();
            term.focus();
        }
    }

    function setState(text, kind) {
        el.state.textContent = text;
        el.state.className = 'pill' + (kind ? ' ' + kind : '');
    }

    const STAGES = {
        checksum: 'Fetching checksum',
        download: 'Downloading root filesystem',
        verify: 'Verifying',
        extract: 'Extracting (this takes a minute)',
        done: 'Done',
    };

    function showInstallError(message) {
        el.error.textContent = message;
        el.installBtn.disabled = false;
    }

    // ---- plugin wiring --------------------------------------------------------------

    async function startSession(cwd) {
        refit();
        try {
            await LS.start({ cols: term.cols, rows: term.rows, cwd: typeof cwd === 'string' ? cwd : undefined });
            running = true;
            setState('running', 'ok');
            el.restartBtn.hidden = true;
            el.stopBtn.hidden = false;
            showTerminal(true);
        } catch (e) {
            setState('not started', 'warn');
            showInstallError('Could not start the shell: ' + (e.message || e));
            el.setup.classList.remove('hidden');
        }
    }

    async function install() {
        el.error.textContent = '';
        el.installBtn.disabled = true;
        el.barWrap.hidden = false;
        try {
            await LS.install();
            el.stage.textContent = '';
            el.barWrap.hidden = true;
            await startSession();
        } catch (e) {
            el.barWrap.hidden = true;
            el.stage.textContent = '';
            showInstallError(e.message || String(e));
            setState('not installed', 'warn');
        }
    }

    function attachNative() {
        LS.addListener('data', (ev) => {
            term.write(b64ToBytes(ev.data));
        });
        LS.addListener('exit', (ev) => {
            running = false;
            setCtrl(false);
            term.write('\r\n\x1b[90m[shell exited with status ' + ev.code + ']\x1b[0m\r\n');
            setState('stopped');
            el.stopBtn.hidden = true;
            el.restartBtn.hidden = false;
        });
        LS.addListener('install', (ev) => {
            el.stage.textContent = STAGES[ev.stage] || ev.stage;
            el.bar.style.width = (ev.percent || 0) + '%';
        });
    }

    el.installBtn.addEventListener('click', install);
    el.restartBtn.addEventListener('click', () => startSession());
    el.stopBtn.addEventListener('click', async () => {
        if (LS) await LS.stop().catch(() => {});
    });

    // ---- projects (GitHub import) ---------------------------------------------------

    let repoCache = [];

    function setProjStatus(text) {
        el.projStatus.textContent = text;
    }

    function showProjects() {
        el.termWrap.classList.add('hidden');
        el.keys.classList.add('hidden');
        el.setup.classList.add('hidden');
        el.projects.classList.remove('hidden');
    }

    function item(title, detail, buttonLabel, onClick) {
        const row = document.createElement('div');
        row.className = 'item';
        const text = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = title;
        text.appendChild(strong);
        if (detail) {
            const small = document.createElement('small');
            small.textContent = detail;
            text.appendChild(small);
        }
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = buttonLabel;
        btn.addEventListener('click', onClick);
        row.append(text, btn);
        return row;
    }

    async function refreshProjects() {
        el.projectList.textContent = '';
        try {
            const names = await GitHubImport.listProjects(LS);
            if (!names.length) {
                el.projectList.textContent = 'No projects yet. Clone a repository above.';
                return;
            }
            for (const name of names) {
                const dir = GitHubImport.PROJECTS_DIR + '/' + name;
                el.projectList.appendChild(item(name, dir, 'Open shell', () => startSession(dir)));
            }
        } catch (e) {
            el.projectList.textContent = e.message || String(e);
        }
    }

    function renderRepos() {
        const q = el.repoFilter.value.trim().toLowerCase();
        el.repoList.textContent = '';
        const shown = repoCache.filter((r) => !q || r.fullName.toLowerCase().includes(q));
        if (!shown.length) {
            el.repoList.textContent = repoCache.length ? 'No repositories match.' : 'Load your repositories to see them here.';
            return;
        }
        for (const r of shown) {
            const detail = (r.private ? 'private' : 'public') + (r.description ? ' · ' + r.description : '');
            el.repoList.appendChild(item(r.fullName, detail, 'Clone', () => cloneFrom(r.fullName)));
        }
    }

    async function cloneFrom(fullName) {
        setProjStatus('Starting…');
        try {
            const token = await GitHubImport.loadToken();
            const dir = await GitHubImport.cloneRepo(LS, fullName, token, (stage) => setProjStatus(stage + '…'));
            setProjStatus('Ready: ' + dir);
            await refreshProjects();
        } catch (e) {
            setProjStatus(e.message || String(e));
        }
    }

    function wireProjects() {
        el.projectsBtn.hidden = false;
        el.wsLink.hidden = false;
        el.projectsBtn.addEventListener('click', async () => {
            showProjects();
            setProjStatus('');
            el.ghToken.value = '';
            el.ghToken.placeholder = (await GitHubImport.hasToken()) ? 'Token saved (enter a new one to replace)' : 'GitHub token (optional)';
            await refreshProjects();
        });
        el.closeProjectsBtn.addEventListener('click', () => showTerminal(!!running));
        el.saveTokenBtn.addEventListener('click', async () => {
            try {
                await GitHubImport.saveToken(el.ghToken.value);
                el.ghToken.value = '';
                el.ghToken.placeholder = (await GitHubImport.hasToken()) ? 'Token saved (enter a new one to replace)' : 'GitHub token (optional)';
                setProjStatus('Token saved.');
            } catch (e) {
                setProjStatus(e.message || String(e));
            }
        });
        el.loadReposBtn.addEventListener('click', async () => {
            setProjStatus('Loading repositories…');
            try {
                repoCache = await GitHubImport.listRepos(await GitHubImport.loadToken());
                renderRepos();
                setProjStatus(repoCache.length + ' repositories.');
            } catch (e) {
                setProjStatus(e.message || String(e));
            }
        });
        el.repoFilter.addEventListener('input', renderRepos);
        el.cloneBtn.addEventListener('click', () => {
            const name = el.cloneName.value.trim();
            if (!GitHubImport.isValidName(name)) {
                setProjStatus('Enter the repository as owner/name.');
                return;
            }
            cloneFrom(name);
        });
    }

    /** Working directory from ?cwd=, accepted only under /root/projects. */
    function initialCwd() {
        const c = new URLSearchParams(location.search).get('cwd');
        if (!c || c.indexOf('\0') !== -1 || c.split('/').indexOf('..') !== -1) return undefined;
        return c === '/root/projects' || c.indexOf('/root/projects/') === 0 ? c : undefined;
    }

    async function init() {
        if (!LS) {
            el.unsupported.hidden = false;
            setState('android only', 'warn');
            return;
        }
        attachNative();
        wireProjects();
        try {
            const { installed } = await LS.status();
            if (installed) {
                setState('ready');
                await startSession(initialCwd());
            } else {
                setState('not installed', 'warn');
                el.setup.classList.remove('hidden');
            }
        } catch (e) {
            setState('error', 'warn');
            showInstallError(e.message || String(e));
            el.setup.classList.remove('hidden');
        }
    }

    init();
})();
