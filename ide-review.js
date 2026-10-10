/*
 * ide-review.js - AI change review: every file the agent writes is recorded
 * with its previous content. Each turn shows a card with a per-file diff and
 * Accept / Reject buttons. "Undo last AI change" reverts the newest change.
 * Depends on globals from ide.js (VFS, vfsFiles, agentChatWindow, MONACO) and
 * db-connector.js (STORAGE), all loaded before this file.
 */
(function (g) {
    'use strict';

    const LOG_KEY = 'ide_change_log';
    const MAX_GROUPS = 30;
    const CKPT_KEY = 'ide_checkpoints';
    const MAX_CHECKPOINTS = 30;

    let log = [];          // change groups, oldest first
    let turn = null;       // { id, groups: { path: group } } while an agent turn runs
    let lastTouched = [];  // paths changed in the last finished turn
    let checkpoints = [];  // { id, sessionId, chatLength, label, ts, restored } one per sent message

    function uid() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

    function load() {
        try { log = JSON.parse(STORAGE.getItem(LOG_KEY) || '[]'); } catch (e) { log = []; }
        if (!Array.isArray(log)) log = [];
    }

    function save() {
        log = log.slice(-MAX_GROUPS);
        STORAGE.setItem(LOG_KEY, JSON.stringify(log));
    }

    function loadCheckpoints() {
        try { checkpoints = JSON.parse(STORAGE.getItem(CKPT_KEY) || '[]'); } catch (e) { checkpoints = []; }
        if (!Array.isArray(checkpoints)) checkpoints = [];
    }

    function saveCheckpoints() {
        checkpoints = checkpoints.slice(-MAX_CHECKPOINTS);
        STORAGE.setItem(CKPT_KEY, JSON.stringify(checkpoints));
    }

    function isActive(group) { return group.status === 'pending' || group.status === 'accepted'; }

    /** True when no newer active change touches the same file (safe to restore). */
    function isLatestForPath(group) {
        const idx = log.indexOf(group);
        return !log.slice(idx + 1).some(g2 => g2.path === group.path && isActive(g2));
    }

    /** Starts a turn. meta = { sessionId, chatLength, label } records a checkpoint for this message. */
    function beginTurn(meta) {
        turn = { id: uid(), groups: {} };
        if (meta && meta.sessionId) {
            checkpoints.push({
                id: turn.id,
                sessionId: meta.sessionId,
                chatLength: Math.max(0, Number(meta.chatLength) || 0),
                label: String(meta.label || '').slice(0, 80),
                ts: Date.now(),
                restored: false,
            });
            saveCheckpoints();
        }
    }

    /**
     * Restores a checkpoint: code undoes every active change from that turn (newest first),
     * chat cuts the session back to the message count saved when the message was sent.
     */
    async function restoreCheckpoint(id, opts) {
        const ck = checkpoints.find(c => c.id === id);
        if (!ck) return { ok: false, reason: 'Checkpoint not found.' };
        const wantCode = !!(opts && opts.code);
        const wantChat = !!(opts && opts.chat);
        let codeUndone = 0;
        const conflicts = [];
        if (wantCode) {
            for (let i = log.length - 1; i >= 0; i--) {
                const grp = log[i];
                if (grp.turnId !== id || !isActive(grp)) continue;
                if (!isLatestForPath(grp)) { conflicts.push(grp.path); continue; }
                await restore(grp);
                grp.status = 'undone';
                codeUndone++;
            }
            save();
        }
        let chatRestored = false;
        if (wantChat && typeof g.ChangeReview.onRestoreChat === 'function') {
            chatRestored = g.ChangeReview.onRestoreChat(ck.sessionId, ck.chatLength) !== false;
        }
        ck.restored = true;
        saveCheckpoints();
        if (conflicts.length) {
            return { ok: false, reason: 'Newer changes touch ' + conflicts.join(', ') + '. Undo those first.', codeUndone, chatRestored };
        }
        if (wantChat && !chatRestored) {
            return { ok: false, reason: 'Chat cannot be restored while the agent is running.', codeUndone, chatRestored };
        }
        return { ok: true, codeUndone, chatRestored };
    }

    /** Writes an AI change: remembers the previous content first. */
    async function write(path, content) {
        const existing = vfsFiles[path];
        const before = existing ? existing.content : null;
        if (!turn) beginTurn();
        let group = turn.groups[path];
        if (!group) {
            group = { id: uid(), turnId: turn.id, path, before, after: content, status: 'pending', ts: Date.now() };
            turn.groups[path] = group;
            log.push(group);
        } else {
            group.after = content;
        }
        await VFS.writeFile(path, content);
        save();
        return group;
    }

    /** Ends the turn: shows the review card and triggers auto-preview. */
    function endTurn() {
        if (!turn) return;
        const groups = Object.values(turn.groups);
        turn = null;
        if (!groups.length) { lastTouched = []; return; }
        lastTouched = groups.map(x => x.path);
        save();
        renderCard(groups);
        if (g.PreviewConsole && typeof g.PreviewConsole.onAiChange === 'function') {
            g.PreviewConsole.onAiChange(lastTouched);
        }
    }

    async function restore(group) {
        if (group.before === null) {
            await VFS.deleteFile(group.path);
            if (openFiles.includes(group.path) && typeof MONACO !== 'undefined') MONACO.closeFile(group.path);
        } else {
            await VFS.writeFile(group.path, group.before);
        }
    }

    async function accept(group) {
        group.status = 'accepted';
        save();
    }

    async function reject(group) {
        if (!isActive(group)) return { ok: false, reason: 'Already handled.' };
        if (!isLatestForPath(group)) return { ok: false, reason: 'Undo the newer change to this file first.' };
        await restore(group);
        group.status = 'rejected';
        save();
        return { ok: true };
    }

    /** One-tap undo: reverts the newest change that is still active. */
    async function undoLast() {
        for (let i = log.length - 1; i >= 0; i--) {
            const group = log[i];
            if (!isActive(group)) continue;
            await restore(group);
            group.status = 'undone';
            save();
            return { ok: true, path: group.path };
        }
        return { ok: false, reason: 'No AI change to undo.' };
    }

    function undoCount() { return log.filter(isActive).length; }

    // ---------- UI ----------

    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    function button(label, cls, onClick, disabled) {
        const b = el('button', cls, label);
        b.type = 'button';
        b.disabled = !!disabled;
        b.addEventListener('click', onClick);
        return b;
    }

    function diffNode(before, after) {
        const ops = LineDiff.hunks(LineDiff.diff(before === null ? '' : before, after === null ? '' : after), 2);
        const box = el('div', 'ai-diff font-mono text-[11px] leading-5 max-h-64 overflow-auto rounded bg-black/40 border border-gray-800 mt-2');
        if (ops.length > 4000) { box.textContent = 'File too large for an inline diff.'; return box; }
        for (const op of ops) {
            if (op.type === 'skip') { box.appendChild(el('div', 'text-gray-500 px-2', `… ${op.count} unchanged lines …`)); continue; }
            const sign = op.type === 'add' ? '+ ' : op.type === 'del' ? '- ' : '  ';
            const cls = op.type === 'add' ? 'bg-emerald-900/40 text-emerald-200 px-2 whitespace-pre'
                : op.type === 'del' ? 'bg-rose-900/40 text-rose-200 px-2 whitespace-pre'
                : 'text-gray-400 px-2 whitespace-pre';
            box.appendChild(el('div', cls, sign + op.text));
        }
        return box;
    }

    function renderCard(groups) {
        if (!agentChatWindow) return;
        const card = el('div', 'ai-review-card bg-gray-900 border border-violet-800/60 rounded-lg p-3 text-sm space-y-2');
        card.appendChild(el('div', 'font-semibold text-xs text-violet-300', `AI changed ${groups.length} file${groups.length === 1 ? '' : 's'}`));

        const rows = [];
        const refresh = () => {
            rows.forEach(r => r.update());
            updateUndoButton();
        };

        for (const group of groups) {
            const row = el('div', 'border border-gray-800 rounded p-2');
            const head = el('div', 'flex items-center gap-2 flex-wrap');
            const name = el('span', 'font-mono text-xs text-gray-200 truncate flex-1 min-w-0', group.path);
            const stats = LineDiff.stats(LineDiff.diff(group.before === null ? '' : group.before, group.after === null ? '' : group.after));
            const badge = el('span', 'text-[11px] text-gray-400', group.before === null ? 'new file' : `+${stats.added} −${stats.removed}`);
            const status = el('span', 'text-[11px]');
            head.append(name, badge, status);

            const actions = el('div', 'flex gap-2 mt-2 flex-wrap');
            let diff = null;
            const diffBtn = button('Show diff', 'text-xs px-2 py-1 rounded bg-gray-800 text-gray-200', () => {
                if (diff) { diff.remove(); diff = null; diffBtn.textContent = 'Show diff'; return; }
                diff = diffNode(group.before, group.after);
                row.appendChild(diff);
                diffBtn.textContent = 'Hide diff';
            });
            const acceptBtn = button('Accept', 'text-xs px-2 py-1 rounded bg-emerald-700 text-white', async () => { await accept(group); refresh(); });
            const rejectBtn = button('Reject', 'text-xs px-2 py-1 rounded bg-rose-800 text-white', async () => {
                const res = await reject(group);
                if (!res.ok) notifyStatus(res.reason);
                refresh();
            });
            actions.append(diffBtn, acceptBtn, rejectBtn);
            row.append(head, actions);

            rows.push({
                update() {
                    const map = { pending: ['Pending', 'text-violet-300'], accepted: ['Accepted', 'text-emerald-400'], rejected: ['Rejected', 'text-rose-400'], undone: ['Undone', 'text-gray-400'] };
                    const [label, cls] = map[group.status] || ['', ''];
                    status.textContent = label;
                    status.className = `text-[11px] ${cls}`;
                    const done = !isActive(group);
                    acceptBtn.disabled = done || group.status === 'accepted';
                    rejectBtn.disabled = done;
                }
            });
            rows[rows.length - 1].update();
            card.appendChild(row);
        }

        const bulk = el('div', 'flex gap-2 pt-1');
        bulk.append(
            button('Accept all', 'text-xs px-3 py-1.5 rounded bg-emerald-700 text-white', async () => {
                for (const g2 of groups) if (g2.status === 'pending') await accept(g2);
                refresh();
            }),
            button('Undo all', 'text-xs px-3 py-1.5 rounded bg-gray-800 text-gray-200', async () => {
                for (const g2 of [...groups].reverse()) {
                    if (isActive(g2)) { const res = await reject(g2); if (!res.ok) notifyStatus(res.reason); }
                }
                refresh();
            })
        );
        card.appendChild(bulk);
        const ckId = groups[0] && groups[0].turnId;
        if (checkpoints.some(c => c.id === ckId)) {
            const ckRow = el('div', 'flex gap-2 pt-1 flex-wrap');
            const runRestore = async (opts) => {
                const res = await restoreCheckpoint(ckId, opts);
                if (!res.ok) notifyStatus(res.reason);
                else if (typeof notifyInfo === 'function') notifyInfo(opts.chat ? (opts.code ? 'Code and chat restored' : 'Chat restored') : 'Code restored');
                refresh();
            };
            ckRow.append(
                button('Undo code and chat', 'text-xs px-3 py-1.5 rounded bg-rose-800 text-white', () => runRestore({ code: true, chat: true })),
                button('Undo chat only', 'text-xs px-3 py-1.5 rounded bg-gray-800 text-gray-200', () => runRestore({ chat: true }))
            );
            card.appendChild(ckRow);
        }
        agentChatWindow.appendChild(card);
        agentChatWindow.scrollTop = agentChatWindow.scrollHeight;
        updateUndoButton();
    }

    function notifyStatus(msg) {
        if (typeof notifyWarning === 'function') notifyWarning(msg);
        else console.warn('[REVIEW]', msg);
    }

    function updateUndoButton() {
        const btn = document.getElementById('undoAiBtn');
        if (!btn) return;
        const n = undoCount();
        btn.disabled = n === 0;
        btn.title = n ? `Undo the last AI change (${n} active)` : 'No AI change to undo';
        const label = btn.querySelector('[data-undo-count]');
        if (label) label.textContent = n ? String(n) : '';
    }

    function bindToolbar() {
        const btn = document.getElementById('undoAiBtn');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            const res = await undoLast();
            if (!res.ok) notifyStatus(res.reason);
            else if (typeof notifyInfo === 'function') notifyInfo(`Reverted ${res.path}`);
            updateUndoButton();
        });
        updateUndoButton();
    }

    load();
    loadCheckpoints();

    g.ChangeReview = {
        beginTurn, endTurn, write, accept, reject, undoLast, undoCount, restoreCheckpoint,
        onRestoreChat: null,
        checkpoints: () => checkpoints.slice(),
        updateUndoButton, bindToolbar,
        get lastTouched() { return lastTouched.slice(); },
        _log: () => log.slice()
    };
})(typeof window !== 'undefined' ? window : globalThis);
