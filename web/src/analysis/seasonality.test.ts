// @vitest-environment node
// Saisonnalité (P7, S1) : statistiques recalculées à la main, mois complets seulement, trous exclus,
// heures de Paris à travers les changements d'heure (29/03 et 25/10/2026).
import { describe, expect, it } from 'vitest';
import { dailyReturns, dayOfYear, monthlyReturns, seasonality, stats, yearPath, type Bar } from './seasonality';

const D = (iso: string, c: number, o = c): Bar => ({ t: Date.parse(`${iso}T00:00:00Z`), o, h: Math.max(o, c), l: Math.min(o, c), c });
const H = (iso: string, o: number, c: number): Bar => ({ t: Date.parse(iso), o, h: Math.max(o, c), l: Math.min(o, c), c });

describe('statistiques', () => {
  it('moyenne, médiane, part de hausses, écart-type, t', () => {
    const s = stats([0.02, -0.01, 0.03, 0.04], 3);
    expect(s.n).toBe(4);
    expect(s.mean).toBeCloseTo(0.02, 12);
    expect(s.median).toBeCloseTo(0.025, 12);
    expect(s.up).toBe(0.75);
    const sd = Math.sqrt((0 + 0.0009 + 0.0001 + 0.0004) / 3);
    expect(s.sd).toBeCloseTo(sd, 12);
    expect(s.t).toBeCloseTo(0.02 / (sd / 2), 9);
    expect(s.weak).toBe(false);
    expect(stats([0.01], 3)).toMatchObject({ n: 1, sd: null, t: null, weak: true });
    expect(stats([], 3)).toMatchObject({ n: 0, mean: null, weak: true });
  });
});

describe('rendements', () => {
  it('quotidiens : trou de plus de 5 jours exclu, week-end des actions accepté', () => {
    const r = dailyReturns([D('2026-01-02', 100), D('2026-01-05', 110), D('2026-01-06', 99), D('2026-01-20', 100)]);
    expect(r.map((x) => x.r)).toEqual([0.10000000000000009, -0.09999999999999998]);
  });
  it('mensuels : mois consécutifs et complets seulement', () => {
    const bars = [D('2026-01-30', 100), D('2026-02-27', 120), D('2026-03-31', 90), D('2026-05-29', 99), D('2026-06-10', 50)];
    const r = monthlyReturns(bars, Date.parse('2026-06-15T00:00:00Z'));
    expect(r.map((x) => [x.m, Math.round(x.r * 1000) / 1000])).toEqual([[2, 0.2], [3, -0.25]]);   // mai sans avril, juin en cours : exclus
  });
  it('trajectoire de l’année : cumul depuis la dernière clôture de l’année précédente, jours vides reportés', () => {
    const p = yearPath([D('2025-12-31', 100), D('2026-01-02', 110), D('2026-01-05', 120)], 2026)!;
    expect(p.points.slice(0, 6)).toEqual([0, 0.10000000000000009, 0.10000000000000009, 0.10000000000000009, 0.19999999999999996, null]);
    expect(dayOfYear(Date.parse('2024-12-31T12:00:00Z'))).toBe(366);
  });
});

describe('heures de Paris', () => {
  it('ouverture 07:00 UTC : 08 h en hiver, 09 h en été (changement du 29/03/2026)', () => {
    const hourly = [
      H('2026-03-28T07:00:00Z', 100, 101),   // samedi, heure d'hiver : 08 h
      H('2026-03-30T07:00:00Z', 100, 102),   // lundi, heure d'été : 09 h
      H('2026-10-26T07:00:00Z', 100, 97),    // lendemain du retour à l'heure d'hiver : 08 h
    ];
    const s = seasonality('BTC', 'BTC', 'okx', [], hourly, Date.parse('2026-11-25T00:00:00Z'));
    const h8 = s.hours.find((b) => b.key === 8)!, h9 = s.hours.find((b) => b.key === 9)!;
    expect(h8.n).toBe(2);
    expect(h8.mean).toBeCloseTo((0.01 - 0.03) / 2, 12);
    expect(h9.n).toBe(1);
    expect(h9.mean).toBeCloseTo(0.02, 12);
    expect(s.hours).toHaveLength(24);
  });
});

describe('ensemble', () => {
  it('mois, jours de semaine, trajectoire moyenne et année en cours', () => {
    const bars: Bar[] = [];
    for (let t = Date.parse('2023-12-31T00:00:00Z'); t <= Date.parse('2026-11-24T00:00:00Z'); t += 86_400_000) bars.push({ t, o: 1, h: 1, l: 1, c: 100 * (1 + (t - Date.parse('2023-12-31T00:00:00Z')) / 86_400_000 / 1000) });
    const s = seasonality('BTC', 'BTC', 'okx', bars, [], Date.parse('2026-11-25T00:00:00Z'));
    expect(s.months.find((m) => m.key === 1)!.n).toBe(3);           // janvier 2024 (clôture du 31/12/2023), 2025, 2026
    expect(s.months.find((m) => m.key === 11)!.n).toBe(2);          // nov. 2026 en cours exclu
    expect(s.months.every((m) => m.weak)).toBe(true);               // moins de 8 années
    expect(s.weekdays).toHaveLength(7);
    expect(s.years).toBe(2);                                         // 2024 et 2025 complètes
    expect(s.avg_path[0]).not.toBeNull();
    expect(s.current!.year).toBe(2026);
    expect(s.hours).toEqual([]);
  });
});
