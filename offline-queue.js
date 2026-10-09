/*
 * offline-queue.js - keeps the user's messages and partial replies when the
 * connection drops. Storage is injected (the app passes STORAGE) so this file
 * stays testable. Remote streams cannot be resumed, so the honest guarantee is:
 * the prompt is queued and resent, and partial output is kept until the user
 * continues or discards it.
 */
(function (g) {
    'use strict';

    const QUEUE_KEY = 'ide_offline_queue';
    const PARTIAL_KEY = 'ide_partial_reply';

    function createQueue(store) {
        const read = (key, fallback) => {
            try { const raw = store.getItem(key); return raw ? JSON.parse(raw) : fallback; }
            catch (e) { return fallback; }
        };
        const write = (key, value) => store.setItem(key, JSON.stringify(value));

        return {
            list() { return read(QUEUE_KEY, []); },
            enqueue(item) {
                const list = this.list();
                const entry = Object.assign({ id: `q${Date.now()}${Math.random().toString(36).slice(2, 6)}`, createdAt: Date.now(), attempts: 0 }, item);
                list.push(entry);
                write(QUEUE_KEY, list);
                return entry;
            },
            remove(id) {
                write(QUEUE_KEY, this.list().filter(x => x.id !== id));
            },
            bumpAttempts(id) {
                write(QUEUE_KEY, this.list().map(x => x.id === id ? Object.assign({}, x, { attempts: x.attempts + 1 }) : x));
            },
            savePartial(sessionId, text) {
                write(PARTIAL_KEY, { sessionId, text, updatedAt: Date.now() });
            },
            loadPartial() { return read(PARTIAL_KEY, null); },
            clearPartial() { store.setItem(PARTIAL_KEY, 'null'); }
        };
    }

    g.OfflineQueue = { createQueue, QUEUE_KEY, PARTIAL_KEY };
})(typeof window !== 'undefined' ? window : globalThis);
