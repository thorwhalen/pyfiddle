/**
 * The code editor: CodeMirror 6 with Python highlighting, styled only with the page's CSS variables
 * (`--pf-*`, which default to the host's shadcn-style tokens, then to system colours), so it
 * follows the host's light and dark themes. Tab indents (four spaces, as Python is written);
 * Escape then Tab leaves the editor, so the keyboard is never trapped.
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.operatorKeyword], color: 'var(--pf-code-keyword)', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: 'var(--pf-code-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--pf-code-number)' },
  { tag: t.comment, color: 'var(--pf-muted-fg)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--pf-code-function)' },
]);

/** 16px on a touch screen: below that, iOS zooms the page when the editor gets focus. */
const fontSize = () => (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? '16px' : '14px');

/**
 * An iPad's smart punctuation types curly quotes, which Python rejects with an error a beginner
 * cannot see; typed or pasted, they become straight quotes.
 */
const CURLY = /[‘’“”]/;
const straighten = (s: string) => s.replace(/[‘’“”]/g, (q) => (q === '‘' || q === '’' ? "'" : '"'));
const straightQuotes = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  let curly = false;
  tr.changes.iterChanges((_a, _b, _c, _d, text) => {
    if (CURLY.test(text.toString())) curly = true;
  });
  if (!curly) return tr;
  const changes: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, text) => changes.push({ from: fromA, to: toA, insert: straighten(text.toString()) }));
  return { changes, selection: tr.selection, scrollIntoView: tr.scrollIntoView };
});

const theme = () => EditorView.theme({
  '&': { fontSize: fontSize(), backgroundColor: 'var(--pf-bg)', color: 'var(--pf-fg)' },
  '&.cm-focused': { outline: '2px solid var(--pf-ring)', outlineOffset: '1px' },
  '.cm-scroller': { fontFamily: 'var(--pf-font-mono)', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--pf-fg)', padding: '8px 0' },
  '.cm-gutters': { backgroundColor: 'var(--pf-muted)', color: 'var(--pf-muted-fg)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--pf-active-line)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--pf-selection) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--pf-fg)' },
});

export type EditorHandle = { view: EditorView; get: () => string; set: (code: string) => void; destroy: () => void };

export function createEditor(parent: HTMLElement, { doc, label, onChange, readOnly = false }: { doc: string; label: string; onChange?: (code: string) => void; readOnly?: boolean }): EditorHandle {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        ...(readOnly ? [] : [highlightActiveLine()]),
        indentUnit.of('    '),
        EditorState.tabSize.of(4),
        python(),
        syntaxHighlighting(highlight),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        theme(),
        straightQuotes,
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.contentAttributes.of({ 'aria-label': label, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange?.(u.state.doc.toString());
        }),
      ],
    }),
  });
  return {
    view,
    get: () => view.state.doc.toString(),
    set: (code) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } }),
    destroy: () => view.destroy(),
  };
}
