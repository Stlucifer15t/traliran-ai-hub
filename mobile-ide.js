/*
 * mobile-ide.js - phone and tablet layout for the IDE.
 *  - One pane at a time: Chat, Files, Code, Preview (bottom tabs).
 *  - Swipe left or right to move between panes.
 *  - Lazy-loads the CodeMirror bundle and uses it instead of Monaco.
 *  - Hardware back button goes to the Chat pane first (see native-shell.js).
 * On desktop every function here is a no-op, so the desktop layout is unchanged.
 */
(function (g) {
    'use strict';

    const TABS = ['chat', 'files', 'code', 'preview'];
    const SWIPE_MIN_PX = 60;
    const SWIPE_MAX_VERTICAL_PX = 40;
    const NO_SWIPE_TARGETS = '.cm-editor, #monacoContainer, #openFilesTabs, #consoleList, input, textarea, pre, .ai-diff';

    let on = false;
    let current = 'chat';
    let cmLoading = null;

    function isOn() { return on; }

    function loadEditor() {
        if (g.CM) return Promise.resolve();
        if (cmLoading) return cmLoading;
        cmLoading = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'vendor/codemirror.bundle.js';
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('CodeMirror bundle failed to load'));
            document.head.appendChild(s);
        });
        return cmLoading;
    }

    function show(tab) {
        if (!on || !TABS.includes(tab)) return;
        current = tab;
        const main = document.getElementById('ideMain');
        main.dataset.mtab = tab;
        document.querySelectorAll('[data-mtab-btn]').forEach(b => {
            const active = b.dataset.mtabBtn === tab;
            b.setAttribute('aria-selected', String(active));
            b.classList.toggle('mtab-active', active);
        });
        if (tab === 'code' && g.MobileEditor && g.MobileEditor.active) {
            requestAnimationFrame(() => g.MobileEditor.facade.layout());
        }
        if (tab === 'preview' && g.PREVIEW) {
            g.PREVIEW.isVisible = true;
            const panel = document.getElementById('previewPanel');
            if (panel) panel.classList.remove('hidden');
            g.PREVIEW.render();
        }
    }

    function onFileOpened() {
        if (on) show('code');
    }

    function swipeTarget(target) {
        return target && target.closest && target.closest(NO_SWIPE_TARGETS);
    }

    function bindSwipe() {
        const main = document.getElementById('ideMain');
        let x0 = 0, y0 = 0, t0 = 0, active = false;
        main.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1 || swipeTarget(e.target)) { active = false; return; }
            x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); active = true;
        }, { passive: true });
        main.addEventListener('touchend', (e) => {
            if (!active) return;
            active = false;
            const t = e.changedTouches[0];
            const dx = t.clientX - x0, dy = t.clientY - y0;
            if (Date.now() - t0 > 800) return;
            if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dy) > SWIPE_MAX_VERTICAL_PX) return;
            const i = TABS.indexOf(current);
            const next = dx < 0 ? Math.min(TABS.length - 1, i + 1) : Math.max(0, i - 1);
            if (next !== i) show(TABS[next]);
        }, { passive: true });
    }

    function renderSymbolBar() {
        const host = document.getElementById('mobileSymbolBar');
        if (host && g.MobileEditor) g.MobileEditor.renderSymbolBar(host);
    }

    /** Called by MONACO.init() on phones instead of loading Monaco. */
    async function mountEditor() {
        await loadEditor();
        document.getElementById('monacoContainer').classList.add('hidden');
        const cm = document.getElementById('cmContainer');
        cm.classList.remove('hidden');
        const facade = g.MobileEditor.init(cm);
        renderSymbolBar();
        return facade;
    }

    function init() {
        const P = g.HubPlatform;
        if (!P || !P.isMobile) return;
        on = true;
        document.body.classList.add('mobile-ide');
        const nav = document.getElementById('mobileTabs');
        if (nav) nav.classList.remove('hidden');
        document.querySelectorAll('[data-mtab-btn]').forEach(b => {
            b.addEventListener('click', () => show(b.dataset.mtabBtn));
        });
        bindSwipe();
        if (g.HubBack) {
            g.HubBack.push(() => {
                if (current !== 'chat') { show('chat'); return true; }
                return false;
            });
        }
        show('chat');
    }

    g.MobileIDE = { init, show, isOn, loadEditor, mountEditor, renderSymbolBar, onFileOpened };
})(typeof window !== 'undefined' ? window : globalThis);
