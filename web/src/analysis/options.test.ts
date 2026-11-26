// @vitest-environment node
// Options BTC (P7, S3) : delta recalculé contre le ticker réel de Deribit (25/11/2026), sourire,
// vol ATM, risk reversal et butterfly sur un sourire construit à la main, interpolation à 30 jours.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { at30, bsDelta, buildExpiry, downsample, interp, normCdf, parseName, snapshotOptions, type Expiry, type SummaryRow } from './options';

const fx = JSON.parse(readFileSync(new URL('./fixtures/deribit-btc-2026-11-25.json', import.meta.url), 'utf8')) as {
  ticker: { name: string; timestamp: number; mark_iv: number; underlying_price: number; delta: number }; summary_ts: number; rows: SummaryRow[] };

describe('bases', () => {
  it('nom d’instrument, loi normale, interpolation', () => {
    expect(parseName('BTC-26NOV26-60000-C')).toEqual({ name: 'BTC-26NOV26-60000-C', expiry: Date.UTC(2026, 10, 26, 8), strike: 60000, type: 'C' });
    expect(parseName('BTC-PERPETUAL')).toBeNull();
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(interp([1, 3], [10, 30], 2)).toBe(20);
    expect(interp([1, 3], [10, 30], 4)).toBeNull();
  });
  it('delta de Black-Scholes = delta du ticker de Deribit (à 0,01 près)', () => {
    const t = fx.ticker, p = parseName(t.name)!;
    const d = bsDelta('C', t.underlying_price, p.strike, t.mark_iv / 100, (p.expiry - t.timestamp) / (365 * 86_400_000));
    expect(Math.abs(d - t.delta)).toBeLessThan(0.01);
  });
});

describe('sourire', () => {
  it('ATM, RR et BF 25 delta sur un sourire construit à la main', () => {
    const now = Date.UTC(2026, 10, 1, 8), F = 60_000;
    const mk = (k: number, type: 'C' | 'P', iv: number): { p: ReturnType<typeof parseName> & object; r: SummaryRow } => ({
      p: { name: `BTC-1DEC26-${k}-${type}`, expiry: Date.UTC(2026, 11, 1, 8), strike: k, type },
      r: { instrument_name: `BTC-1DEC26-${k}-${type}`, mark_iv: iv, open_interest: 10, underlying_price: F } });
    const rows = [];
    for (let k = 40_000; k <= 80_000; k += 2_000) { const iv = 50 + (k < F ? (F - k) / 1000 : (k - F) / 2000); rows.push(mk(k, 'C', iv), mk(k, 'P', iv)); }
    const e = buildExpiry(rows, now)!;
    expect(e.atm).toBeCloseTo(50, 9);                                   // strike 60 000 = prix à terme
    expect(e.rr25!).toBeLessThan(0);                                    // puts plus chers : skew négatif
    expect(e.bf25!).toBeGreaterThan(0);
    expect(e.oi_c).toBe(210);
    expect(e.smile.every((s, i, a) => !i || s.delta < a[i - 1].delta)).toBe(true);
  });
  it('relevé réel du 25/11/2026 : trois échéances lisibles, valeurs plausibles', () => {
    const s = snapshotOptions(fx.rows, 59_886.62, 54.92, fx.summary_ts);
    expect(s.expiries).toHaveLength(3);
    for (const e of s.expiries) { expect(e.atm!).toBeGreaterThan(20); expect(e.atm!).toBeLessThan(150); expect(Math.abs(e.rr25!)).toBeLessThan(20); }
    expect(s.atm30).not.toBeNull();
    expect(s.pcr).toBeGreaterThan(0);
  });
});

describe('30 jours et historique', () => {
  it('variance totale entre 20 et 40 jours ; hors encadrement : null', () => {
    const e = (days: number, atm: number) => ({ days, atm, rr25: -days / 10 } as Expiry);
    const v = at30([e(20, 40), e(40, 60)], (x) => x.atm, true)!;
    expect(v).toBeCloseTo(Math.sqrt((40 ** 2 * 20 + 0.5 * (60 ** 2 * 40 - 40 ** 2 * 20)) / 30), 9);
    expect(at30([e(20, 40), e(40, 60)], (x) => x.rr25, false)).toBeCloseTo(-3, 9);
    expect(at30([e(40, 60)], (x) => x.atm, true)).toBeNull();
  });
  it('un point par heure, le dernier', () => {
    const p = (t: number) => ({ t, index: t, dvol: null, atm30: null, rr25: null, bf25: null, pcr: null });
    expect(downsample([p(0), p(1_000), p(3_600_000), p(3_700_000)], 3_600_000, 0).map((x) => x.t)).toEqual([1_000, 3_700_000]);
  });
});
