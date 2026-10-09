// Bundled into vendor/codemirror.bundle.js (IIFE). Exposes window.CM for the
// mobile code editor. Only the pieces the IDE needs are included.
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection,
  highlightActiveLineGutter, placeholder
} from "@codemirror/view";
import {
  defaultKeymap, history, historyKeymap, indentWithTab
} from "@codemirror/commands";
import {
  syntaxHighlighting, indentOnInput, bracketMatching, indentUnit
} from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";

// Accepts a file path ("app.js") or an IDE language name ("javascript").
function languageFor(pathOrLang = "") {
  const v = String(pathOrLang).toLowerCase();
  const ext = v.includes(".") ? v.split(".").pop() : v;
  if (["js", "mjs", "jsx", "ts", "tsx", "javascript", "typescript"].includes(ext)) {
    return javascript({ jsx: /x$/.test(ext), typescript: /ts/.test(ext) });
  }
  if (["html", "htm", "svelte", "vue"].includes(ext)) return html();
  if (["css", "scss", "sass"].includes(ext)) return css();
  if (ext === "json") return json();
  if (["md", "markdown"].includes(ext)) return markdown();
  if (["py", "python"].includes(ext)) return python();
  if (["xml", "svg"].includes(ext)) return xml();
  return [];
}

window.CM = {
  EditorState, EditorView, Compartment, keymap, lineNumbers, highlightActiveLine,
  drawSelection, highlightActiveLineGutter, placeholder, defaultKeymap, history,
  historyKeymap, indentWithTab, syntaxHighlighting, indentOnInput, bracketMatching,
  indentUnit, oneDark, languageFor
};
