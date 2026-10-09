import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, memoryStore } from './helpers.mjs';

load('line-diff.js');
load('cost.js');
load('presets.js');
load('offline-queue.js');
load('vault.js');

test('LineDiff: identical text has only equal lines', () => {
    const ops = LineDiff.diff('a\nb\nc', 'a\nb\nc');
    assert.deepEqual(LineDiff.stats(ops), { added: 0, removed: 0 });
    assert.ok(ops.every(o => o.type === 'eq'));
});

test('LineDiff: counts added and removed lines', () => {
    const ops = LineDiff.diff('one\ntwo\nthree\n', 'one\n2\nthree\nfour\n');
    assert.deepEqual(LineDiff.stats(ops), { added: 2, removed: 1 });
});

test('LineDiff: new file and emptied file', () => {
    assert.deepEqual(LineDiff.stats(LineDiff.diff(null, 'x\ny\n')), { added: 2, removed: 0 });
    assert.deepEqual(LineDiff.stats(LineDiff.diff('x\ny', '')), { added: 0, removed: 2 });
});

test('LineDiff: hunks collapse long unchanged runs', () => {
    const old = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const neu = old.replace('line 50', 'changed');
    const h = LineDiff.hunks(LineDiff.diff(old, neu), 2);
    assert.ok(h.some(o => o.type === 'skip'));
    assert.ok(h.filter(o => o.type !== 'skip').length < 12);
});

test('TokenCost: Anthropic-style usage priced per million tokens', () => {
    const c = TokenCost.costOf({ input_tokens: 1000000, output_tokens: 1000000 }, 'claude-sonnet-4-5', 'claude');
    assert.equal(c.usd, 18);
});

test('TokenCost: OpenAI-style usage, local models are free, unknown models have no price', () => {
    assert.equal(TokenCost.costOf({ prompt_tokens: 1000000, completion_tokens: 0 }, 'gpt-4o-mini', 'openai').usd, 0.15);
    assert.equal(TokenCost.costOf({ prompt_tokens: 5, completion_tokens: 5 }, 'qwen2.5-coder', 'ollama').usd, 0);
    assert.equal(TokenCost.costOf({ prompt_tokens: 5, completion_tokens: 5 }, 'mystery-model', 'openai').usd, null);
});

test('TokenCost: counter sums by model and flags unknown prices', () => {
    const counter = TokenCost.createCounter();
    counter.add({ prompt_tokens: 100, completion_tokens: 50 }, 'gpt-4o-mini', 'openai');
    counter.add({ prompt_tokens: 10, completion_tokens: 10 }, 'mystery', 'openai');
    const s = counter.summary();
    assert.equal(s.total, 170);
    assert.equal(s.unknown, true);
});

test('Presets: every preset has an index.html or entry and non-empty files', () => {
    assert.ok(HubPresets.PRESETS.length >= 4);
    for (const p of HubPresets.PRESETS) {
        const names = Object.keys(p.files);
        assert.ok(names.length >= 2, p.id);
        for (const n of names) assert.ok(p.files[n].trim().length > 0, `${p.id}/${n}`);
        assert.ok(names.some(n => n.endsWith('.html')), p.id);
    }
});

test('Presets: templates fill placeholders and keep unknown ones', () => {
    assert.equal(HubPresets.fillTemplate('Build {{what}} for {{who}}', { what: 'app' }), 'Build app for {{who}}');
});

test('OfflineQueue: enqueue, bump, remove, partial reply', () => {
    const store = memoryStore();
    const q = OfflineQueue.createQueue(store);
    const a = q.enqueue({ sessionId: 's1', text: 'hello' });
    q.enqueue({ sessionId: 's1', text: 'again' });
    q.bumpAttempts(a.id);
    assert.equal(q.list().length, 2);
    assert.equal(q.list()[0].attempts, 1);
    q.remove(a.id);
    assert.deepEqual(q.list().map(x => x.text), ['again']);
    q.savePartial('s1', 'half a reply');
    assert.equal(q.loadPartial().text, 'half a reply');
    q.clearPartial();
    assert.equal(q.loadPartial(), null);
});

test('Vault: seal and open round-trip, ciphertext hides plaintext, tamper is detected', async () => {
    let stored = null;
    assert.equal(await Vault.init({ loadKey: async () => stored, saveKey: async (k) => { stored = k; } }), true);
    const sealed = await Vault.seal('sk-live-secret');
    assert.ok(Vault.isSealed(sealed));
    assert.ok(!sealed.includes('sk-live'));
    assert.equal(await Vault.open(sealed), 'sk-live-secret');
    const tampered = sealed.slice(0, -4) + 'AAAA';
    await assert.rejects(Vault.open(tampered));
});

test('Vault: the stored key is not extractable (cannot be exported as raw bytes)', async () => {
    let stored = null;
    await Vault.init({ loadKey: async () => stored, saveKey: async (k) => { stored = k; } });
    assert.equal(stored.extractable, false);
    await assert.rejects(crypto.subtle.exportKey('raw', stored));
});
