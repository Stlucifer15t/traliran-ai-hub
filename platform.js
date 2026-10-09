/*
 * platform.js - shared platform helpers (Traliran AI Hub, AGPL-3.0).
 *
 *  - Anthropic browser access header on every api.anthropic.com request.
 *  - saveFile(): downloads that work in a browser AND in the Android WebView
 *    (Capacitor Filesystem + Share). <a download> does nothing in a WebView.
 *  - Mobile / native detection used by the mobile IDE layout.
 */
(function () {
    'use strict';

    const cap = window.Capacitor;
    const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
    const isMobile = isNative
        || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
        || (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches);

    const ANTHROPIC_VERSION = '2023-06-01';

    /** Headers for any request to the Anthropic API. */
    function anthropicHeaders(apiKey, extra) {
        return Object.assign({
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'anthropic-dangerous-direct-browser-access': 'true'
        }, extra || {});
    }

    /*
     * Safety net: every fetch to api.anthropic.com gets the browser-access
     * header, including call sites that build their headers ad hoc.
     */
    const ANTHROPIC_HOST = 'api.anthropic.com';
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf(ANTHROPIC_HOST) === -1) return nativeFetch(input, init);
        const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
        headers.set('anthropic-dangerous-direct-browser-access', 'true');
        if (!headers.has('anthropic-version')) headers.set('anthropic-version', ANTHROPIC_VERSION);
        return nativeFetch(input, Object.assign({}, init, { headers }));
    };

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => {
                const s = String(reader.result || '');
                resolve(s.slice(s.indexOf(',') + 1));
            };
            reader.readAsDataURL(blob);
        });
    }

    function textToBase64(text) {
        const bytes = new TextEncoder().encode(String(text));
        let bin = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(bin);
    }

    function plugin(name) {
        return cap && cap.Plugins ? cap.Plugins[name] : undefined;
    }

    /**
     * Saves a file. `data` may be a Blob or a string.
     * Web: the blob URL is clicked synchronously and revoked later (a revoke
     * right after click() can cancel the download in some browsers).
     * Native: written to the app cache, then handed to the Android share sheet.
     */
    async function saveFile(data, filename, mime) {
        const type = mime || (data instanceof Blob ? data.type : 'text/plain') || 'application/octet-stream';
        const blob = data instanceof Blob ? data : new Blob([data], { type });

        if (isNative && plugin('Filesystem')) {
            const FS = plugin('Filesystem');
            const base64 = await blobToBase64(blob);
            const safeName = String(filename).replace(/[\\/:*?"<>|]+/g, '_');
            const written = await FS.writeFile({
                path: `exports/${Date.now()}-${safeName}`,
                data: base64,
                directory: 'CACHE',
                recursive: true
            });
            const Share = plugin('Share');
            if (Share) {
                await Share.share({ title: safeName, files: [written.uri], dialogTitle: 'Save or share' });
            }
            return { ok: true, uri: written.uri };
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return { ok: true };
    }

    /** Trims, adds http:// when no scheme is given, and drops trailing slashes. */
    function normalizeEndpoint(url) {
        let v = String(url || '').trim();
        if (v && !/^https?:\/\//i.test(v)) v = 'http://' + v;
        return v.replace(/\/+$/, '');
    }

    /** On a phone, localhost is the phone itself: explain that when it is used. */
    function localEndpointWarning(url) {
        if (!isMobile) return '';
        try {
            const host = new URL(normalizeEndpoint(url)).hostname;
            if (['localhost', '127.0.0.1', '[::1]', '::1'].indexOf(host) !== -1) {
                return 'On this phone, localhost is the phone itself. Enter your computer\'s LAN address, e.g. http://192.168.1.20:11434/v1';
            }
        } catch (e) { /* incomplete URL while typing */ }
        return '';
    }

    window.HubPlatform = {
        normalizeEndpoint,
        localEndpointWarning,
        isNative,
        isMobile,
        anthropicHeaders,
        saveFile,
        blobToBase64,
        textToBase64,
        plugin
    };
})();
