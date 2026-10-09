/*
 * cost.js - token usage and estimated cost (model routing counter).
 * Prices are USD per 1M tokens and are ESTIMATES. Edit PRICING to match your
 * provider's current price list. Unknown models count tokens but show no cost.
 */
(function (g) {
    'use strict';

    // Order matters: the first pattern that matches the model id wins.
    const PRICING = [
        { match: /claude-opus/i, input: 15, output: 75 },
        { match: /claude-sonnet/i, input: 3, output: 15 },
        { match: /claude-(3-5-)?haiku|claude-haiku/i, input: 0.8, output: 4 },
        { match: /gpt-4o-mini/i, input: 0.15, output: 0.6 },
        { match: /gpt-4o/i, input: 2.5, output: 10 },
        { match: /gpt-4\.1-mini/i, input: 0.4, output: 1.6 },
        { match: /gemini-2\.5-pro/i, input: 1.25, output: 10 },
        { match: /gemini-2\.5-flash-lite/i, input: 0.1, output: 0.4 },
        { match: /gemini-2\.5-flash/i, input: 0.3, output: 2.5 },
        { match: /deepseek/i, input: 0.27, output: 1.1 },
        { match: /llama-3\.3-70b|llama-3\.1-8b/i, input: 0.59, output: 0.79 }
    ];

    /** Local backends (Ollama, llama.cpp) are free by definition. */
    function isLocalProvider(provider) {
        return provider === 'ollama' || provider === 'llamacpp';
    }

    function priceFor(model, provider) {
        if (isLocalProvider(provider)) return { input: 0, output: 0, local: true };
        const hit = PRICING.find(p => p.match.test(String(model || '')));
        return hit ? { input: hit.input, output: hit.output } : null;
    }

    /** Accepts OpenAI (prompt/completion) and Anthropic (input/output) usage shapes. */
    function normalizeUsage(usage) {
        if (!usage) return { input: 0, output: 0 };
        const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
        const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
        return { input, output };
    }

    function costOf(usage, model, provider) {
        const { input, output } = normalizeUsage(usage);
        const price = priceFor(model, provider);
        if (!price) return { input, output, usd: null };
        return { input, output, usd: (input * price.input + output * price.output) / 1e6 };
    }

    /** Running totals keyed by model. */
    function createCounter() {
        const totals = {};
        return {
            add(usage, model, provider) {
                const c = costOf(usage, model, provider);
                const key = `${provider || '?'}:${model || '?'}`;
                const t = totals[key] || (totals[key] = { model, provider, input: 0, output: 0, usd: 0, unknownPrice: false });
                t.input += c.input;
                t.output += c.output;
                if (c.usd === null) t.unknownPrice = true; else t.usd += c.usd;
                return c;
            },
            totals() { return Object.values(totals); },
            summary() {
                const list = this.totals();
                const input = list.reduce((s, t) => s + t.input, 0);
                const output = list.reduce((s, t) => s + t.output, 0);
                const usd = list.reduce((s, t) => s + t.usd, 0);
                const unknown = list.some(t => t.unknownPrice);
                return { input, output, total: input + output, usd, unknown };
            },
            reset() { for (const k of Object.keys(totals)) delete totals[k]; }
        };
    }

    function formatUsd(v) {
        if (v === null || v === undefined) return 'n/a';
        if (v < 0.01) return '<$0.01';
        return '$' + v.toFixed(2);
    }

    g.TokenCost = { PRICING, priceFor, normalizeUsage, costOf, createCounter, formatUsd, isLocalProvider };
})(typeof window !== 'undefined' ? window : globalThis);
