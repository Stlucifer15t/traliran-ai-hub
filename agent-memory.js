/*
 * Rules, memory and skills for the IDE agent.
 *
 *   Global rules   Text you write once. Added to every agent prompt.
 *   Project rules  AGENTS.md at the root of the open project. Read on each run.
 *   Memory         Short notes the agent saves with `remember` and removes with `forget`.
 *   Skills         Named instructions. The prompt lists names and descriptions; the agent
 *                  loads a full skill with `load_skill` only when it needs it.
 *
 * Everything is stored on this device. Nothing is sent anywhere except the prompt.
 * The grouping of rules, memory and skills follows AiCode (GPL-3.0, see
 * THIRD_PARTY_NOTICES.md). The code here is written for this project.
 */
(function (g) {
    'use strict';

    const KEY = { rules: 'ide_rules_global', memory: 'ide_memory', skills: 'ide_skills' };
    const LIMITS = {
        rules: 4000,        // characters of global rules
        memory: 50,         // notes kept
        memoryItem: 300,    // characters per note
        skills: 20,
        skillBody: 6000,
        context: 8000,      // total characters added to the prompt
    };
    const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
    const PROJECT_RULES_FILES = ['AGENTS.md', '/AGENTS.md'];

    function store() {
        return (typeof STORAGE !== 'undefined' && STORAGE) ? STORAGE : {
            getItem: (k) => localStorage.getItem(k),
            setItem: (k, v) => localStorage.setItem(k, v),
        };
    }

    function read(key, fallback) {
        try {
            const raw = store().getItem(key);
            const v = raw ? JSON.parse(raw) : null;
            return v === null || v === undefined ? fallback : v;
        } catch (e) {
            return fallback;
        }
    }

    function write(key, value) {
        store().setItem(key, JSON.stringify(value));
    }

    function uid() {
        return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    // ---------- global rules ----------
    function getRules() { return String(read(KEY.rules, '') || ''); }
    function setRules(text) {
        write(KEY.rules, String(text || '').slice(0, LIMITS.rules));
    }

    // ---------- memory ----------
    function listMemory() { const v = read(KEY.memory, []); return Array.isArray(v) ? v : []; }

    function remember(text) {
        const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.memoryItem);
        if (!clean) return { ok: false, error: 'Empty note.' };
        const items = listMemory();
        if (items.some(m => m.text.toLowerCase() === clean.toLowerCase())) {
            return { ok: true, duplicate: true, id: items.find(m => m.text.toLowerCase() === clean.toLowerCase()).id };
        }
        const item = { id: uid(), text: clean, ts: Date.now() };
        items.push(item);
        write(KEY.memory, items.slice(-LIMITS.memory));
        return { ok: true, id: item.id };
    }

    function forget(id) {
        const items = listMemory();
        const next = items.filter(m => m.id !== id);
        if (next.length === items.length) return { ok: false, error: 'No note with that id.' };
        write(KEY.memory, next);
        return { ok: true };
    }

    // ---------- skills ----------
    function listSkills() { const v = read(KEY.skills, []); return Array.isArray(v) ? v : []; }

    function saveSkill(input) {
        const name = String(input.name || '').trim().toLowerCase();
        const description = String(input.description || '').trim().slice(0, 200);
        const body = String(input.body || '').trim().slice(0, LIMITS.skillBody);
        if (!SKILL_NAME.test(name)) return { ok: false, error: 'Name: lowercase letters, digits and dashes, up to 40 characters.' };
        if (!description) return { ok: false, error: 'Add a short description.' };
        if (!body) return { ok: false, error: 'Add the instructions.' };
        const skills = listSkills();
        const existing = skills.find(s => s.name === name);
        if (existing) {
            Object.assign(existing, { description, body });
        } else {
            if (skills.length >= LIMITS.skills) return { ok: false, error: 'Up to ' + LIMITS.skills + ' skills.' };
            skills.push({ id: uid(), name, description, body });
        }
        write(KEY.skills, skills);
        return { ok: true, name };
    }

    function deleteSkill(id) {
        write(KEY.skills, listSkills().filter(s => s.id !== id));
    }

    // ---------- project rules ----------
    async function readProjectRules() {
        if (typeof VFS === 'undefined' || !VFS || typeof VFS.readFile !== 'function') return '';
        for (const p of PROJECT_RULES_FILES) {
            try {
                const text = await VFS.readFile(p);
                if (typeof text === 'string' && text.trim()) return text;
            } catch (e) { /* not found under this name */ }
        }
        return '';
    }

    // ---------- prompt ----------
    /** Text added to the agent's system prompt. Empty when nothing is set. */
    async function buildContext() {
        const parts = [];
        const rules = getRules().trim();
        if (rules) parts.push('## Global rules\n' + rules);

        const project = (await readProjectRules()).trim();
        if (project) parts.push('## Project rules (AGENTS.md)\n' + project.slice(0, 3000));

        const notes = listMemory();
        if (notes.length) {
            parts.push('## Memory (saved notes; use forget with the id to remove one)\n' +
                notes.map(m => `- [${m.id}] ${m.text}`).join('\n'));
        }

        const skills = listSkills();
        if (skills.length) {
            parts.push('## Skills (call load_skill with the name to read the full instructions)\n' +
                skills.map(s => `- ${s.name}: ${s.description}`).join('\n'));
        }

        let text = parts.join('\n\n');
        if (text.length > LIMITS.context) text = text.slice(0, LIMITS.context) + '\n[context trimmed]';
        return text;
    }

    // ---------- tools for the agent ----------
    const json = (o) => JSON.stringify(o, null, 2);
    const tools = [
        {
            name: 'remember',
            description: 'Saves a short note for future chats in this app (a preference, a project fact, a decision). Keep it under 300 characters.',
            parameters: {
                type: 'object',
                properties: { text: { type: 'string', description: 'The note, one or two sentences' } },
                required: ['text'],
                additionalProperties: false,
            },
            execute: async (args) => json(remember(args && args.text)),
        },
        {
            name: 'forget',
            description: 'Removes a saved memory note by its id (the id is shown in the Memory section of the prompt).',
            parameters: {
                type: 'object',
                properties: { id: { type: 'string', description: 'The note id, for example m1abc' } },
                required: ['id'],
                additionalProperties: false,
            },
            execute: async (args) => json(forget(args && args.id)),
        },
        {
            name: 'load_skill',
            description: 'Returns the full instructions of a skill listed in the prompt.',
            parameters: {
                type: 'object',
                properties: { name: { type: 'string', description: 'The skill name from the Skills list' } },
                required: ['name'],
                additionalProperties: false,
            },
            execute: async (args) => {
                const name = String((args && args.name) || '').trim().toLowerCase();
                const skill = listSkills().find(s => s.name === name);
                if (!skill) return json({ success: false, error: 'No skill named ' + name });
                return json({ success: true, name: skill.name, instructions: skill.body });
            },
        },
    ];

    function registerTools() {
        if (typeof AI_AGENT === 'undefined' || !AI_AGENT || !Array.isArray(AI_AGENT.tools)) return;
        for (const t of tools) {
            if (!AI_AGENT.tools.some(x => x.name === t.name)) AI_AGENT.tools.push(t);
        }
    }

    g.AgentMemory = {
        LIMITS, getRules, setRules,
        listMemory, remember, forget,
        listSkills, saveSkill, deleteSkill,
        buildContext, tools, registerTools,
    };
    registerTools();
})(window);
