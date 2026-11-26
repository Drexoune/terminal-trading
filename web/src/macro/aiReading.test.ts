// @vitest-environment node
// Lecture IA de la heatmap : faits tirés des seuls scores (rang, biais, thèmes renseignés, backtest),
// formatés fr-FR, contrôlables par le vérificateur de l'assistant.
import { describe, expect, it } from 'vitest';
import { verifyAnswer } from '../../../api/_lib/assistant-core';
import { heatmapFacts } from './aiReading';
import type { MacroReply } from './macro';

const cell = (theme: string, value: number | null, level: number | null) => ({ theme, x: null, value, unit: '%', period: '2026-10', indicator: null, reason: null, stale: false, z: null, level });
const ST = {
  scores: { date: '2026-11-25', themes: ['rates', 'inflation'], excluded: [], computed_ms: 1, rows: [
    { economy: 'JP', score: -40, rank: 2, bias: 'BEARISH', cells: [cell('rates', 0.5, -2), cell('inflation', null, null)] },
    { economy: 'US', score: 35, rank: 1, bias: 'BULLISH', cells: [cell('rates', 4.25, 2), cell('inflation', 2.9, 1)] },
  ] },
  backtest: { proven: false, verdict: 'IC moyen 0,02, non significatif', computed_ms: 2 },
} as unknown as MacroReply;

describe('lecture IA de la heatmap', () => {
  it('faits : classement par rang, thèmes renseignés seulement, backtest', () => {
    const f = heatmapFacts(ST);
    expect(f.map((x) => x.id)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
    expect(f[0]).toMatchObject({ label: 'USD · score fondamental relatif (−100 à +100)', value: '+35 (rang 1 sur 2, biais haussier)', href: '/heatmap' });
    expect(f[1].value).toBe('−40 (rang 2 sur 2, biais baissier)');
    expect(f.map((x) => x.label)).toContain('USD · Taux');
    expect(f.some((x) => x.label === 'JPY · Inflation')).toBe(false);          // thème sans valeur : aucun fait
    expect(f[5].value).toMatch(/^non démontré : outil de contexte/);
    expect(heatmapFacts(null)).toEqual([]);
  });
  it('le vérificateur de l’assistant accepte une lecture fidèle et écarte un chiffre inventé', () => {
    const f = heatmapFacts(ST);
    expect(verifyAnswer('Le dollar ressort le plus fort (+35), le yen le plus faible (−40) ; outil de contexte.', ['F1', 'F2', 'F6'], f).ok).toBe(true);
    expect(verifyAnswer('Le dollar ressort le plus fort (+42).', ['F1'], f).ok).toBe(false);
  });
});
