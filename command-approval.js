/*
 * command-approval.js - the agent's run_command tool.
 *
 * Runs a shell command inside the Linux root filesystem (LinuxShell.run). Only available
 * in the Android app. Every command waits for the user to press Run in the chat. Denied
 * commands are never run, and an unanswered request is denied after 10 minutes.
 *
 * Loaded after ide.js: it reads AI_AGENT and agentChatWindow from that file.
 */
(function (g) {
    'use strict';

    const PROJECTS = '/root/projects';
    const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
    const MODEL_OUTPUT_CHARS = 12000;
    const MAX_COMMAND_CHARS = 2000;

    function linuxShell() {
        const cap = g.Capacitor;
        if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
        return cap.Plugins && cap.Plugins.LinuxShell ? cap.Plugins.LinuxShell : null;
    }

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function json(obj) {
        return JSON.stringify(obj, null, 2);
    }

    function cleanOutput(text) {
        return String(text || '')
            .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
            .replace(/\r\n?/g, '\n');
    }

    /** Keeps the end of long output, because that is where errors and results usually are. */
    function tailForModel(text) {
        const clean = cleanOutput(text);
        if (clean.length <= MODEL_OUTPUT_CHARS) return clean;
        return '[earlier output truncated]\n' + clean.slice(-MODEL_OUTPUT_CHARS);
    }

    function cwdAllowed(cwd) {
        return typeof cwd === 'string' && (cwd === PROJECTS || cwd.indexOf(PROJECTS + '/') === 0)
            && cwd.split('/').indexOf('..') === -1 && cwd.indexOf('\0') === -1;
    }

    /**
     * Shows the approval card in the chat. Returns { approved: Promise<boolean>, showResult, showError }.
     */
    function requestApproval(command, cwd, autoRun) {
        const win = typeof agentChatWindow !== 'undefined' ? agentChatWindow : null;
        let resolve;
        const approved = new Promise((r) => { resolve = r; });
        let settled = false;
        const settle = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        const timer = setTimeout(() => {
            setStatus('No answer in 10 minutes. Not run.');
            settle(false);
        }, APPROVAL_TIMEOUT_MS);

        const card = el('div', 'command-card bg-gray-900 border border-amber-700/60 rounded-lg p-3 text-sm space-y-2');
        card.appendChild(el('div', 'font-semibold text-xs text-amber-300', 'The agent wants to run a command in Linux'));
        card.appendChild(el('div', 'text-xs text-gray-400', 'Folder: ' + cwd));
        const pre = el('pre', 'text-xs bg-black/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all', command);
        card.appendChild(pre);
        const buttons = el('div', 'flex gap-2');
        const runBtn = el('button', 'px-3 py-1.5 rounded bg-emerald-700 text-white text-xs', 'Run');
        const denyBtn = el('button', 'px-3 py-1.5 rounded bg-gray-700 text-white text-xs', 'Deny');
        runBtn.type = 'button';
        denyBtn.type = 'button';
        buttons.append(runBtn, denyBtn);
        card.appendChild(buttons);
        const status = el('div', 'text-xs text-gray-400');
        card.appendChild(status);
        if (autoRun) {
            decided('Auto mode: running without asking.');
            settle(true);
        }

        function setStatus(text) {
            status.textContent = text;
        }
        function decided(text) {
            runBtn.disabled = true;
            denyBtn.disabled = true;
            setStatus(text);
        }
        runBtn.addEventListener('click', () => {
            decided('Running…');
            settle(true);
        });
        denyBtn.addEventListener('click', () => {
            decided('Denied. Not run.');
            settle(false);
        });

        if (win) {
            win.appendChild(card);
            win.scrollTop = win.scrollHeight;
        }

        return {
            approved,
            showResult(res) {
                const ok = res.code === 0 && !res.timedOut;
                setStatus((res.timedOut ? 'Timed out' : 'Exit code ' + res.code) + (ok ? '' : ' (failed)'));
                const details = el('details', 'text-xs');
                details.appendChild(el('summary', 'text-gray-400 cursor-pointer', 'Output'));
                details.appendChild(el('pre', 'bg-black/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all',
                    tailForModel(res.output) || '(no output)'));
                card.appendChild(details);
                if (win) win.scrollTop = win.scrollHeight;
            },
            showError(message) {
                setStatus('Failed: ' + message);
                if (win) win.scrollTop = win.scrollHeight;
            },
            decided,
        };
    }

    const tool = {
        name: 'run_command',
        description: 'Runs one shell command (/bin/sh, Alpine Linux) inside the Linux environment, in a folder under '
            + '/root/projects. Use it for git, apk, make, npm and other build tools. The user must approve each command '
            + 'before it runs. Returns the exit code and output (the last 12,000 characters).',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The command line to run, for example "git status"' },
                cwd: { type: 'string', description: 'Working folder, under /root/projects. Default: /root/projects' },
                timeoutSec: { type: 'number', description: 'Time limit in seconds (1-1800). Default 300.' },
            },
            required: ['command'],
            additionalProperties: false,
        },
        execute: async (input) => {
            const args = input || {};
            const LS = linuxShell();
            if (!LS) {
                return json({ success: false, error: 'The Linux environment is only available in the Android app.' });
            }
            const command = String((args && args.command) || '').trim();
            if (!command) return json({ success: false, error: 'No command given.' });
            if (command.length > MAX_COMMAND_CHARS) {
                return json({ success: false, error: 'Command is longer than ' + MAX_COMMAND_CHARS + ' characters.' });
            }
            const cwd = args.cwd === undefined || args.cwd === '' ? PROJECTS : args.cwd;
            if (!cwdAllowed(cwd)) {
                return json({ success: false, error: 'Folder must be /root/projects or a folder under it.' });
            }
            const status = await LS.status().catch(() => ({ installed: false }));
            if (!status.installed) {
                return json({ success: false, error: 'Linux is not installed. The user can install it from the Terminal page.' });
            }

            const autoRun = !!(g.AgentModes && g.AgentModes.autoApprove());
            const request = requestApproval(command, cwd, autoRun);
            const ok = await request.approved;
            if (!ok) {
                return json({ success: false, denied: true, error: 'The user did not approve this command. Do not retry it without asking.' });
            }
            const timeoutSec = Math.max(1, Math.min(Number(args.timeoutSec) || 300, 1800));
            try {
                const res = await LS.run({ command, cwd, timeoutSec });
                request.showResult(res);
                return json({
                    success: res.code === 0 && !res.timedOut,
                    exitCode: res.code,
                    timedOut: !!res.timedOut,
                    output: tailForModel(res.output),
                });
            } catch (e) {
                const message = e && e.message ? e.message : String(e);
                request.showError(message);
                return json({ success: false, error: message });
            }
        },
    };

    g.CommandApproval = { tool, available: () => !!linuxShell(), tailForModel, cwdAllowed };

    if (linuxShell() && typeof AI_AGENT !== 'undefined' && AI_AGENT && Array.isArray(AI_AGENT.tools)) {
        AI_AGENT.tools.push(tool);
    }
})(window);
