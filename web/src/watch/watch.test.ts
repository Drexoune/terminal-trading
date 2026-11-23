import { describe, expect, it } from 'vitest';
import { ASSETS, change, fxOpen, isLate, marketLabel, refLabel, type WatchAsset } from './watch';

const def = (id: string) => ASSETS.find((a) => a.id === id)!;
const asset = (price: number, ref: number | null, ts: number, kind: '24h' | 'veille' = '24h'): WatchAsset => ({
  asset: 'x', source: 'tiingo-fx', last: { price, bid: null, ask: null, ts_source: ts, ts_recv: ts },
  ref: ref === null ? null : { price: ref, ts: 0, kind }, series: [] });
const T = Date.UTC(2026, 10, 23, 20, 30);   // lundi 15:30 à New York

describe('Markets Watch : règles de l’écran', () => {
  it('variation en % ; en points de base pour le 10 ans ; rien sans référence', () => {
    expect(change(def('eurusd'), asset(1.1, 1.0, T))).toBeCloseTo(0.1);
    expect(change(def('us10y'), asset(5.04, 5.07, T, 'veille'))).toBeCloseTo(-3);
    expect(change(def('eurusd'), asset(1.1, null, T))).toBeNull();
    expect(refLabel(asset(1, null, T))).toMatch(/série trop courte/);
  });

  it('marché : change ouvert en semaine, NYSE à 15:30, retard au-delà de 10 min seulement si ouvert', () => {
    expect(fxOpen(T)).toBe(true);
    expect(fxOpen(Date.UTC(2026, 10, 28, 12))).toBe(false);
    expect(marketLabel('ny', T)).toEqual({ text: 'Ouvert', open: true });
    expect(marketLabel('daily', T).text).toBe('Quotidien');
    expect(isLate(def('qqq'), asset(1, 1, T - 11 * 60_000), T)).toBe(true);
    expect(isLate(def('qqq'), asset(1, 1, T - 5 * 60_000), T)).toBe(false);
    const sat = Date.UTC(2026, 10, 28, 12);
    expect(isLate(def('eurusd'), asset(1, 1, sat - 20 * 3_600_000), sat)).toBe(false);   // marché fermé : pas en retard
  });

  it('9 actifs, sources nommées, jamais le DXY présenté comme tel', () => {
    expect(ASSETS.map((a) => a.id)).toEqual(['qqq', 'spy', 'usd-broad', 'us10y', 'xauusd', 'eurusd', 'usdjpy', 'pust', 'ese']);
    expect(ASSETS.some((a) => /DXY/.test(a.name))).toBe(false);
    expect(def('usd-broad').note).toMatch(/pas le DXY/);
  });
});
