/*
 * native-shell.js - Android shell behaviour (Capacitor only, no-op on the web).
 *  - Hardware back button: closes the topmost layer first (registered
 *    handlers, then open overlays), then goes "back" in the IDE's mobile tabs,
 *    and only exits the app on a second press.
 *  - Hides the splash screen once the first page is ready.
 */
(function () {
    'use strict';
    const P = window.HubPlatform;
    if (!P || !P.isNative) return;

    const App = P.plugin('App');
    const SplashScreen = P.plugin('SplashScreen');
    const stack = [];   // handlers: return true when they consumed the back press
    let lastBack = 0;

    function toast(msg) {
        const el = document.createElement('div');
        el.textContent = msg;
        el.style.cssText = 'position:fixed;left:50%;bottom:88px;transform:translateX(-50%);background:#111827;color:#f3f4f6;padding:8px 14px;border-radius:12px;font-size:13px;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.5)';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1800);
    }

    function openOverlays() {
        return Array.from(document.querySelectorAll('.fixed.inset-0, [data-modal-open="true"]'))
            .filter(el => !el.classList.contains('hidden') && el.getClientRects().length > 0);
    }

    window.HubBack = {
        /** Register a handler; return true from it when it closed something. */
        push(fn) {
            stack.push(fn);
            return () => { const i = stack.indexOf(fn); if (i >= 0) stack.splice(i, 1); };
        }
    };

    async function onBack() {
        for (let i = stack.length - 1; i >= 0; i--) {
            try { if (stack[i]()) return; } catch (e) { console.error('[back]', e); }
        }
        if (openOverlays().length) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            return;
        }
        const now = Date.now();
        if (now - lastBack < 2000) { await App.exitApp(); return; }
        lastBack = now;
        toast('Press back again to exit');
    }

    if (App) App.addListener('backButton', onBack);

    document.addEventListener('DOMContentLoaded', () => {
        if (SplashScreen) SplashScreen.hide().catch(() => {});
    });
})();
