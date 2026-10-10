import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'agent-memory.js'), 'utf8');

function load({ files = {}, aiAgentTools = null } = {}) {
    const store = new Map();
    const STORAGE = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
    };
    const VFS = {
        readFile: async (p) => {
            if (p in files) return files[p];
            throw new Error('File not found: ' + p);
        },
    };
    const ctx = { STORAGE, VFS, localStorage: undefined };
    if (aiAgentTools) ctx.AI_AGENT = { tools: aiAgentTools };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return ctx.AgentMemory;
}

test('remember stores a note, skips duplicates, and forget removes it', () => {
    const M = load();
    const a = M.remember('  Use   tabs  ');
    assert.equal(a.ok, true);
    assert.equal(M.listMemory()[0].text, 'Use tabs');
    const dup = M.remember('use tabs');
    assert.equal(dup.duplicate, true);
    assert.equal(M.listMemory().length, 1);
    assert.equal(M.forget(a.id).ok, true);
    assert.equal(M.listMemory().length, 0);
    assert.equal(M.forget('nope').ok, false);
});

test('remember rejects empty text and caps note length', () => {
    const M = load();
    assert.equal(M.remember('   ').ok, false);
    M.remember('x'.repeat(1000));
    assert.equal(M.listMemory()[0].text.length, M.LIMITS.memoryItem);
});

test('saveSkill validates the name and updates an existing skill', () => {
    const M = load();
    assert.equal(M.saveSkill({ name: 'Bad Name!', description: 'd', body: 'b' }).ok, false);
    assert.equal(M.saveSkill({ name: 'write-tests', description: '', body: 'b' }).ok, false);
    assert.equal(M.saveSkill({ name: 'write-tests', description: 'd1', body: 'b1' }).ok, true);
    assert.equal(M.saveSkill({ name: 'write-tests', description: 'd2', body: 'b2' }).ok, true);
    const skills = M.listSkills();
    assert.equal(skills.length, 1);
    assert.equal(skills[0].description, 'd2');
    M.deleteSkill(skills[0].id);
    assert.equal(M.listSkills().length, 0);
});

test('buildContext is empty when nothing is set', async () => {
    const M = load();
    assert.equal(await M.buildContext(), '');
});

test('buildContext includes global rules, AGENTS.md, memory and skill names', async () => {
    const M = load({ files: { 'AGENTS.md': 'Run npm test before finishing.' } });
    M.setRules('Answer in English.');
    M.remember('Prefers small PRs');
    M.saveSkill({ name: 'release', description: 'Cut a release', body: 'Steps...' });
    const ctx = await M.buildContext();
    assert.match(ctx, /## Global rules\nAnswer in English\./);
    assert.match(ctx, /## Project rules \(AGENTS\.md\)\nRun npm test before finishing\./);
    assert.match(ctx, /Prefers small PRs/);
    assert.match(ctx, /- release: Cut a release/);
    assert.doesNotMatch(ctx, /Steps\.\.\./, 'full skill body is not in the prompt');
});

test('buildContext is capped', async () => {
    const M = load();
    M.setRules('r'.repeat(4000));
    for (let i = 0; i < 20; i++) M.remember('note number ' + i + ' ' + 'z'.repeat(250));
    const ctx = await M.buildContext();
    assert.ok(ctx.length <= M.LIMITS.context + 40);
});

test('load_skill tool returns the full instructions', async () => {
    const tools = [];
    const M = load({ aiAgentTools: tools });
    M.saveSkill({ name: 'lint-fix', description: 'Fix lint', body: 'Run eslint --fix' });
    M.registerTools();
    const tool = tools.find(t => t.name === 'load_skill');
    assert.ok(tool, 'tool registered');
    const res = JSON.parse(await tool.execute({ name: 'lint-fix' }));
    assert.equal(res.success, true);
    assert.equal(res.instructions, 'Run eslint --fix');
    const miss = JSON.parse(await tool.execute({ name: 'missing' }));
    assert.equal(miss.success, false);
});
