/*
 * agent-extras.js - AI agent features layered on ide.js:
 *  - model routing (planning vs editing model) and token/cost counter
 *  - @file mentions and pinned files as context
 *  - prompt templates, project presets
 *  - plan mode approval, Continue for truncated replies
 *  - live streaming bubble (SSE for OpenAI-compatible and Anthropic APIs)
 *  - offline queue for prompts, and recovery of unfinished replies
 *  - voice input (Capacitor speech plugin, or Web Speech API where available)
 *  - screenshot-to-code
 * Depends on ide.js globals: AI_AGENT, VFS, vfsFiles, agentInput, agentChatWindow...
 */
(function (g) {
    'use strict';

    const CTX_MARK = '\n\n[[CONTEXT FILES]]\n';
    const MAX_FILE_CTX = 12000;
    const MAX_TOTAL_CTX = 40000;

    const PLAN_PROMPT = `PLAN MODE. Do not call any tools and do not write files in this reply.
Reply with a short numbered plan: each step, the files it creates or changes, and any risk.
Keep it concise. End with the line: Reply "Approve" to start, or tell me what to change.`;

    const cost = TokenCost.createCounter();
    const queue = OfflineQueue.createQueue(STORAGE);
    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };

    // ---------- routing and cost ----------
    function routing() {
        const get = (k) => (STORAGE.getItem(k) || '').trim();
        return { planModel: get('ide_plan_model'), editModel: get('ide_edit_model') };
    }

    function saveRouting() {
        STORAGE.setItem('ide_plan_model', document.getElementById('planModelInput').value.trim());
        STORAGE.setItem('ide_edit_model', document.getElementById('editModelInput').value.trim());
    }

    function recordUsage(usage, model, provider) {
        cost.add(usage, model, provider);
        updateCostLabel();
    }

    function updateCostLabel() {
        const s = cost.summary();
        const node = document.getElementById('tokenUsageDisplay');
        if (!node) return;
        const usd = s.unknown && s.usd === 0 ? 'n/a' : TokenCost.formatUsd(s.usd) + (s.unknown ? '+' : '');
        node.textContent = `Tokens: ${s.total.toLocaleString()} · est. ${usd}`;
        node.title = cost.totals().map(t => `${t.model}: ${t.input} in / ${t.output} out`).join('\n') || 'No usage yet';
    }

    // ---------- context: @mentions and pins ----------
    function pins() {
        try { return JSON.parse(STORAGE.getItem('ide_pinned_files') || '[]'); } catch (e) { return []; }
    }

    function setPins(list) {
        STORAGE.setItem('ide_pinned_files', JSON.stringify(list));
        renderPins();
    }

    function togglePin(path) {
        if (!path || !vfsFiles[path]) { notifyWarning('Open a file first.'); return; }
        const list = pins();
        setPins(list.includes(path) ? list.filter(p => p !== path) : [...list, path]);
    }

    function renderPins() {
        const bar = document.getElementById('pinnedBar');
        if (!bar) return;
        const list = pins().filter(p => vfsFiles[p]);
        bar.innerHTML = '';
        bar.classList.toggle('hidden', list.length === 0);
        for (const p of list) {
            const chip = el('span', 'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-200 border border-amber-800');
            chip.append(el('span', 'font-mono', '📌 ' + p));
            const x = el('button', 'text-amber-300 hover:text-white px-1', '✕');
            x.type = 'button';
            x.setAttribute('aria-label', 'Unpin ' + p);
            x.addEventListener('click', () => togglePin(p));
            chip.appendChild(x);
            bar.appendChild(chip);
        }
    }

    function mentionedPaths(text) {
        const found = [];
        const re = /@([^\s@]+)/g;
        let m;
        while ((m = re.exec(text)) !== null) {
            const p = m[1].replace(/[.,;:!?)]+$/, '');
            if (vfsFiles[p] && !found.includes(p)) found.push(p);
        }
        return found;
    }

    /** Builds the context block appended to the message sent to the model. */
    function buildContext(text) {
        const paths = [...pins(), ...mentionedPaths(text || '')].filter((p, i, a) => vfsFiles[p] && a.indexOf(p) === i);
        if (!paths.length) return '';
        let total = 0;
        const parts = [];
        for (const p of paths) {
            const content = String(vfsFiles[p].content || '');
            const body = content.length > MAX_FILE_CTX ? content.slice(0, MAX_FILE_CTX) + '\n… (truncated)' : content;
            if (total + body.length > MAX_TOTAL_CTX) break;
            total += body.length;
            parts.push(`--- ${p} ---\n${body}`);
        }
        return CTX_MARK + parts.join('\n\n');
    }

    /** Removes attached context from older messages so history stays small. */
    function stripContext(content) {
        if (typeof content === 'string') {
            const i = content.indexOf(CTX_MARK);
            return i === -1 ? content : content.slice(0, i);
        }
        if (Array.isArray(content)) {
            return content.map(part => (part && part.type === 'text' ? { ...part, text: stripContext(part.text) } : part));
        }
        return content;
    }

    function withContext(content, ctx) {
        if (!ctx) return content;
        if (typeof content === 'string') return content + ctx;
        if (Array.isArray(content)) {
            const copy = content.map(p => ({ ...p }));
            const t = copy.find(p => p.type === 'text');
            if (t) t.text += ctx; else copy.unshift({ type: 'text', text: ctx.trim() });
            return copy;
        }
        return content;
    }

    // ---------- @mention menu ----------
    let mentionIndex = 0;
    let mentionItems = [];

    function currentMentionToken() {
        const pos = agentInput.selectionStart || 0;
        const before = agentInput.value.slice(0, pos);
        const m = /(^|\s)@([^\s@]*)$/.exec(before);
        if (!m) return null;
        return { start: pos - m[2].length - 1, end: pos, query: m[2] };
    }

    function updateMentionMenu() {
        const menu = document.getElementById('mentionMenu');
        const tok = currentMentionToken();
        if (!tok) { menu.classList.add('hidden'); return; }
        const q = tok.query.toLowerCase();
        mentionItems = Object.keys(vfsFiles).filter(p => p.toLowerCase().includes(q)).sort().slice(0, 12);
        if (!mentionItems.length) { menu.classList.add('hidden'); return; }
        mentionIndex = Math.min(mentionIndex, mentionItems.length - 1);
        menu.innerHTML = '';
        mentionItems.forEach((p, i) => {
            const row = el('button', 'w-full text-left px-3 py-2 text-xs font-mono text-gray-200 hover:bg-gray-800 ' + (i === mentionIndex ? 'bg-gray-800' : ''), p);
            row.type = 'button';
            row.addEventListener('mousedown', (e) => { e.preventDefault(); insertMention(p); });
            menu.appendChild(row);
        });
        menu.classList.remove('hidden');
    }

    function insertMention(path) {
        const tok = currentMentionToken();
        if (!tok) return;
        const v = agentInput.value;
        agentInput.value = v.slice(0, tok.start) + '@' + path + ' ' + v.slice(tok.end);
        const caret = tok.start + path.length + 2;
        agentInput.setSelectionRange(caret, caret);
        document.getElementById('mentionMenu').classList.add('hidden');
        agentInput.focus();
    }

    function handleMentionKeys(e) {
        const menu = document.getElementById('mentionMenu');
        if (menu.classList.contains('hidden') || !mentionItems.length) return false;
        if (e.key === 'ArrowDown') { mentionIndex = (mentionIndex + 1) % mentionItems.length; updateMentionMenu(); e.preventDefault(); return true; }
        if (e.key === 'ArrowUp') { mentionIndex = (mentionIndex - 1 + mentionItems.length) % mentionItems.length; updateMentionMenu(); e.preventDefault(); return true; }
        if (e.key === 'Enter' || e.key === 'Tab') { insertMention(mentionItems[mentionIndex]); e.preventDefault(); return true; }
        if (e.key === 'Escape') { menu.classList.add('hidden'); return true; }
        return false;
    }

    // ---------- templates and presets ----------
    function showMenu(id, items) {
        const menu = document.getElementById(id);
        menu.innerHTML = '';
        for (const it of items) {
            const row = el('button', 'w-full text-left px-3 py-2 hover:bg-gray-800 border-b border-gray-800 last:border-0');
            row.type = 'button';
            row.append(el('div', 'text-xs font-semibold text-gray-200', it.label));
            if (it.description) row.append(el('div', 'text-[11px] text-gray-500', it.description));
            row.addEventListener('click', () => { menu.classList.add('hidden'); it.onPick(); });
            menu.appendChild(row);
        }
        menu.classList.remove('hidden');
    }

    function insertTemplate(tpl) {
        agentInput.value = tpl.text;
        agentInput.focus();
        agentInput.setSelectionRange(0, 0);
        agentInput.dispatchEvent(new Event('input'));
    }

    async function applyPreset(preset) {
        const names = Object.keys(preset.files);
        const clash = names.filter(n => vfsFiles[n]);
        if (clash.length && !window.confirm(`Replace ${clash.join(', ')} in this project?`)) return;
        for (const name of names) await VFS.writeFile(name, preset.files[name]);
        if (typeof renderFileTree === 'function') renderFileTree();
        const first = names.find(n => /index\.html$/.test(n)) || names[0];
        if (typeof MONACO !== 'undefined') await MONACO.openFile(first);
        if (g.MobileIDE) MobileIDE.show('code');
        notifyInfo(`Created ${names.length} files from “${preset.label}”.`);
    }

    // ---------- chat helpers ----------
    function chatNode(node) {
        const w = document.getElementById('agentChatWindow');
        w.appendChild(node);
        w.scrollTop = w.scrollHeight;
        return node;
    }

    function showPlanApproval(planText) {
        const box = chatNode(el('div', 'bg-violet-950/40 border border-violet-800 rounded-lg p-3 text-xs space-y-2'));
        box.appendChild(el('div', 'font-semibold text-violet-200', 'Plan ready. Nothing has been changed yet.'));
        const row = el('div', 'flex gap-2');
        const approve = el('button', 'px-3 py-1.5 rounded bg-emerald-700 text-white text-xs', 'Approve and run');
        approve.type = 'button';
        approve.addEventListener('click', () => {
            box.remove();
            AI_AGENT.sendMessage('Approved. Carry out the plan now, step by step, using the tools.', { approved: true });
        });
        const revise = el('button', 'px-3 py-1.5 rounded bg-gray-800 text-gray-200 text-xs', 'Revise');
        revise.type = 'button';
        revise.addEventListener('click', () => { box.remove(); agentInput.focus(); });
        row.append(approve, revise);
        box.appendChild(row);
    }

    function showContinue(visible) {
        const btn = document.getElementById('continueBtn');
        if (btn) btn.classList.toggle('hidden', !visible);
    }

    /** Assistant bubble that fills in while the reply streams. */
    function beginLiveBubble(sessionId) {
        const bubble = chatNode(el('div', 'bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-sm mr-8'));
        bubble.appendChild(el('div', 'font-semibold text-xs mb-1 text-gray-400', 'Assistant'));
        const body = el('div', 'text-gray-200 whitespace-pre-wrap break-words text-[13px]');
        bubble.appendChild(body);
        let lastSave = 0;
        const done = () => { queue.clearPartial(); };
        return {
            update(text) {
                body.textContent = text;
                document.getElementById('agentChatWindow').scrollTop = 1e9;
                // Autosave: at most once per second, so a dropped connection keeps the reply so far.
                const now = Date.now();
                if (sessionId && now - lastSave > 1000) { queue.savePartial(sessionId, text); lastSave = now; }
            },
            finish(finalText) { bubble.remove(); done(); if (finalText) AI_AGENT.addMessageToChat('assistant', finalText); },
            remove() { bubble.remove(); done(); }
        };
    }

    function notice(text, cls) {
        return chatNode(el('div', cls || 'text-xs text-gray-400 italic px-1', text));
    }

    // ---------- streaming (OpenAI-compatible and Anthropic SSE) ----------
    async function streamRequest({ url, headers, body, anthropic, signal, onDelta }) {
        let resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }), signal });
        if (!resp.ok && resp.status === 400 && body.stream_options) {
            // Some OpenAI-compatible servers reject stream_options; retry without usage streaming.
            const { stream_options: _drop, ...rest } = body;
            resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...rest, stream: true }), signal });
        }
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            let j = {};
            try { j = JSON.parse(text); } catch (e) { /* not json */ }
            throw new Error(`API Error (${resp.status}): ${j.error?.message || j.message || text.slice(0, 200) || 'request failed'}`);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let content = '';
        let usage = null;
        let finishReason = null;

        const handle = (line) => {
            if (!line.startsWith('data:')) return;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') return;
            let j;
            try { j = JSON.parse(data); } catch (e) { return; }
            if (anthropic) {
                if (j.type === 'message_start' && j.message?.usage) usage = { ...(usage || {}), input_tokens: j.message.usage.input_tokens || 0 };
                if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') { content += j.delta.text; onDelta(content, j.delta.text); }
                if (j.type === 'message_delta') {
                    if (j.delta?.stop_reason) finishReason = j.delta.stop_reason;
                    if (j.usage) usage = { ...(usage || {}), output_tokens: j.usage.output_tokens || 0 };
                }
            } else {
                const choice = j.choices && j.choices[0];
                const piece = choice?.delta?.content;
                if (piece) { content += piece; onDelta(content, piece); }
                if (choice?.finish_reason) finishReason = choice.finish_reason;
                if (j.usage) usage = j.usage;
            }
        };

        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let idx;
                while ((idx = buffer.indexOf('\n')) !== -1) {
                    handle(buffer.slice(0, idx).trim());
                    buffer = buffer.slice(idx + 1);
                }
            }
            if (buffer.trim()) handle(buffer.trim());
        } catch (e) {
            // Stop pressed mid-stream: keep what arrived so far.
            if (e.name !== 'AbortError') throw e;
            return { content, usage: null, finishReason: 'aborted', aborted: true };
        }
        if (!usage) usage = { prompt_tokens: 0, completion_tokens: Math.ceil(content.length / 4), estimated: true };
        return { content, usage, finishReason };
    }

    // ---------- offline queue and recovery ----------
    function isNetworkError(e) {
        if (!e) return false;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
        return e instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(e.message || '');
    }

    function queueOffline(sessionId, text) {
        queue.enqueue({ sessionId, text });
        notice('Offline. Your message is queued and will be sent when the connection returns.', 'text-xs text-amber-300 bg-amber-950/30 border border-amber-900 rounded p-2');
        renderQueueBadge();
    }

    function renderQueueBadge() {
        const n = queue.list().length;
        const btn = document.getElementById('sendAgentBtn');
        if (btn) btn.title = n ? `${n} message(s) waiting to send` : 'Send';
    }

    async function processQueue() {
        if (typeof isAgentProcessing !== 'undefined' && isAgentProcessing) return;
        if (navigator.onLine === false) return;
        for (const item of queue.list()) {
            if (typeof selectAgentSession === 'function') selectAgentSession(item.sessionId);
            const result = await AI_AGENT.sendMessage(item.text, { resend: true, fromQueue: true });
            if (result === 'queued') break;   // still offline
            queue.remove(item.id);
        }
        renderQueueBadge();
    }

    function checkPartialReply() {
        const partial = queue.loadPartial();
        if (!partial || !partial.text) return;
        const box = chatNode(el('div', 'bg-amber-950/30 border border-amber-900 rounded-lg p-3 text-xs space-y-2'));
        box.appendChild(el('div', 'text-amber-200', `An unfinished reply was saved (${partial.text.length} characters) before the app closed.`));
        const row = el('div', 'flex gap-2');
        const keep = el('button', 'px-3 py-1.5 rounded bg-gray-800 text-gray-200', 'Keep as message');
        keep.type = 'button';
        keep.addEventListener('click', () => {
            const s = getActiveAgentSession();
            if (s && partial.sessionId === s.id) { s.messages.push({ role: 'assistant', content: partial.text + '\n\n_(partial, recovered)_' }); saveAgentSessionsToStorage(); }
            queue.clearPartial(); box.remove();
            AI_AGENT.addMessageToChat('assistant', partial.text);
        });
        const discard = el('button', 'px-3 py-1.5 rounded bg-gray-800 text-gray-400', 'Discard');
        discard.type = 'button';
        discard.addEventListener('click', () => { queue.clearPartial(); box.remove(); });
        row.append(keep, discard);
        box.appendChild(row);
    }

    // ---------- voice input ----------
    function initVoice() {
        const btn = document.getElementById('voiceBtn');
        if (!btn) return;
        const P = g.HubPlatform;
        const plugin = P && P.isNative ? P.plugin('SpeechRecognition') : null;
        const Web = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!plugin && !Web) { btn.hidden = true; return; }
        let listening = false;
        let base = '';
        let webRec = null;

        const stop = async () => {
            listening = false;
            btn.textContent = '🎤 Voice';
            if (plugin) { try { await plugin.stop(); } catch (e) { /* already stopped */ } }
            if (webRec) { webRec.stop(); webRec = null; }
        };

        btn.addEventListener('click', async () => {
            if (listening) { await stop(); return; }
            base = agentInput.value ? agentInput.value.trimEnd() + ' ' : '';
            try {
                if (plugin) {
                    const perm = await plugin.requestPermissions();
                    if (perm && perm.speechRecognition === 'denied') { notifyWarning('Microphone permission is needed for voice input.'); return; }
                    await plugin.addListener('partialResults', (d) => {
                        if (d && d.matches && d.matches.length) agentInput.value = base + d.matches[0];
                    });
                    await plugin.start({ language: navigator.language || 'en-US', partialResults: true, popup: false });
                } else {
                    webRec = new Web();
                    webRec.lang = navigator.language || 'en-US';
                    webRec.interimResults = true;
                    webRec.continuous = true;
                    webRec.onresult = (e) => {
                        let text = '';
                        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
                        agentInput.value = base + text;
                    };
                    webRec.onend = () => { listening = false; btn.textContent = '🎤 Voice'; };
                    webRec.start();
                }
                listening = true;
                btn.textContent = '⏹ Stop';
            } catch (e) {
                notifyWarning('Voice input is not available: ' + (e.message || e));
            }
        });
    }

    // ---------- screenshot to code ----------
    function initScreenshot() {
        const btn = document.getElementById('screenshotBtn');
        const input = document.getElementById('screenshotInput');
        if (!btn || !input) return;
        btn.addEventListener('click', () => input.click());
        input.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            input.value = '';
            if (!file) return;
            await AI_AGENT.handleAttachmentFile(file);
            const tpl = HubPresets.PROMPT_TEMPLATES.find(t => t.id === 'screenshot');
            agentInput.value = tpl.text;
            agentInput.focus();
            notifyInfo('Screenshot attached. Check the prompt, then press Send.');
        });
    }

    // ---------- error to agent ----------
    function fixError(entry) {
        const files = Object.keys(vfsFiles).filter(p => /\.(html?|js|css)$/i.test(p)).slice(0, 20);
        const tpl = HubPresets.PROMPT_TEMPLATES.find(t => t.id === 'fix-error');
        const text = HubPresets.fillTemplate(tpl.text, { error: entry.text })
            + `\n\nProject files: ${files.join(', ') || '(none)'}`;
        if (g.MobileIDE) MobileIDE.show('chat');
        if (typeof isAgentProcessing !== 'undefined' && isAgentProcessing) { notifyWarning('The agent is busy. Try again in a moment.'); return; }
        AI_AGENT.sendMessage(text);
    }

    // ---------- wiring ----------
    function init() {
        const $ = (id) => document.getElementById(id);

        // Routing inputs
        const r = routing();
        $('planModelInput').value = r.planModel;
        $('editModelInput').value = r.editModel;
        ['planModelInput', 'editModelInput'].forEach(id => $(id).addEventListener('change', saveRouting));
        const ap = $('autoPreviewToggle');
        ap.checked = STORAGE.getItem('ide_auto_preview') !== 'off';
        ap.addEventListener('change', () => STORAGE.setItem('ide_auto_preview', ap.checked ? 'on' : 'off'));
        $('planModeToggle').checked = STORAGE.getItem('ide_plan_mode') === 'on';
        $('planModeToggle').addEventListener('change', (e) => STORAGE.setItem('ide_plan_mode', e.target.checked ? 'on' : 'off'));

        // Mentions
        agentInput.addEventListener('input', updateMentionMenu);
        agentInput.addEventListener('click', updateMentionMenu);
        agentInput.addEventListener('keydown', (e) => { if (handleMentionKeys(e)) e.stopImmediatePropagation(); }, true);

        // Templates
        $('templatesBtn').addEventListener('click', () => {
            const menu = $('templatesMenu');
            if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
            showMenu('templatesMenu', HubPresets.PROMPT_TEMPLATES.map(t => ({ label: t.label, description: t.text.slice(0, 70) + '…', onPick: () => insertTemplate(t) })));
        });

        // Presets
        $('presetsBtn').addEventListener('click', () => {
            const menu = $('templatesMenu');
            if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
            showMenu('templatesMenu', HubPresets.PRESETS.map(p => ({ label: p.label, description: p.description, onPick: () => applyPreset(p) })));
            menu.style.left = 'auto';
        });

        $('pinFileBtn').addEventListener('click', () => togglePin(activeFilePath));
        renderPins();

        // Continue
        $('continueBtn').addEventListener('click', () => {
            showContinue(false);
            AI_AGENT.sendMessage('Continue exactly where you stopped. Do not repeat earlier text.');
        });

        initVoice();
        initScreenshot();

        window.addEventListener('online', () => { notifyInfo('Back online. Sending queued messages.'); processQueue(); });
        window.addEventListener('offline', () => notifyWarning('Connection lost. New messages will be queued.'));
        checkPartialReply();
        processQueue();
        updateCostLabel();
    }

    g.AgentExtras = {
        PLAN_PROMPT, CTX_MARK, cost, routing, recordUsage, updateCostLabel,
        buildContext, withContext, stripContext, mentionedPaths,
        togglePin, renderPins, insertTemplate, applyPreset,
        showPlanApproval, showContinue, beginLiveBubble, notice,
        streamRequest, isNetworkError, queueOffline, queue, processQueue,
        fixError, init
    };
})(typeof window !== 'undefined' ? window : globalThis);
