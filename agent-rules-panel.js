/*
 * Panel for the agent's rules, memory and skills. Opened from the "Rules" button
 * in the agent header. Logic lives in agent-memory.js (window.AgentMemory).
 */
(function (g) {
    'use strict';

    const M = () => g.AgentMemory;

    function h(tag, cls, text) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text !== undefined && text !== null) el.textContent = text;
        return el;
    }

    function section(title, hint) {
        const wrap = h('section', 'am-section');
        wrap.appendChild(h('h3', 'am-title', title));
        if (hint) wrap.appendChild(h('p', 'am-hint', hint));
        return wrap;
    }

    function note(wrap, text, bad) {
        let el = wrap.querySelector('.am-note');
        if (!el) { el = h('div', 'am-note'); wrap.appendChild(el); }
        el.textContent = text || '';
        el.classList.toggle('am-bad', !!bad);
    }

    function rulesSection() {
        const wrap = section('Global rules',
            'Applied to every chat. Use it for style, language, and things the agent must never do.');
        const area = h('textarea', 'am-input');
        area.rows = 5;
        area.maxLength = M().LIMITS.rules;
        area.placeholder = 'e.g. Answer in English. Keep functions small. Never edit files under vendor/.';
        area.value = M().getRules();
        const save = h('button', 'am-btn am-primary', 'Save rules');
        save.type = 'button';
        save.addEventListener('click', () => {
            M().setRules(area.value);
            note(wrap, 'Saved.');
        });
        wrap.append(area, save);
        const projectNote = h('p', 'am-hint',
            'Project rules come from AGENTS.md at the top of the open project. Create or edit that file in the editor.');
        wrap.appendChild(projectNote);
        return wrap;
    }

    function memorySection(refresh) {
        const wrap = section('Memory',
            'Notes the agent saved with the remember tool. Delete any you do not want kept.');
        const items = M().listMemory();
        if (!items.length) {
            wrap.appendChild(h('p', 'am-empty', 'Nothing saved yet.'));
            return wrap;
        }
        const list = h('div', 'am-list');
        for (const item of items) {
            const row = h('div', 'am-row');
            row.appendChild(h('div', 'am-row-text', item.text));
            const del = h('button', 'am-btn am-danger', 'Delete');
            del.type = 'button';
            del.addEventListener('click', () => { M().forget(item.id); refresh(); });
            row.appendChild(del);
            list.appendChild(row);
        }
        wrap.appendChild(list);
        return wrap;
    }

    function skillsSection(refresh) {
        const wrap = section('Skills',
            'Named instructions. The agent sees the name and description, and loads the full text when it needs it.');
        for (const s of M().listSkills()) {
            const row = h('div', 'am-row');
            const text = h('div', 'am-row-text');
            text.appendChild(h('strong', '', s.name));
            text.appendChild(h('div', 'am-hint', s.description));
            row.appendChild(text);
            const del = h('button', 'am-btn am-danger', 'Delete');
            del.type = 'button';
            del.addEventListener('click', () => { M().deleteSkill(s.id); refresh(); });
            row.appendChild(del);
            wrap.appendChild(row);
        }

        const form = h('div', 'am-form');
        const name = h('input', 'am-input');
        name.placeholder = 'name, e.g. write-tests';
        name.maxLength = 40;
        const desc = h('input', 'am-input');
        desc.placeholder = 'When to use it, one line';
        desc.maxLength = 200;
        const body = h('textarea', 'am-input');
        body.rows = 4;
        body.placeholder = 'Instructions the agent should follow';
        body.maxLength = M().LIMITS.skillBody;
        const add = h('button', 'am-btn am-primary', 'Add skill');
        add.type = 'button';
        add.addEventListener('click', () => {
            const res = M().saveSkill({ name: name.value, description: desc.value, body: body.value });
            if (!res.ok) { note(wrap, res.error, true); return; }
            refresh();
        });
        form.append(name, desc, body, add);
        wrap.appendChild(form);
        wrap.appendChild(h('div', 'am-note'));
        return wrap;
    }

    function subagentsSection(refresh) {
        const SA = g.AgentSubagents;
        if (!SA) return section('Sub-agents', 'Not available in this build.');
        const wrap = section('Sub-agents',
            'A sub-agent works in its own context and returns one report to the chat. Built in: explore (read-only).');
        for (const a of SA.listAgents()) {
            const row = h('div', 'am-row');
            const text = h('div', 'am-row-text');
            text.appendChild(h('strong', '', a.name + (a.builtin ? ' (built in)' : '')));
            text.appendChild(h('div', 'am-hint', a.description + ' Tools: ' + a.tools.join(', ') + (a.model ? '. Model: ' + a.model : '')));
            row.appendChild(text);
            if (!a.builtin) {
                const del = h('button', 'am-btn am-danger', 'Delete');
                del.type = 'button';
                del.addEventListener('click', () => { SA.deleteCustom(a.id); refresh(); });
                row.appendChild(del);
            }
            wrap.appendChild(row);
        }
        const form = h('div', 'am-form');
        const name = h('input', 'am-input');
        name.placeholder = 'name, e.g. test-writer';
        name.maxLength = 40;
        const desc = h('input', 'am-input');
        desc.placeholder = 'What it is for, one line';
        desc.maxLength = 160;
        const prompt = h('textarea', 'am-input');
        prompt.rows = 3;
        prompt.placeholder = 'Instructions for this sub-agent';
        prompt.maxLength = 4000;
        const model = h('input', 'am-input');
        model.placeholder = 'Model (optional; blank uses the main model)';
        model.maxLength = 120;
        const toolsWrap = h('div', 'am-tools');
        const boxes = SA.availableTools().map(t => {
            const lab = h('label', 'am-check');
            const cb = h('input');
            cb.type = 'checkbox';
            cb.value = t;
            lab.append(cb, document.createTextNode(' ' + t));
            toolsWrap.appendChild(lab);
            return cb;
        });
        const add = h('button', 'am-btn am-primary', 'Add sub-agent');
        add.type = 'button';
        add.addEventListener('click', () => {
            const res = SA.saveCustom({
                name: name.value, description: desc.value, prompt: prompt.value, model: model.value,
                tools: boxes.filter(b => b.checked).map(b => b.value),
            });
            if (!res.ok) { note(wrap, res.error, true); return; }
            refresh();
        });
        form.append(name, desc, prompt, model, toolsWrap, add);
        wrap.append(form, h('div', 'am-note'));
        return wrap;
    }

    function open() {
        if (!M()) return;
        if (document.getElementById('amOverlay')) return;

        const overlay = h('div', 'am-overlay');
        overlay.id = 'amOverlay';
        const panel = h('div', 'am-panel');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', 'Rules and memory');

        const head = h('div', 'am-head');
        head.appendChild(h('h2', 'am-heading', 'Rules and memory'));
        const close = h('button', 'am-btn', 'Close');
        close.type = 'button';
        head.appendChild(close);
        panel.appendChild(head);

        const body = h('div', 'am-body');
        panel.appendChild(body);
        overlay.appendChild(panel);

        function close_() { overlay.remove(); document.removeEventListener('keydown', onKey); }
        function onKey(e) { if (e.key === 'Escape') close_(); }
        close.addEventListener('click', close_);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close_(); });
        document.addEventListener('keydown', onKey);

        function render() {
            body.innerHTML = '';
            body.append(rulesSection(), memorySection(render), skillsSection(render), subagentsSection(render));
        }
        render();
        document.body.appendChild(overlay);
        const first = panel.querySelector('textarea, input');
        if (first) first.focus();
    }

    function bind() {
        const btn = document.getElementById('agentRulesBtn');
        if (btn) btn.addEventListener('click', open);
    }

    g.AgentRulesPanel = { open };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
})(window);
