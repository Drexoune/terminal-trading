// Éditeur de Pine Script (mode « Éditeur » de la section Backtest) : CodeMirror 6, coloration
// simple du Pine (mots-clés, espaces de noms intégrés, chaînes, nombres, commentaires), thème
// tiré des tokens du design system. Un clic sur une erreur place le curseur sur sa ligne.

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const KEYWORDS = new Set(['if', 'else', 'for', 'to', 'by', 'while', 'switch', 'var', 'varip', 'and', 'or', 'not', 'true', 'false', 'na',
  'import', 'export', 'method', 'type', 'continue', 'break', 'in']);
const NAMESPACES = new Set(['ta', 'math', 'strategy', 'input', 'request', 'str', 'array', 'matrix', 'map', 'color', 'syminfo', 'timeframe',
  'barstate', 'session', 'line', 'label', 'box', 'table', 'plot', 'hline', 'fill', 'bgcolor', 'alert', 'alertcondition', 'indicator']);
const SERIES = new Set(['open', 'high', 'low', 'close', 'volume', 'time', 'bar_index', 'hl2', 'hlc3', 'ohlc4', 'hlcc4']);

export const pineParser: StreamParser<unknown> = {
  name: 'pine',
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/)) return 'string';
    if (stream.match(/^\d+(\.\d+)?([eE][-+]?\d+)?/)) return 'number';
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const w = stream.current();
      if (KEYWORDS.has(w)) return 'keyword';
      if (NAMESPACES.has(w)) return 'namespace';
      if (SERIES.has(w)) return 'variableName.special';
      return 'variableName';
    }
    if (stream.match(/^(:=|==|!=|<=|>=|=>|\?|:|[-+*/%<>=])/)) return 'operator';
    stream.next();
    return null;
  },
};

const pineHighlight = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--text-3)', fontStyle: 'italic' },
  { tag: tags.string, color: 'var(--up)' },
  { tag: tags.number, color: 'var(--gold-hi)' },
  { tag: tags.keyword, color: 'var(--gold)' },
  { tag: tags.namespace, color: 'var(--up)' },
  { tag: tags.special(tags.variableName), color: 'var(--text-1)', fontWeight: '600' },
  { tag: tags.operator, color: 'var(--text-2)' },
]);

const theme = EditorView.theme({
  '&': { background: 'var(--bg-panel)', color: 'var(--text-body)', fontSize: '12.5px', height: '100%' },
  '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--gold)' },
  '.cm-gutters': { background: 'var(--bg-chrome)', color: 'var(--text-3)', border: 'none', borderRight: '1px solid var(--line)' },
  '.cm-activeLine': { background: 'var(--bg-selected)' },
  '.cm-activeLineGutter': { background: 'var(--bg-selected)', color: 'var(--gold)' },
  '&.cm-focused': { outline: '1px solid var(--gold-mid)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { background: 'var(--gold-deep) !important' },
  '.cm-scroller': { overflow: 'auto' },
}, { dark: true });

export interface PineEditorHandle { goto(line: number, column?: number | null): void }

export const PineEditor = forwardRef<PineEditorHandle, { value: string; onChange: (v: string) => void; height?: number }>(
  function PineEditor({ value, onChange, height = 420 }, ref) {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const change = useRef(onChange);
    change.current = onChange;

    useEffect(() => {
      if (!host.current) return;
      const v = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: value,
          extensions: [lineNumbers(), history(), highlightActiveLine(), keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
            StreamLanguage.define(pineParser), syntaxHighlighting(pineHighlight), theme, EditorView.lineWrapping,
            EditorView.contentAttributes.of({ 'aria-label': 'Code Pine Script de la stratégie' }),
            EditorView.updateListener.of((u) => { if (u.docChanged) change.current(u.state.doc.toString()); })],
        }),
      });
      view.current = v;
      return () => { v.destroy(); view.current = null; };
    }, []);

    // Remplacement du code depuis l'extérieur (choix d'une stratégie connue).
    useEffect(() => {
      const v = view.current;
      if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }, [value]);

    useImperativeHandle(ref, () => ({
      goto(line, column) {
        const v = view.current;
        if (!v) return;
        const l = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)));
        const pos = Math.min(l.to, l.from + Math.max(0, (column ?? 1) - 1));
        v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        v.focus();
      },
    }), []);

    return <div className="bt-editor" ref={host} style={{ height }} />;
  });
