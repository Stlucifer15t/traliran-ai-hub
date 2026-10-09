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

function languageFor(path = "") {
  const p = String(path).toLowerCase();
  if (/\.(m?js|jsx|ts|tsx)$/.test(p)) return javascript({ jsx: /x$/.test(p), typescript: /ts/.test(p) });
  if (/\.(html?|svelte|vue)$/.test(p)) return html();
  if (/\.(css|scss)$/.test(p)) return css();
  if (/\.json$/.test(p)) return json();
  if (/\.(md|markdown)$/.test(p)) return markdown();
  return [];
}

window.CM = {
  EditorState, EditorView, Compartment, keymap, lineNumbers, highlightActiveLine,
  drawSelection, highlightActiveLineGutter, placeholder, defaultKeymap, history,
  historyKeymap, indentWithTab, syntaxHighlighting, indentOnInput, bracketMatching,
  indentUnit, oneDark, languageFor
};
