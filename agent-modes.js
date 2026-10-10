/*
 * Agent modes for the IDE agent: BUILD, PLAN and AUTO.
 *
 *   BUILD  All tools. run_command asks for approval (default).
 *   PLAN   Read-only. list_files and read_file run; every other tool is blocked
 *          in the tool loop, so writes and commands never run, whatever the model asks.
 *   AUTO   All tools. run_command runs without the approval card; the card still
 *          appears with the output. Commands stay limited to /root/projects.
 *
 * The mode is stored per device. "Plan first" in the composer is a separate setting:
 * it drafts a plan and waits for approval before any edit.
 *
 * The mode model follows AiCode's BUILD / PLAN / AUTO modes (GPL-3.0, see
 * THIRD_PARTY_NOTICES.md). This file is written for this project.
 */
(function (g) {
    'use strict';

    const KEY = 'ide_agent_mode';
    const MODES = ['BUILD', 'PLAN', 'AUTO'];
    const LABELS = { BUILD: 'Build', PLAN: 'Plan', AUTO: 'Auto' };
    // Read tools, plus memory and skills (they change app storage, not project files).
    const ALLOWED_IN_PLAN = new Set(['list_files', 'read_file', 'remember', 'forget', 'load_skill']);

    function current() {
        let m = null;
        try { m = localStorage.getItem(KEY); } catch (e) { /* storage unavailable */ }
        return MODES.includes(m) ? m : 'BUILD';
    }

    function set(mode) {
        if (!MODES.includes(mode)) return;
        try { localStorage.setItem(KEY, mode); } catch (e) { /* ignore */ }
        render();
    }

    function next() {
        set(MODES[(MODES.indexOf(current()) + 1) % MODES.length]);
    }

    // Returns a message to send back to the model in place of the tool result,
    // or null when the tool may run.
    function gate(name) {
        if (current() === 'PLAN' && !ALLOWED_IN_PLAN.has(name)) {
            return 'Blocked: "' + name + '" changes files or runs commands, and PLAN mode is read-only. ' +
                'Describe the change instead, or ask the user to switch to Build mode.';
        }
        return null;
    }

    function autoApprove() {
        return current() === 'AUTO';
    }

    function promptNote() {
        const m = current();
        if (m === 'PLAN') {
            return 'Mode: PLAN. You are read-only. You may use list_files, read_file, remember, forget and load_skill. ' +
                'Do not write, edit, rename or run commands; describe the changes instead.';
        }
        if (m === 'AUTO') {
            return 'Mode: AUTO. Tools run without asking the user first, except that run_command is limited to /root/projects. Keep changes small and say what you ran.';
        }
        return 'Mode: BUILD. Tools may change files. run_command needs the user to approve each command.';
    }

    function render() {
        const btn = document.getElementById('agentModeBtn');
        if (!btn) return;
        const m = current();
        btn.textContent = LABELS[m];
        btn.dataset.mode = m;
        btn.title = 'Agent mode: ' + m.toLowerCase() + '. Tap to switch (Build, Plan, Auto).';
        btn.setAttribute('aria-label', 'Agent mode ' + LABELS[m] + '. Tap to change.');
    }

    g.AgentModes = { MODES, LABELS, current, set, next, gate, autoApprove, promptNote, render };

    function init() {
        const btn = document.getElementById('agentModeBtn');
        if (btn) btn.addEventListener('click', next);
        render();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window);
