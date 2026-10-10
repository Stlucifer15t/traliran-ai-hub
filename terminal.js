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

    async function startSession() {
        refit();
        try {
            await LS.start({ cols: term.cols, rows: term.rows });
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
    el.restartBtn.addEventListener('click', startSession);
    el.stopBtn.addEventListener('click', async () => {
        if (LS) await LS.stop().catch(() => {});
    });

    async function init() {
        if (!LS) {
            el.unsupported.hidden = false;
            setState('android only', 'warn');
            return;
        }
        attachNative();
        try {
            const { installed } = await LS.status();
            if (installed) {
                setState('ready');
                await startSession();
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
