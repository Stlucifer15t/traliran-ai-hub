/*
 * line-diff.js - dependency-free line diff used by the AI change review.
 * LineDiff.diff(oldText, newText) -> [{ type: 'eq'|'add'|'del', text }]
 * LineDiff.stats(ops) -> { added, removed }
 * LineDiff.hunks(ops, context) -> ops with long unchanged runs collapsed.
 */
(function (g) {
    'use strict';

    const MAX_CELLS = 4000000; // ~2000 x 2000 lines; larger files get a coarse diff.

    function splitLines(text) {
        if (text === null || text === undefined) return [];
        const s = String(text);
        if (s === '') return [];
        const lines = s.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        return lines;
    }

    function diff(oldText, newText) {
        const a = splitLines(oldText);
        const b = splitLines(newText);

        // Trim common prefix and suffix first (the common case for AI edits).
        let start = 0;
        while (start < a.length && start < b.length && a[start] === b[start]) start++;
        let endA = a.length, endB = b.length;
        while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

        const ops = [];
        for (let i = 0; i < start; i++) ops.push({ type: 'eq', text: a[i] });

        const midA = a.slice(start, endA);
        const midB = b.slice(start, endB);
        const cells = midA.length * midB.length;

        if (cells > MAX_CELLS) {
            midA.forEach(t => ops.push({ type: 'del', text: t }));
            midB.forEach(t => ops.push({ type: 'add', text: t }));
        } else {
            // LCS table on the middle section.
            const n = midA.length, m = midB.length;
            const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
            for (let i = n - 1; i >= 0; i--) {
                for (let j = m - 1; j >= 0; j--) {
                    dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
                }
            }
            let i = 0, j = 0;
            while (i < n && j < m) {
                if (midA[i] === midB[j]) { ops.push({ type: 'eq', text: midA[i] }); i++; j++; }
                else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', text: midA[i] }); i++; }
                else { ops.push({ type: 'add', text: midB[j] }); j++; }
            }
            while (i < n) ops.push({ type: 'del', text: midA[i++] });
            while (j < m) ops.push({ type: 'add', text: midB[j++] });
        }

        for (let k = endA; k < a.length; k++) ops.push({ type: 'eq', text: a[k] });
        return ops;
    }

    function stats(ops) {
        let added = 0, removed = 0;
        for (const op of ops) {
            if (op.type === 'add') added++;
            else if (op.type === 'del') removed++;
        }
        return { added, removed };
    }

    /** Collapses unchanged runs longer than 2*context into a single 'skip' marker. */
    function hunks(ops, context = 3) {
        const keep = new Array(ops.length).fill(false);
        ops.forEach((op, idx) => {
            if (op.type !== 'eq') {
                for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
            }
        });
        const out = [];
        let skipped = 0;
        ops.forEach((op, idx) => {
            if (keep[idx]) {
                if (skipped) { out.push({ type: 'skip', count: skipped }); skipped = 0; }
                out.push(op);
            } else {
                skipped++;
            }
        });
        if (skipped) out.push({ type: 'skip', count: skipped });
        return out;
    }

    g.LineDiff = { diff, stats, hunks, splitLines };
})(typeof window !== 'undefined' ? window : globalThis);
