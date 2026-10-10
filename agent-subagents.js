/*
 * Sub-agents for the IDE agent.
 *
 * The main agent can call spawn_subagent(agent, task). The sub-agent runs in its own
 * context with its own short tool loop, then returns one report. The main chat only
 * sees the report, so long searches do not fill the chat.
 *
 *   explore   Built in. Read-only: list_files and read_file.
 *   custom    Defined in the Rules panel: a name, a one-line description, a prompt,
 *             a set of tools, and an optional model.
 *
 * Sub-agents cannot start other sub-agents. Every tool a sub-agent uses goes through
 * the same PLAN gate as the main agent. Stored on this device.
 * Structure follows AiCode's sub-agent feature (GPL-3.0, see THIRD_PARTY_NOTICES.md).
 */
(function (g) {
    'use strict';

    const KEY = 'ide_subagents';
    const MAX_CUSTOM = 10;
    const MAX_STEPS = 6;          // model turns per sub-agent run
    const MAX_REPORT = 12000;     // characters returned to the main agent
    const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
    const SELF = 'spawn_subagent';

    const BUILTIN = [{
        id: 'builtin-explore',
        name: 'explore',
        description: 'Read-only. Looks through the project and reports what it finds.',
        prompt: 'You explore a code project to answer the question you are given. ' +
            'Use list_files and read_file. You cannot change anything. ' +
            'Finish with a short report: the answer, the file paths that matter, and anything you are not sure about.',
        tools: ['list_files', 'read_file'],
        model: '',
        builtin: true,
    }];

    let runCtx = null;   // { provider, apiKey, model, endpoint } of the main run in progress

    function store() {
        return (typeof STORAGE !== 'undefined' && STORAGE) ? STORAGE : {
            getItem: (k) => localStorage.getItem(k),
            setItem: (k, v) => localStorage.setItem(k, v),
        };
    }
    function readCustom() {
        try {
            const v = JSON.parse(store().getItem(KEY) || '[]');
            return Array.isArray(v) ? v : [];
        } catch (e) { return []; }
    }
    function writeCustom(list) { store().setItem(KEY, JSON.stringify(list)); }
    function uid() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

    function availableTools() {
        if (typeof AI_AGENT === 'undefined' || !AI_AGENT || !Array.isArray(AI_AGENT.tools)) return [];
        return AI_AGENT.tools.map(t => t.name).filter(n => n !== SELF);
    }

    function listAgents() { return BUILTIN.concat(readCustom()); }

    function saveCustom(input) {
        const name = String(input.name || '').trim().toLowerCase();
        const description = String(input.description || '').trim().slice(0, 160);
        const prompt = String(input.prompt || '').trim().slice(0, 4000);
        const model = String(input.model || '').trim().slice(0, 120);
        const allowed = new Set(availableTools());
        const tools = (Array.isArray(input.tools) ? input.tools : []).filter(t => allowed.has(t));
        if (!NAME.test(name)) return { ok: false, error: 'Name: lowercase letters, digits and dashes, up to 40 characters.' };
        if (BUILTIN.some(a => a.name === name)) return { ok: false, error: '"' + name + '" is a built-in sub-agent.' };
        if (!description) return { ok: false, error: 'Add a short description.' };
        if (!prompt) return { ok: false, error: 'Add the instructions.' };
        if (!tools.length) return { ok: false, error: 'Pick at least one tool.' };
        const list = readCustom();
        const existing = list.find(a => a.name === name);
        if (existing) {
            Object.assign(existing, { description, prompt, tools, model });
        } else {
            if (list.length >= MAX_CUSTOM) return { ok: false, error: 'Up to ' + MAX_CUSTOM + ' custom sub-agents.' };
            list.push({ id: uid(), name, description, prompt, tools, model });
        }
        writeCustom(list);
        return { ok: true, name };
    }

    function deleteCustom(id) {
        writeCustom(readCustom().filter(a => a.id !== id));
    }

    function setRunContext(ctx) { runCtx = ctx || null; }

    function describeTools(names) {
        return AI_AGENT.tools
            .filter(t => names.includes(t.name))
            .map(t => `### ${t.name}\nDescription: ${t.description}\nParameters: ${JSON.stringify(t.parameters.properties || {})}`)
            .join('\n\n');
    }

    /** Runs one sub-agent to completion and returns { ok, report } or { ok: false, error }. */
    async function run(agentName, task) {
        const name = String(agentName || '').trim().toLowerCase();
        const agent = listAgents().find(a => a.name === name);
        if (!agent) return { ok: false, error: 'No sub-agent named "' + name + '". Available: ' + listAgents().map(a => a.name).join(', ') };
        if (!runCtx) return { ok: false, error: 'Sub-agents run only during an agent chat.' };
        const text = String(task || '').trim();
        if (!text) return { ok: false, error: 'Give the sub-agent a task.' };

        const allowed = agent.tools.filter(t => availableTools().includes(t));
        const system = agent.prompt + '\n\n' +
            'You are a sub-agent. Your final reply goes to the main agent, not to the user.\n' +
            'Tools you can use:\n\n' + describeTools(allowed) + '\n\n' +
            'To call a tool, respond with a JSON object in this exact format:\n' +
            '{"tool": "tool_name", "arguments": {"param1": "value1"}}\n' +
            'Only output the JSON object when you call a tool. When you are done, reply with the report as plain text.';

        const messages = [{ role: 'system', content: system }, { role: 'user', content: text }];
        const model = agent.model || runCtx.model;
        let last = '';

        for (let step = 0; step < MAX_STEPS; step++) {
            if (typeof agentAbortController !== 'undefined' && agentAbortController && agentAbortController.signal.aborted) {
                return { ok: false, error: 'Stopped.' };
            }
            const res = await AI_AGENT.callLLM(messages, runCtx.provider, runCtx.apiKey, model, runCtx.endpoint, () => {});
            const calls = Array.isArray(res.toolCalls) ? res.toolCalls : [];
            last = res.content || last;
            if (!calls.length) {
                return { ok: true, report: String(res.content || '').slice(0, MAX_REPORT) };
            }
            messages.push({ role: 'assistant', content: res.content || '' });
            for (const call of calls) {
                const toolName = call.function ? call.function.name : call.name;
                const rawArgs = call.function ? call.function.arguments : call.arguments;
                let result;
                if (!allowed.includes(toolName)) {
                    result = JSON.stringify({ success: false, error: 'This sub-agent cannot use ' + toolName + '.' });
                } else {
                    const blocked = g.AgentModes ? g.AgentModes.gate(toolName) : null;
                    if (blocked !== null) {
                        result = blocked;
                    } else {
                        let args = {};
                        try { args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs || {}); } catch (e) { args = {}; }
                        const tool = AI_AGENT.tools.find(t => t.name === toolName);
                        result = await tool.execute(args);
                    }
                }
                messages.push({ role: 'user', content: `[Tool result from ${toolName}]: ${result}` });
            }
        }
        return {
            ok: true,
            report: 'Stopped after ' + MAX_STEPS + ' steps without a final answer. Last message: ' +
                String(last || '').slice(0, 2000),
        };
    }

    const tool = {
        name: SELF,
        description: 'Runs a sub-agent in its own context and returns only its report. Use it for research or review that would otherwise fill the chat. ' +
            'Agents: explore (read-only, built in) and any custom agent listed in the Rules panel.',
        parameters: {
            type: 'object',
            properties: {
                agent: { type: 'string', description: 'Sub-agent name, for example explore' },
                task: { type: 'string', description: 'Exactly what to find or check, including any paths' },
            },
            required: ['agent', 'task'],
            additionalProperties: false,
        },
        execute: async (args) => {
            const res = await run(args && args.agent, args && args.task);
            return JSON.stringify(res, null, 2);
        },
    };

    function registerTools() {
        if (typeof AI_AGENT === 'undefined' || !AI_AGENT || !Array.isArray(AI_AGENT.tools)) return;
        if (!AI_AGENT.tools.some(t => t.name === SELF)) AI_AGENT.tools.push(tool);
    }

    g.AgentSubagents = {
        BUILTIN, MAX_CUSTOM, MAX_STEPS,
        listAgents, listCustom: readCustom, saveCustom, deleteCustom,
        availableTools, setRunContext, run, tool, registerTools,
    };
    registerTools();
})(window);
