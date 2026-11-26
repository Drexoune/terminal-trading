// @vitest-environment node
// Comparaison de deux actifs : dates communes seulement, base 100, rendement, volatilité annualisée,
// baisse maximale, corrélation et bêta recalculés à la main, corrélation glissante sur 30 dates.
import { describe, expect, it } from 'vitest';
import { align, compare, correlation, maxDrawdown, type DailyPoint } from './compare';

const days = (n: number, start = '2025-11-26', f: (i: number) => number = (i) => 100 + i): DailyPoint[] =>
  Array.from({ length: n }, (_, i) => ({ d: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), c: f(i) }));

describe('briques', () => {
  it('corrélation : parfaite, inverse, indéfinie', () => {
    expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(correlation([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 12);
    expect(correlation([1, 1, 1], [1, 2, 3])).toBeNull();
  });
  it('baisse maximale', () => {
    expect(maxDrawdown([100, 120, 90, 130, 117])).toBeCloseTo(90 / 120 - 1, 12);
    expect(maxDrawdown([1, 2, 3])).toBe(0);
  });
  it('dates communes : le week-end des cryptos est retiré, fenêtre d’un an', () => {
    const crypto = days(400, '2024-11-01');
    const fund = crypto.filter((p) => ![0, 6].includes(new Date(`${p.d}T00:00:00Z`).getUTCDay()));
    const rows = align(crypto, fund);
    expect(rows.every((r) => ![0, 6].includes(new Date(`${r.d}T00:00:00Z`).getUTCDay()))).toBe(true);
    expect(Date.parse(rows.at(-1)!.d) - Date.parse(rows[0].d)).toBeLessThanOrEqual(365 * 86_400_000);
  });
});

describe('comparaison', () => {
  it('A double, B constant à +0,1 %/jour : rendements, base 100, ratio, bêta', () => {
    const n = 100;
    const a = days(n, '2026-08-01', (i) => 100 * 2 ** (i / (n - 1)));
    const b = days(n, '2026-08-01', (i) => 50 * 1.001 ** i);
    const c = compare(a, b)!;
    expect(c.days).toBe(n);
    expect(c.a.ret).toBeCloseTo(1, 9);
    expect(c.b.ret).toBeCloseTo(1.001 ** 99 - 1, 9);
    expect(c.normA[0]).toBe(100);
    expect(c.normA.at(-1)).toBeCloseTo(200, 9);
    expect(c.ratio.at(-1)).toBeCloseTo((200 / (1.001 ** 99 * 100)) * 100, 6);
    expect(c.diff).toBeCloseTo((1 - (1.001 ** 99 - 1)) * 100, 9);
    expect(c.a.maxDD).toBe(0);
    expect(c.b.vol).toBeCloseTo(0, 9);                       // rendements identiques chaque jour
  });
  it('B = 2 × A en rendements : corrélation 1, bêta 0,5 ; glissante sur 30 dates', () => {
    const r = Array.from({ length: 80 }, (_, i) => Math.sin(i) / 100);
    let pa = 100, pb = 100;
    const a = days(81, '2026-09-01', (i) => (i ? (pa *= 1 + r[i - 1]) : pa));
    const b = days(81, '2026-09-01', (i) => (i ? (pb *= 1 + 2 * r[i - 1]) : pb));
    const c = compare(a, b)!;
    expect(c.corr).toBeCloseTo(1, 9);
    expect(c.beta).toBeCloseTo(0.5, 9);
    expect(c.rolling).toHaveLength(80 - 30 + 1);
    expect(c.a.worst!.r).toBeLessThan(0);
  });
  it('trop peu de dates communes : null', () => {
    expect(compare(days(10), days(10))).toBeNull();
    expect(compare(days(50, '2026-01-01'), days(50, '2026-06-01'))).toBeNull();
  });
});
