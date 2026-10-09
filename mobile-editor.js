/*
 * mobile-editor.js - CodeMirror 6 editor for phones and tablets. Replaces
 * Monaco on mobile (Monaco is heavy and unusable with a soft keyboard).
 * It exposes the same small surface ide.js already uses:
 *   createModel(text, language) -> model { getValue, setValue }
 *   facade.setModel / getModel / getValue / onDidChangeModelContent / layout
 * Each file keeps its own EditorState, so undo history survives tab switches.
 * Also renders the symbol row ({ } ( ) ; = < > Tab ...) above the keyboard.
 */
(function (g) {
    'use strict';

    const SYMBOLS = ['Tab', '{', '}', '(', ')', '[', ']', ';', '=', '<', '>', '"', "'", '`', ':', '.', '/', '_', '+', '-', '!', '&', '|'];

    let CM = null;
    let view = null;
    let current = null;          // active model
    let listeners = [];
    let suppress = false;
    let facade = null;

    function theme() {
        return CM.EditorView.theme({
            '&': { height: '100%', fontSize: '14px', backgroundColor: '#0d0d0d' },
            '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.5' },
            '.cm-gutters': { backgroundColor: '#0d0d0d', borderRight: '1px solid #1f1f1f' },
            '.cm-activeLine': { backgroundColor: 'rgba(52,211,153,0.06)' }
        }, { dark: true });
    }

    function makeState(doc, language, model) {
        return CM.EditorState.create({
            doc,
            extensions: [
                CM.lineNumbers(),
                CM.highlightActiveLineGutter(),
                CM.highlightActiveLine(),
                CM.drawSelection(),
                CM.history(),
                CM.bracketMatching(),
                CM.indentOnInput(),
                CM.indentUnit.of('  '),
                CM.EditorState.tabSize.of(2),
                CM.EditorView.lineWrapping,
                CM.oneDark,
                CM.keymap.of([...CM.defaultKeymap, ...CM.historyKeymap, CM.indentWithTab]),
                CM.languageFor(language),
                theme(),
                CM.EditorView.updateListener.of((u) => {
                    if (!model) return;
                    model.state = u.state;
                    if (u.docChanged && !suppress && current === model) {
                        listeners.forEach(cb => { try { cb(); } catch (e) { console.error(e); } });
                    }
                })
            ]
        });
    }

    function createModel(text, language) {
        const model = {
            language,
            state: null,
            getValue() { return this.state.doc.toString(); },
            setValue(next) {
                const cur = this.getValue();
                if (cur === next) return;
                suppress = true;
                try {
                    if (current === this && view) {
                        view.dispatch({ changes: { from: 0, to: cur.length, insert: next } });
                    } else {
                        this.state = this.state.update({ changes: { from: 0, to: cur.length, insert: next } }).state;
                    }
                } finally { suppress = false; }
            }
        };
        model.state = makeState(String(text ?? ''), language, model);
        return model;
    }

    /** Mounts the editor into a container element. */
    function init(container) {
        CM = g.CM;
        if (!CM) throw new Error('CodeMirror bundle not loaded');
        view = new CM.EditorView({ state: CM.EditorState.create({ doc: '' }), parent: container });
        facade = {
            isMobileEditor: true,
            getModel() { return current; },
            setModel(model) {
                current = model || null;
                if (!model) { view.setState(CM.EditorState.create({ doc: '' })); return; }
                view.setState(model.state);
            },
            getValue() { return view ? view.state.doc.toString() : ''; },
            onDidChangeModelContent(cb) { listeners.push(cb); },
            layout() { if (view) view.requestMeasure(); },
            focus() { if (view) view.focus(); }
        };
        return facade;
    }

    /** Inserts text at the cursor (used by the symbol row). */
    function insert(text) {
        if (!view || !current) return;
        const tr = view.state.replaceSelection(text);
        view.dispatch(tr, { scrollIntoView: true, userEvent: 'input.type' });
        view.focus();
    }

    function indent() {
        if (!view || !current) return;
        insert('  ');
    }

    /** Builds the symbol row. Buttons keep focus so the soft keyboard stays open. */
    function renderSymbolBar(host) {
        host.innerHTML = '';
        host.setAttribute('role', 'toolbar');
        host.setAttribute('aria-label', 'Code symbols');
        for (const sym of SYMBOLS) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'mobile-sym-key';
            b.textContent = sym === 'Tab' ? 'Tab' : sym;
            b.dataset.sym = sym;
            b.addEventListener('mousedown', (e) => e.preventDefault());
            b.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
            b.addEventListener('click', () => (sym === 'Tab' ? indent() : insert(sym)));
            host.appendChild(b);
        }
    }

    g.MobileEditor = {
        init, createModel, insert, renderSymbolBar, SYMBOLS,
        get facade() { return facade; },
        get active() { return !!facade; }
    };
})(typeof window !== 'undefined' ? window : globalThis);
