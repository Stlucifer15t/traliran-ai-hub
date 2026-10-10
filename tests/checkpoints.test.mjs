import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'ide-review.js'), 'utf8');

function load() {
    const store = new Map();
    const vfsFiles = {};
    const calls = { chat: [] };
    const VFS = {
        writeFile: async (p, c) => { vfsFiles[p] = { content: c }; },
        deleteFile: async (p) => { delete vfsFiles[p]; },
    };
    const ctx = {
        STORAGE: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
        },
        VFS, vfsFiles, openFiles: [], MONACO: undefined, agentChatWindow: null,
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    const CR = ctx.ChangeReview;
    CR.onRestoreChat = (sessionId, chatLength) => { calls.chat.push([sessionId, chatLength]); return true; };
    return { CR, vfsFiles, calls };
}

test('code restore undoes every change in the turn, including new files', async () => {
    const { CR, vfsFiles } = load();
    vfsFiles['a.txt'] = { content: 'old' };
    CR.beginTurn({ sessionId: 's1', chatLength: 4, label: 'fix a' });
    const id = CR.checkpoints()[0].id;
    await CR.write('a.txt', 'new');
    await CR.write('b.txt', 'created');
    CR.endTurn();
    const res = await CR.restoreCheckpoint(id, { code: true });
    assert.equal(res.ok, true);
    assert.equal(res.codeUndone, 2);
    assert.equal(vfsFiles['a.txt'].content, 'old');
    assert.equal(vfsFiles['b.txt'], undefined);
});

test('chat-only restore cuts the chat and leaves files alone', async () => {
    const { CR, vfsFiles, calls } = load();
    vfsFiles['a.txt'] = { content: 'old' };
    CR.beginTurn({ sessionId: 's2', chatLength: 6, label: 'x' });
    const id = CR.checkpoints()[0].id;
    await CR.write('a.txt', 'new');
    CR.endTurn();
    const res = await CR.restoreCheckpoint(id, { chat: true });
    assert.equal(res.ok, true);
    assert.deepEqual(calls.chat, [['s2', 6]]);
    assert.equal(vfsFiles['a.txt'].content, 'new');
});

test('code and chat together restore both', async () => {
    const { CR, vfsFiles, calls } = load();
    vfsFiles['a.txt'] = { content: 'old' };
    CR.beginTurn({ sessionId: 's3', chatLength: 2, label: 'y' });
    const id = CR.checkpoints()[0].id;
    await CR.write('a.txt', 'new');
    CR.endTurn();
    const res = await CR.restoreCheckpoint(id, { code: true, chat: true });
    assert.equal(res.ok, true);
    assert.equal(vfsFiles['a.txt'].content, 'old');
    assert.deepEqual(calls.chat, [['s3', 2]]);
});

test('a newer change to the same file blocks the older code restore', async () => {
    const { CR, vfsFiles } = load();
    vfsFiles['a.txt'] = { content: 'v0' };
    CR.beginTurn({ sessionId: 's4', chatLength: 0, label: 'first' });
    const first = CR.checkpoints()[0].id;
    await CR.write('a.txt', 'v1');
    CR.endTurn();
    CR.beginTurn({ sessionId: 's4', chatLength: 2, label: 'second' });
    await CR.write('a.txt', 'v2');
    CR.endTurn();
    const res = await CR.restoreCheckpoint(first, { code: true });
    assert.equal(res.ok, false);
    assert.match(res.reason, /Undo those first/);
    assert.equal(vfsFiles['a.txt'].content, 'v2');
});

test('unknown checkpoint is reported, not thrown', async () => {
    const { CR } = load();
    const res = await CR.restoreCheckpoint('nope', { code: true });
    assert.equal(res.ok, false);
});
