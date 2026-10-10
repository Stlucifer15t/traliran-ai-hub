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
            background: '#07111F', foreground: '#F8FAFC', cursor: '#4ADE80',
            selectionBackground: '#2A3D57',
        },
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(el.termWrap);

    const imgEls = {
        imagesBtn: $('imagesBtn'), images: $('images'), imgList: $('imgList'),
        imgStatus: $('imgStatus'), closeImagesBtn: $('closeImagesBtn'),
    };
    let imageBusy = false;

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
        el.projects.classList.add('hidden');
        imgEls.images.classList.add('hidden');
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
            await LS.install(LinuxImages.installArgs(LinuxImages.find('builtin')));
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
            if (imageBusy) imgEls.imgStatus.textContent = (STAGES[ev.stage] || ev.stage) + ' ' + (ev.percent || 0) + '%';
        });
    }

    el.installBtn.addEventListener('click', () => install());
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

    // ---- container and images ----------------------------------------------------------

    function imgRow(title, detail, pills, actions) {
        const row = document.createElement('div');
        row.className = 'item';
        const text = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = title;
        for (const p of pills) {
            const span = document.createElement('span');
            span.className = 'pill ' + p.kind;
            span.textContent = p.text;
            strong.append(' ', span);
        }
        text.appendChild(strong);
        const small = document.createElement('small');
        small.textContent = detail;
        small.style.whiteSpace = 'normal';
        text.appendChild(small);
        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.gap = '.4rem';
        right.style.flexShrink = '0';
        for (const a of actions) right.appendChild(a);
        row.append(text, right);
        return row;
    }

    function imgButton(label, onClick, disabled, primary) {
        const b = document.createElement('button');
        b.className = 'btn' + (primary ? ' btn-primary' : '');
        b.textContent = label;
        b.disabled = !!disabled;
        b.addEventListener('click', onClick);
        return b;
    }

    function setImgStatus(text) {
        imgEls.imgStatus.textContent = text;
    }

    async function refreshImages() {
        let state;
        try {
            state = await LS.images();
        } catch (e) {
            setImgStatus(e.message || String(e));
            return;
        }
        const installed = new Set(state.installed || []);
        const active = state.active || 'builtin';
        imgEls.imgList.innerHTML = '';

        const head1 = document.createElement('small');
        head1.textContent = 'Installed';
        head1.style.display = 'block';
        head1.style.padding = '.5rem .7rem 0';
        imgEls.imgList.appendChild(head1);
        for (const img of LinuxImages.CATALOG.filter(i => installed.has(i.id))) {
            const isActive = img.id === active;
            const pills = [];
            if (img.builtin) pills.push({ text: 'Built-in', kind: '' });
            if (isActive) pills.push({ text: 'Active', kind: 'ok' });
            const actions = [];
            if (!isActive) actions.push(imgButton('Use', () => useImage(img), imageBusy, true));
            if (!isActive && !img.builtin) actions.push(imgButton('Delete', () => deleteImage(img), imageBusy));
            imgEls.imgList.appendChild(imgRow(img.name + ' ' + img.version, img.description, pills, actions));
        }

        const head2 = document.createElement('small');
        head2.textContent = 'Download';
        head2.style.display = 'block';
        head2.style.padding = '.5rem .7rem 0';
        imgEls.imgList.appendChild(head2);
        for (const img of LinuxImages.CATALOG.filter(i => !installed.has(i.id))) {
            const pills = [];
            if (!img.supported) pills.push({ text: 'Not yet', kind: 'warn' });
            const detail = img.description + ' About ' + img.sizeMB + ' MB.' + (img.supported ? '' : ' ' + img.unsupportedReason);
            const actions = [imgButton('Download', () => downloadImage(img), imageBusy || !img.supported, true)];
            imgEls.imgList.appendChild(imgRow(img.name + ' ' + img.version, detail, pills, actions));
        }
    }

    async function downloadImage(img) {
        imageBusy = true;
        setImgStatus('Downloading ' + img.name + ' ' + img.version + '…');
        refreshImages();
        try {
            await LS.install(LinuxImages.installArgs(img));
            setImgStatus(img.name + ' ' + img.version + ' is downloaded. Tap Use to switch to it.');
        } catch (e) {
            setImgStatus('Download failed: ' + (e.message || String(e)));
        } finally {
            imageBusy = false;
            refreshImages();
        }
    }

    async function useImage(img) {
        imageBusy = true;
        refreshImages();
        try {
            if (running) await LS.stop().catch(() => {});
            running = false;
            await LS.setActive({ id: img.id });
            setImgStatus('Using ' + img.name + ' ' + img.version + '. Starting the shell…');
            imageBusy = false;
            await startSession();
        } catch (e) {
            setImgStatus('Could not switch: ' + (e.message || String(e)));
        } finally {
            imageBusy = false;
        }
    }

    async function deleteImage(img) {
        if (!window.confirm('Delete ' + img.name + ' ' + img.version + '? Its files are removed from the device.')) return;
        try {
            await LS.deleteImage({ id: img.id });
            setImgStatus('Deleted ' + img.name + ' ' + img.version + '.');
        } catch (e) {
            setImgStatus(e.message || String(e));
        }
        refreshImages();
    }

    function showImages() {
        el.termWrap.classList.add('hidden');
        el.keys.classList.add('hidden');
        el.setup.classList.add('hidden');
        el.projects.classList.add('hidden');
        imgEls.images.classList.remove('hidden');
        setImgStatus('');
        refreshImages();
    }

    function wireImages() {
        imgEls.imagesBtn.hidden = false;
        imgEls.imagesBtn.addEventListener('click', showImages);
        imgEls.closeImagesBtn.addEventListener('click', () => showTerminal(!!running));
    }

    function wireProjects() {
        el.projectsBtn.hidden = false;
        wireImages();
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
