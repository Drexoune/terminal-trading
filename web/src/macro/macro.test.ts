// Écrans Heatmap et Macro (M5) : formats, couleurs, paire et verdict, lecture automatique citée.
import { describe, expect, it } from 'vitest';
import { cellLevel, counterpart, economyOf, fmtCellValue, fmtPeriod, fmtScore, pair, reading, type ScoreCell, type Sheet, type SheetValue } from './macro';

const v = (indicator: SheetValue['indicator'], value: number | null, source = 'fred', period = '2026-10'): SheetValue =>
  ({ indicator, label: indicator, value, period: value === null ? null : period, previous: null, source, url: null, transform: 'level', stale: false,
    reason: value === null ? 'série absente' : null });
const sheet = (currency: string, values: SheetValue[]): Sheet => ({ currency, bank: 'X', target: { mid: 2, text: '2 %' }, values });

describe('formats', () => {
  it('périodes, valeurs, scores, niveaux, devises', () => {
    expect(fmtPeriod('2026-10')).toBe('10/2026');
    expect(fmtPeriod('2026-Q3')).toBe('T3 2026');
    const c = (theme: ScoreCell['theme'], value: number | null, unit: ScoreCell['unit'] = '%'): ScoreCell =>
      ({ theme, value, unit, x: null, period: null, indicator: null, reason: null, stale: false, z: null, level: null });
    expect(fmtCellValue(c('rates', 3.875))).toBe('3,88 %');
    expect(fmtCellValue(c('inflation', 3.2))).toBe('3,2 %');
    expect(fmtCellValue(c('sentiment', 1.1, 'pts'))).toBe('+1,1');
    expect(fmtCellValue(c('growth', null))).toBe('—');
    expect(fmtCellValue(c('surprises', 24, ''))).toBe('+24');
    expect([fmtScore(58), fmtScore(-65), fmtScore(0)]).toEqual(['+58', '−65', '0']);
    expect([2, 1, 0, -1, -2, null].map(cellLevel)).toEqual(['up-2', 'up-1', 'neutral', 'down-1', 'down-2', 'neutral']);
    expect([economyOf('JPY'), economyOf('JP'), economyOf('XXX')]).toEqual(['JP', 'JP', undefined]);
    expect([counterpart('JP'), counterpart('US')]).toEqual(['US', 'EA']);
  });
});

describe('paire', () => {
  it('écart A − B, chômage plus bas favorable, verdict compté sur les indicateurs comparés', () => {
    const jpy = sheet('JPY', [v('policy', 1.25), v('cpi', 1.9), v('cpi_core', 1.7), v('gdp', 0.3), v('unemployment', 2.5), v('retail', null)]);
    const usd = sheet('USD', [v('policy', 4), v('cpi', 3.7), v('cpi_core', 2.6), v('gdp', 2.2), v('unemployment', 4.2), v('retail', 6.3)]);
    const p = pair(jpy, usd);
    expect(p.rows.find((r) => r.indicator === 'policy')).toMatchObject({ diff: -2.75, favors: 'b' });
    expect(p.rows.find((r) => r.indicator === 'unemployment')).toMatchObject({ diff: -1.7, favors: 'a' });
    expect(p.rows.find((r) => r.indicator === 'retail')).toMatchObject({ diff: null, favors: null });
    expect(p.verdict).toBe('Les fondamentaux favorisent l’USD sur 4 indicateurs sur 5');
    expect(pair(undefined, usd).verdict).toBeNull();
  });
});

describe('lecture automatique', () => {
  it('chaque phrase porte ses sources ; un chiffre absent ne figure pas', () => {
    const s = sheet('JPY', [v('policy', 1.25, 'bis'), v('cpi', 1.9, 'dbnomics'), v('cpi_core', 1.7, 'dbnomics'), v('gdp', 0.3, 'fred', '2026-Q3'), v('unemployment', null)]);
    const r = reading('JP', { economy: 'JP', score: -65, rank: 8, bias: 'BEARISH', cells: [] }, s,
      { bank: 'BOJ', name: 'Banque du Japon', tz: 'Asia/Tokyo', policy: { display: 1.25 }, next: { date: '2026-12-18' } },
      { from: '2008-01', to: '2026-08', months: 224, themes: [], measures: [], proven: false, verdict: '', caveats: [], computed_ms: 0 }, 24);
    expect(r.map((x) => x.text)).toEqual([
      'JPY : biais bearish, score relatif −65.',
      'Taux directeur à 1,25 % pour une inflation de 1,9 % (sous-jacente 1,7 %), proche de la cible de 2 %.',
      'Croissance 0,3 %.',
      'Prochaine réunion le 18/12/2026 (J-24).',
    ]);
    expect(r[1].sources).toEqual(['BIS', 'DBnomics, 10/2026', 'DBnomics, 10/2026']);
    expect(r[2].sources).toEqual(['FRED, T3 2026']);
    expect(r.every((x) => x.sources.length > 0)).toBe(true);
  });
});
