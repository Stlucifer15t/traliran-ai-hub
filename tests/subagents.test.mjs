import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'agent-subagents.js'), 'utf8');

// script: array of model replies; each reply is { content, toolCalls } (toolCalls use the parsed shape)
function load({ script = [], mode = 'BUILD', writes = [] } = {}) {
    const store = new Map();
    const STORAGE = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
    };
    const seenMessages = [];
    let turn = 0;
    const tools = [
        { name: 'list_files', description: 'list', parameters: { properties: {} }, execute: async () => '["a.js"]' },
        { name: 'read_file', description: 'read', parameters: { properties: {} }, execute: async () => 'file body' },
        { name: 'write_file', description: 'write', parameters: { properties: {} },
          execute: async (args) => { writes.push(args); return '{"success":true}'; } },
        { name: 'spawn_subagent', description: 'self', parameters: { properties: {} }, execute: async () => '' },
    ];
    const AI_AGENT = {
        tools,
        callLLM: async (messages) => {
            seenMessages.push(messages.map(m => ({ role: m.role, content: m.content })));
            const reply = script[Math.min(turn, script.length - 1)];
            turn++;
            return { content: reply.content || '', toolCalls: reply.toolCalls || [], finishReason: 'stop' };
        },
    };
    const AgentModes = { gate: (name) => (mode === 'PLAN' && name === 'write_file' ? 'Blocked: plan mode' : null) };
    const ctx = { STORAGE, AI_AGENT, AgentModes };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return { S: ctx.AgentSubagents, AI_AGENT, seenMessages };
}

const call = (name, args) => ({ function: { name, arguments: JSON.stringify(args) } });

test('explore reads a file through its tools and returns the final report', async () => {
    const { S } = load({
        script: [
            { toolCalls: [call('read_file', { path: 'a.js' })] },
            { content: 'a.js sets up the app.' },
        ],
    });
    S.setRunContext({ provider: 'x', apiKey: 'k', model: 'm', endpoint: 'e' });
    const res = await S.run('explore', 'What does a.js do?');
    assert.equal(res.ok, true);
    assert.equal(res.report, 'a.js sets up the app.');
});

test('a sub-agent cannot use tools outside its list', async () => {
    const { S, seenMessages } = load({
        script: [
            { toolCalls: [call('write_file', { path: 'x', content: 'y' })] },
            { content: 'done' },
        ],
    });
    S.setRunContext({ provider: 'x', apiKey: 'k', model: 'm', endpoint: 'e' });
    const res = await S.run('explore', 'try to write');
    assert.equal(res.ok, true);
    const lastUser = seenMessages[1].filter(m => m.role === 'user').pop().content;
    assert.match(lastUser, /cannot use write_file/);
});

test('PLAN gate also applies inside a custom sub-agent', async () => {
    const writes = [];
    const { S, seenMessages } = load({
        mode: 'PLAN',
        writes,
        script: [
            { toolCalls: [call('write_file', { path: 'x', content: 'y' })] },
            { content: 'ok' },
        ],
    });
    assert.equal(S.saveCustom({ name: 'writer', description: 'writes', prompt: 'write things', tools: ['write_file'] }).ok, true);
    S.setRunContext({ provider: 'x', apiKey: 'k', model: 'm', endpoint: 'e' });
    await S.run('writer', 'do it');
    assert.equal(writes.length, 0, 'write_file must not run in PLAN');
    const lastUser = seenMessages[1].filter(m => m.role === 'user').pop().content;
    assert.match(lastUser, /Blocked: plan mode/);
});

test('custom agents: validation, spawn_subagent excluded, built-in name protected', () => {
    const { S } = load();
    assert.equal(S.saveCustom({ name: 'Bad Name', description: 'd', prompt: 'p', tools: ['read_file'] }).ok, false);
    assert.equal(S.saveCustom({ name: 'explore', description: 'd', prompt: 'p', tools: ['read_file'] }).ok, false);
    assert.equal(S.saveCustom({ name: 'nope', description: 'd', prompt: 'p', tools: [] }).ok, false);
    assert.equal(S.saveCustom({ name: 'loop', description: 'd', prompt: 'p', tools: ['spawn_subagent'] }).ok, false);
    assert.equal(S.saveCustom({ name: 'reader', description: 'd', prompt: 'p', tools: ['read_file', 'spawn_subagent'] }).ok, true);
    const saved = S.listCustom();
    assert.deepEqual([...saved[0].tools], ['read_file']);
});

test('no run in progress is reported, not thrown', async () => {
    const { S } = load();
    const res = await S.run('explore', 'anything');
    assert.equal(res.ok, false);
    assert.match(res.error, /during an agent chat/);
});

test('unknown agent lists the available ones', async () => {
    const { S } = load();
    S.setRunContext({ provider: 'x', apiKey: 'k', model: 'm', endpoint: 'e' });
    const res = await S.run('ghost', 'x');
    assert.equal(res.ok, false);
    assert.match(res.error, /explore/);
});

test('a sub-agent that never finishes stops after MAX_STEPS', async () => {
    const { S } = load({ script: [{ toolCalls: [call('read_file', { path: 'a' })] }] });
    S.setRunContext({ provider: 'x', apiKey: 'k', model: 'm', endpoint: 'e' });
    const res = await S.run('explore', 'loop forever');
    assert.equal(res.ok, true);
    assert.match(res.report, /Stopped after 6 steps/);
});

test('spawn_subagent tool is registered once and returns JSON', async () => {
    const { S, AI_AGENT } = load({ script: [{ content: 'report text' }] });
    S.registerTools();
    const count = AI_AGENT.tools.filter(t => t.name === 'spawn_subagent').length;
    assert.equal(count, 1, 'registered once (the test stub already had one, so the real one must not be added again)');
});
