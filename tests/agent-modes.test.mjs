import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'agent-modes.js'), 'utf8');

function load() {
    const store = new Map();
    const window = {};
    const context = {
        window,
        document: { readyState: 'complete', getElementById: () => null, addEventListener() {} },
        localStorage: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
        },
    };
    vm.createContext(context);
    vm.runInContext(src, context);
    return window.AgentModes;
}

test('defaults to BUILD and allows every tool', () => {
    const m = load();
    assert.equal(m.current(), 'BUILD');
    assert.equal(m.gate('write_file'), null);
    assert.equal(m.gate('run_command'), null);
    assert.equal(m.autoApprove(), false);
});

test('PLAN allows read tools and blocks writes and commands', () => {
    const m = load();
    m.set('PLAN');
    assert.equal(m.gate('list_files'), null);
    assert.equal(m.gate('read_file'), null);
    for (const name of ['write_file', 'edit_file_part', 'rename_path', 'run_command', 'unknown_tool']) {
        const blocked = m.gate(name);
        assert.ok(typeof blocked === 'string' && blocked.startsWith('Blocked:'), name);
    }
    assert.equal(m.autoApprove(), false);
});

test('PLAN still allows memory and skill tools (not project files)', () => {
    const m = load();
    m.set('PLAN');
    for (const name of ['remember', 'forget', 'load_skill']) assert.equal(m.gate(name), null, name);
});

test('AUTO runs everything and skips the command approval wait', () => {
    const m = load();
    m.set('AUTO');
    assert.equal(m.gate('write_file'), null);
    assert.equal(m.gate('run_command'), null);
    assert.equal(m.autoApprove(), true);
});

test('next() cycles BUILD -> PLAN -> AUTO -> BUILD and persists', () => {
    const m = load();
    assert.equal(m.current(), 'BUILD');
    m.next(); assert.equal(m.current(), 'PLAN');
    m.next(); assert.equal(m.current(), 'AUTO');
    m.next(); assert.equal(m.current(), 'BUILD');
});

test('unknown stored value falls back to BUILD', () => {
    const m = load();
    m.set('NOPE');
    assert.equal(m.current(), 'BUILD');
});
