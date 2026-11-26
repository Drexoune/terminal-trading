// Lecture IA de la heatmap fondamentale (plan § Analyse ; T-055 révisée par l'audit du 26/11/2026) :
// faits numérotés tirés des seuls scores affichés (classement des 8 devises, détail par thème, état
// du backtest), envoyés à l'assistant de P6 (Gemini gratuit, même contrôle : tout chiffre de la
// réponse doit figurer dans un fait cité, sinon la réponse est écartée).

import type { Fact } from '../../../api/_lib/assistant-core';
import { CURRENCY, fmtCellValue, fmtScore, THEME_LABEL, type MacroReply } from './macro';

export const HEATMAP_QUESTION = 'Lis la heatmap fondamentale : quelles devises ressortent comme les plus fortes et les plus faibles, sur quels thèmes, et quelle paire présente le plus grand écart de fondamentaux ? Rappelle si le score est démontré ou seulement un outil de contexte. Réponse courte, en français.';
const BIAS_FR = { BULLISH: 'haussier', NEUTRAL: 'neutre', BEARISH: 'baissier' } as const;

/** Faits de la heatmap : un par devise (score, rang, biais), un par devise et thème renseigné, l'état du backtest. */
export function heatmapFacts(st: MacroReply | null | undefined): Fact[] {
  const sc = st?.scores;
  if (!sc?.rows.length) return [];
  const facts: Fact[] = [];
  const add = (label: string, value: string, source: string, at: number | null) => facts.push({ id: `F${facts.length + 1}`, label, value, source, at_ms: at, href: '/heatmap' });
  const src = `Heatmap fondamentale du terminal (scores relatifs du ${sc.date})`;
  for (const r of [...sc.rows].sort((a, b) => a.rank - b.rank)) {
    add(`${CURRENCY[r.economy]} · score fondamental relatif (−100 à +100)`, `${fmtScore(r.score)} (rang ${r.rank} sur ${sc.rows.length}, biais ${BIAS_FR[r.bias]})`, src, sc.computed_ms);
  }
  for (const r of sc.rows) {
    for (const c of r.cells) {
      if (c.value === null || c.level === null) continue;
      const lvl = c.level > 0 ? 'favorable' : c.level < 0 ? 'défavorable' : 'neutre';
      add(`${CURRENCY[r.economy]} · ${THEME_LABEL[c.theme]}`, `${fmtCellValue(c)} (${lvl} face aux 7 autres devises${c.period ? `, période ${c.period}` : ''})`, src, sc.computed_ms);
    }
  }
  const bt = st?.backtest;
  add('Score fondamental · backtest', bt ? `${bt.proven ? 'signal démontré' : 'non démontré : outil de contexte'} (${bt.verdict})` : 'backtest pas encore passé : outil de contexte', 'Backtest de la heatmap (porte de P3)', bt?.computed_ms ?? null);
  return facts.slice(0, 80);
}
