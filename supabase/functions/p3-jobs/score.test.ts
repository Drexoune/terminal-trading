// @vitest-environment node
// Modèle de score (M2) sur des données synthétiques à réponse connue.
import { describe, expect, it } from 'vitest';
import { ECONOMIES, type Economy } from './catalog.ts';
import { shiftPeriod } from './parse.ts';
import { asOf, cell, isStale, level, scoreAt, Z_MAX, type Panel, type Series } from './score.ts';

/** Série mensuelle constante (ou fonction du rang du mois) de 2020-01 à `last`. */
function monthly(last: string, f: (i: number) => number, from = '2020-01'): Series {
  const obs = [];
  for (let p = from, i = 0; p <= last; p = shiftPeriod(p, 1), i++) obs.push({ period: p, value: f(i) });
  return { freq: 'M', obs };
}

const DATE = '2026-11-24';

describe('dates de publication', () => {
  it('IPC d’octobre publié fin novembre : au 24/11, la dernière valeur connue est septembre', () => {
    const s = monthly('2026-10', (i) => i);
    expect(asOf(s, 'cpi', DATE)!.obs.period).toBe('2026-09');
    expect(asOf(s, 'cpi', '2026-11-30')!.obs.period).toBe('2026-10');
    expect(asOf(s, 'policy', DATE)!.obs.period).toBe('2026-10');   // taux : sans délai
    expect(asOf(s, 'cpi', DATE, true)!.obs.period).toBe('2026-10');   // score du jour : la valeur en base est publiée
  });
  it('périmée au-delà de deux publications manquées', () => {
    const s = monthly('2026-05', () => 1);
    expect(isStale(s, 'cpi', s.obs.at(-1)!, DATE)).toBe(true);
    const t = monthly('2026-09', () => 1);
    expect(isStale(t, 'cpi', t.obs.at(-1)!, DATE)).toBe(false);
  });
});

describe('signaux', () => {
  it('taux = niveau + variation sur 6 mois ; inflation = écart à la cible de la banque', () => {
    const panel: Panel = { US: { policy: monthly('2026-10', (i) => (i >= 76 ? 4 : 3.5)), cpi: monthly('2026-10', () => 3) },
      AU: { cpi: monthly('2026-10', () => 3) } };
    // 2026-10 est le 81e mois depuis 2020-01 (indice 81) ; il y a 6 mois (indice 75) : 3,5.
    expect(cell(panel, 'US', 'rates', DATE)).toMatchObject({ value: 4, x: 4.5, period: '2026-10' });
    expect(cell(panel, 'US', 'inflation', DATE).x).toBe(1);
    expect(cell(panel, 'AU', 'inflation', DATE).x).toBe(0.5);   // cible RBA : milieu de 2–3 %
  });
  it('chômage en hausse = défavorable ; PMI et surprises : raison, pas de chiffre', () => {
    const panel: Panel = { US: { unemployment: monthly('2026-10', (i) => 4 + i * 0.1) } };
    expect(cell(panel, 'US', 'employment', DATE).x).toBeCloseTo(-0.3, 10);
    expect(cell(panel, 'US', 'activity', DATE)).toMatchObject({ x: null, reason: expect.stringMatching(/après 3 mois/) });
    expect(cell({}, 'US', 'inflation', DATE)).toMatchObject({ x: null, reason: 'série absente' });
  });
});

describe('score', () => {
  const cpiPanel = (values: number[]): Panel =>
    Object.fromEntries(ECONOMIES.map((e, i) => [e, { cpi: monthly('2026-10', () => values[i]) }])) as Panel;

  it('borné à ±100, somme nulle, 100 pour l’économie seule en tête', () => {
    // IPC = cible de chaque banque (BNS 1 %, RBA 2,5 %), sauf les États-Unis à cible + 3 : x = 3, 0, 0…
    const s = scoreAt(cpiPanel([5, 2, 2, 2, 1, 2, 2.5, 2]), DATE, { themes: ['inflation'] });
    const us = s.rows.find((r) => r.economy === 'US')!;
    expect(us.cells[0].z).toBeCloseTo(Z_MAX, 2);   // z arrondi au centième à la sortie
    expect(us.score).toBe(100);
    expect(s.rows.filter((r) => r.economy !== 'US').every((r) => r.score === -14)).toBe(true);   // −100/7 arrondi
    const t = scoreAt(cpiPanel([1, 2, 3, 4, 5, 6, 7, 8]), DATE, { themes: ['inflation'] });
    expect(Math.abs(t.rows.reduce((a, r) => a + r.score, 0))).toBeLessThanOrEqual(4);   // arrondis
    expect(t.rows.every((r) => Math.abs(r.score) <= 100)).toBe(true);
  });
  it('biais relatif : 3 BULLISH, 2 NEUTRAL, 3 BEARISH, dans l’ordre des scores', () => {
    const t = scoreAt(cpiPanel([1, 2, 3, 4, 5, 6, 7, 8]), DATE, { themes: ['inflation'] });
    expect(t.rows.map((r) => r.economy)).toEqual(['NZ', 'AU', 'CA', 'CH', 'JP', 'GB', 'EA', 'US']);
    expect(t.rows.map((r) => r.bias)).toEqual(['BULLISH', 'BULLISH', 'BULLISH', 'NEUTRAL', 'NEUTRAL', 'BEARISH', 'BEARISH', 'BEARISH']);
    expect(t.rows[0].cells[0].level).toBe(2);
    expect(t.rows[7].cells[0].level).toBe(-2);
  });
  it('thème connu pour moins de 6 économies : retiré pour toutes ; valeur manquante : neutre', () => {
    const p = cpiPanel([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const e of ['CH', 'CA', 'AU'] as Economy[]) delete p[e];
    const s = scoreAt(p, DATE, { themes: ['inflation'] });
    expect(s.themes).toEqual([]);
    expect(s.excluded[0]).toEqual({ theme: 'inflation', reason: '5 économies sur 8 seulement' });
    expect(s.rows.every((r) => r.score === 0)).toBe(true);
    const q = cpiPanel([1, 2, 3, 4, 5, 6, 7, 8]);
    delete q.NZ;
    const r = scoreAt(q, DATE, { themes: ['inflation'] });
    expect(r.rows.find((x) => x.economy === 'NZ')).toMatchObject({ score: 0, cells: [{ z: null, reason: 'série absente' }] });
  });
  it('niveaux de couleur', () => {
    expect([-1.5, -0.5, 0, 0.5, 1.2].map(level)).toEqual([-2, -1, 0, 1, 2]);
  });
});
