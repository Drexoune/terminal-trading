// @vitest-environment node
// Backtest (M3) sur des cas synthétiques à réponse connue : un score qui annonce les changes est
// « démontré » ; un score sans lien ne l'est pas ; statistiques de base.
import { describe, expect, it } from 'vitest';
import { ECONOMIES, INFLATION_TARGET, type Economy } from './catalog.ts';
import { shiftPeriod } from './parse.ts';
import { neweyWest, ranks, relativeReturns, runBacktest, spearman, type Fx } from './backtest.ts';
import type { Panel } from './score.ts';

function months(from: string, to: string): string[] {
  const out: string[] = [];
  for (let p = from; p <= to; p = shiftPeriod(p, 1)) out.push(p);
  return out;
}

/** Inflation x(e, mois) pseudo-aléatoire et déterministe ; changes qui suivent (ou non) le signal publié. */
function world(linked: boolean): { panel: Panel; fx: Fx } {
  const ms = months('2004-01', '2026-10');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const x: Record<string, number[]> = {};
  for (const e of ECONOMIES) x[e] = ms.map(() => rnd() * 4);
  const panel: Panel = Object.fromEntries(ECONOMIES.map((e) => [e, { cpi: { freq: 'M' as const,
    obs: ms.map((p, i) => ({ period: p, value: INFLATION_TARGET[e].mid + x[e][i] })) } }])) as Panel;
  const fx: Fx = {};
  for (const e of ECONOMIES.filter((c) => c !== 'US')) {
    let lvl = 1;
    fx[e as Exclude<Economy, 'US'>] = ms.map((p, i) => {
      // L'IPC du mois i est publié à la fin du mois i+1 : il « annonce » le change du mois i+2.
      const drift = linked && i >= 2 ? (x[e][i - 2] - x.US[i - 2]) * 0.01 : 0;
      lvl *= Math.exp(drift + rnd() * 0.004);
      return { period: p, value: lvl };
    });
  }
  return { panel, fx };
}

describe('statistiques', () => {
  it('rangs avec ex aequo, Spearman, Newey-West', () => {
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 10);
    const nw = neweyWest([1, 1, 1, 1], 2);
    expect(nw.mean).toBe(1);
    expect(nw.t).toBeNull();   // variance nulle : pas de t
    expect(neweyWest([0.1, -0.1, 0.2, 0, 0.1, 0.05], 0).t).toBeGreaterThan(0);
  });
  it('rendements relatifs : somme nulle, dollar à 0 avant centrage ; cours manquant : rien', () => {
    const fx: Fx = Object.fromEntries(ECONOMIES.filter((e) => e !== 'US').map((e) => [e, [{ period: '2026-01', value: 1 }, { period: '2026-02', value: 1.1 }]]));
    const r = relativeReturns(fx, '2026-01', '2026-02')!;
    expect(Object.values(r).reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12);
    expect(r.US).toBeCloseTo(-(7 * Math.log(1.1)) / 8, 12);
    delete fx.JP;
    expect(relativeReturns(fx, '2026-01', '2026-02')).toBeNull();
  });
});

describe('porte de P3', () => {
  it('score qui annonce les changes : IC positif, démontré', () => {
    const { panel, fx } = world(true);
    const r = runBacktest(panel, fx, '2008-01', '2026-06');
    const lvl1 = r.measures.find((m) => m.horizon === 1 && m.signal === 'niveau')!;
    expect(lvl1.ic).toBeGreaterThan(0.3);
    expect(lvl1.halves.every((h) => (h.t ?? 0) >= 2)).toBe(true);
    expect(lvl1.spread_bp).toBeGreaterThan(0);
    expect(r.proven).toBe(true);
  });
  it('score sans lien avec les changes : non démontré, « outil de contexte »', () => {
    const { panel, fx } = world(false);
    const r = runBacktest(panel, fx, '2008-01', '2026-06');
    expect(r.proven).toBe(false);
    expect(r.verdict).toMatch(/outil de contexte/);
    expect(r.caveats[0]).toMatch(/chiffres révisés/);
  });
});
