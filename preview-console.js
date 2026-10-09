/*
 * preview-console.js - console and error panel for the live preview.
 *  - Injects a small hook into the preview document that forwards console
 *    output, uncaught errors and unhandled promise rejections to the IDE.
 *  - Renders them in a panel with a "Fix this error" button that asks the
 *    agent to fix the error (the error text goes into the chat).
 *  - Auto-preview: after an AI change to web files, the preview refreshes
 *    (and on phones the Preview tab opens).
 */
(function (g) {
    'use strict';

    const MAX_ENTRIES = 200;
    const TAG = '__traliranPreview';

    // Runs inside the preview iframe. Kept small and dependency-free.
    const HOOK = `<script>(function(){
  var TAG='${TAG}';
  function send(type,args){
    try{
      var text=args.map(function(a){
        if(typeof a==='string')return a;
        if(a instanceof Error)return a.name+': '+a.message;
        try{return JSON.stringify(a)}catch(e){return String(a)}
      }).join(' ');
      parent.postMessage({[TAG]:true,type:type,text:text},'*');
    }catch(e){}
  }
  ['log','info','warn','error'].forEach(function(k){
    var orig=console[k];
    console[k]=function(){ send(k==='info'?'log':k,[].slice.call(arguments)); return orig.apply(console,arguments); };
  });
  addEventListener('error',function(e){
    send('error',[(e.message||'Error')+(e.lineno?' (line '+e.lineno+')':'')]);
  });
  addEventListener('unhandledrejection',function(e){
    var r=e.reason; send('error',['Unhandled promise rejection: '+((r&&r.message)||r)]);
  });
})();<\/script>`;

    let entries = [];
    let frame = null;
    let panel = null;
    let list = null;
    let onFixRequest = null;

    function injectHook(html) {
        if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => m + HOOK);
        return HOOK + html;
    }

    function handleMessage(event) {
        if (!frame || event.source !== frame.contentWindow) return;
        const d = event.data;
        if (!d || d[TAG] !== true) return;
        entries.push({ type: d.type, text: String(d.text || '').slice(0, 2000), ts: Date.now() });
        if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
        render();
    }

    function clear() { entries = []; render(); }

    function errorCount() { return entries.filter(e => e.type === 'error').length; }

    function render() {
        if (!list) return;
        list.innerHTML = '';
        if (!entries.length) {
            const empty = document.createElement('div');
            empty.className = 'text-gray-500 text-xs px-2 py-1';
            empty.textContent = 'No console output yet.';
            list.appendChild(empty);
        }
        for (const entry of entries) {
            const row = document.createElement('div');
            const colour = entry.type === 'error' ? 'text-rose-300 bg-rose-950/40'
                : entry.type === 'warn' ? 'text-amber-300 bg-amber-950/30' : 'text-gray-300';
            row.className = `flex items-start gap-2 font-mono text-[11px] px-2 py-1 rounded ${colour}`;
            const text = document.createElement('span');
            text.className = 'flex-1 min-w-0 whitespace-pre-wrap break-words';
            text.textContent = entry.text;
            row.appendChild(text);
            if (entry.type === 'error' && onFixRequest) {
                const fix = document.createElement('button');
                fix.type = 'button';
                fix.className = 'shrink-0 text-[11px] px-2 py-0.5 rounded bg-violet-700 text-white';
                fix.textContent = 'Fix this error';
                fix.addEventListener('click', () => onFixRequest(entry));
                row.appendChild(fix);
            }
            list.appendChild(row);
        }
        const n = errorCount();
        for (const id of ['consoleErrorBadge', 'mtabErrorBadge']) {
            const badge = document.getElementById(id);
            if (!badge) continue;
            badge.textContent = n ? String(n) : '';
            badge.classList.toggle('hidden', !n);
        }
        list.scrollTop = list.scrollHeight;
    }

    /** Called by PREVIEW.render() with the finished HTML. */
    function loadInto(html) {
        clear();
        return injectHook(html);
    }

    /** Auto-preview after the agent changed files. */
    function onAiChange(paths) {
        const web = (paths || []).some(p => /\.(html?|css|js)$/i.test(p));
        if (!web || (typeof STORAGE !== 'undefined' && STORAGE.getItem('ide_auto_preview') === 'off')) return;
        if (g.PREVIEW && typeof g.PREVIEW.refreshAfterAi === 'function') g.PREVIEW.refreshAfterAi();
    }

    function bind(opts) {
        frame = opts.frame;
        panel = opts.panel;
        list = opts.list;
        onFixRequest = opts.onFix;
        window.addEventListener('message', handleMessage);
        const clearBtn = opts.clearBtn;
        if (clearBtn) clearBtn.addEventListener('click', clear);
        render();
    }

    g.PreviewConsole = { bind, loadInto, injectHook, clear, render, onAiChange, errorCount, _entries: () => entries.slice() };
})(typeof window !== 'undefined' ? window : globalThis);
