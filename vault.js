/*
 * vault.js - encrypts secrets (API keys) at rest with AES-GCM.
 *
 * Key model: a random 256-bit AES key is generated once per device and stored
 * NON-EXTRACTABLE in IndexedDB. The key cannot be read back by page script, so
 * a copy of the stored ciphertext alone is useless without this browser profile.
 * Honest limit: this is not hardware-backed. Android app data is excluded from
 * cloud/ADB backups (android:allowBackup="false") so the key does not leave the device.
 *
 * Sealed format: "enc1:<base64 iv>.<base64 ciphertext>"
 */
(function (g) {
    'use strict';

    const PREFIX = 'enc1:';
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    function b64(bytes) {
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }
    function unb64(str) {
        const bin = atob(str);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    const Vault = {
        _key: null,
        _subtle: null,

        /**
         * opts.loadKey(): Promise<CryptoKey|null>; opts.saveKey(key): Promise<void>.
         * Returns true when encryption is active. Without WebCrypto (plain http on
         * a LAN, very old WebViews) it returns false and values stay as they are.
         */
        async init(opts = {}) {
            const subtle = g.crypto && g.crypto.subtle;
            if (!subtle) { this._key = null; return false; }
            this._subtle = subtle;
            let key = opts.loadKey ? await opts.loadKey() : null;
            if (!key) {
                key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
                if (opts.saveKey) await opts.saveKey(key);
            }
            this._key = key;
            return true;
        },

        enabled() { return !!this._key; },
        isSealed(value) { return typeof value === 'string' && value.startsWith(PREFIX); },

        async seal(plain) {
            if (!this._key) return plain;
            const iv = g.crypto.getRandomValues(new Uint8Array(12));
            const ct = new Uint8Array(await this._subtle.encrypt({ name: 'AES-GCM', iv }, this._key, enc.encode(String(plain))));
            return `${PREFIX}${b64(iv)}.${b64(ct)}`;
        },

        async open(sealed) {
            if (!this.isSealed(sealed)) return sealed;
            if (!this._key) throw new Error('Vault locked: no key');
            const body = sealed.slice(PREFIX.length);
            const dot = body.indexOf('.');
            const iv = unb64(body.slice(0, dot));
            const ct = unb64(body.slice(dot + 1));
            const pt = await this._subtle.decrypt({ name: 'AES-GCM', iv }, this._key, ct);
            return dec.decode(pt);
        }
    };

    /** IndexedDB key store used in the browser / WebView. */
    function indexedDbKeyStore(dbName = 'traliran-vault') {
        const STORE = 'keys', ID = 'device-key';
        const openDb = () => new Promise((resolve, reject) => {
            const req = g.indexedDB.open(dbName, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return {
            async loadKey() {
                const db = await openDb();
                return new Promise((resolve, reject) => {
                    const q = db.transaction(STORE, 'readonly').objectStore(STORE).get(ID);
                    q.onsuccess = () => resolve(q.result || null);
                    q.onerror = () => reject(q.error);
                });
            },
            async saveKey(key) {
                const db = await openDb();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction(STORE, 'readwrite');
                    tx.objectStore(STORE).put(key, ID);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });
            }
        };
    }

    Vault.indexedDbKeyStore = indexedDbKeyStore;
    g.Vault = Vault;
})(typeof window !== 'undefined' ? window : globalThis);
