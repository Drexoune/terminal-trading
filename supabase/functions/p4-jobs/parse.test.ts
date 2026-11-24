// @vitest-environment node
// Lecture des réponses réelles du 24/11/2026 (docs/exploration-p4.md).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COT_CATEGORIES, COT_MARKETS } from './catalog.ts';
import { binanceRatio, bybitRatio, cboeCsv, fredDaily, funding, okxDailyCandles, okxRatio, tffRows, tiingoDaily, tiingoFxDaily } from './parse.ts';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('séries quotidiennes', () => {
  it('Cboe : dates américaines, clôture du lundi 23/11', () => {
    const p = cboeCsv(fx('cboe-vix-2026-11-24.csv'), '2026-01-01');
    expect(p.at(-1)).toEqual({ date: '2026-11-23', value: 26.62 });
    expect(p[0].date >= '2026-01-01').toBe(true);
  });
  it('FRED : valeurs manquantes ignorées, unités brutes (millions, milliards)', () => {
    expect(fredDaily(fx('fred-walcl-2026-11-24.csv'), '2026-01-01').at(-1)).toEqual({ date: '2026-11-18', value: 6741452 });
    expect(fredDaily(fx('fred-rrpontsyd-2026-11-24.csv'), '2026-01-01').at(-1)).toEqual({ date: '2026-11-23', value: 0.35 });
    expect(fredDaily('observation_date,X\n2026-11-20,.\n2026-11-23,1.5\n', '2026-01-01')).toEqual([{ date: '2026-11-23', value: 1.5 }]);
    expect(() => fredDaily('observation_date,X\n', '2026-01-01')).toThrow(/aucune ligne/);
  });
  it('Tiingo : clôture et clôture ajustée ; change sans samedi ni dimanche', () => {
    expect(tiingoDaily('[{"date":"2026-11-23T00:00:00.000Z","close":722.29,"adjClose":720.1}]')).toEqual([{ date: '2026-11-23', value: 722.29, adj: 720.1 }]);
    const fxd = tiingoFxDaily('[{"date":"2026-11-15T00:00:00.000Z","close":108.3},{"date":"2026-11-16T00:00:00.000Z","close":108.1}]');
    expect(fxd).toEqual([{ date: '2026-11-16', value: 108.1 }]);   // dimanche 15/11 retiré
  });
  it('OKX : bougie du jour en cours exclue, ordre chronologique', () => {
    const p = okxDailyCandles(fx('okx-candles-btc-2026-11-24.json'));
    expect(p.length).toBe(99);
    expect(p.at(-1)!.date).toBe('2026-11-23');
    expect(p[0].date < p[1].date).toBe(true);
  });
});

describe('COT', () => {
  it('rapport TFF : marchés du catalogue seulement, 5 catégories', () => {
    const rows = tffRows(fx('cftc-tff-futures-2026-11-24.json'), COT_MARKETS, COT_CATEGORIES);
    const eur = rows.filter((r) => r.market_code === '099741' && r.date === '2026-11-17');
    expect(eur.map((r) => r.category).sort()).toEqual(['asset_mgr', 'dealer', 'lev_money', 'nonrept', 'other_rept']);
    expect(eur.find((r) => r.category === 'dealer')).toMatchObject({ long: 48836, short: 167229, spread: 8336, open_interest: 866032 });
    expect(eur.find((r) => r.category === 'nonrept')!.spread).toBeNull();
    expect(rows.some((r) => r.market.startsWith('BITCOIN CASH'))).toBe(false);
  });
});

describe('sentiment retail', () => {
  it('Binance, OKX, Bybit : ratio et part des longs', () => {
    const b = binanceRatio(fx('binance-global-account-btc-2026-11-24.json'));
    expect(b.length).toBe(500);
    expect(b[0]).toMatchObject({ value: 2.465, long_share: 0.7114 });   // le plus ancien
    expect(b[0].ts_ms).toBeLessThan(b.at(-1)!.ts_ms);
    const o = okxRatio(fx('okx-ratio-contract-btc-2026-11-24.json'));
    expect(o[0].value).toBeCloseTo(2.4559702378596588);
    expect(o[0].long_share).toBeCloseTo(2.4559702378596588 / 3.4559702378596588);
    const y = bybitRatio(fx('bybit-account-ratio-btc-2026-11-24.json'));
    expect(y[0]).toMatchObject({ long_share: 0.701 });
    expect(y[0].value).toBeCloseTo(0.701 / 0.299);
    expect(() => okxRatio('{"code":"50011","msg":"Too Many Requests"}')).toThrow(/50011/);
  });
  it('financement des trois plateformes', () => {
    expect(funding('binance', fx('binance-premium-btc-2026-11-24.json'))).toEqual({ ts_ms: 1795523070000, value: 0.00004574, long_share: null });
    expect(funding('okx', fx('okx-funding-btc-2026-11-24.json')).value).toBeCloseTo(0.0000483281980645);
    expect(funding('bybit', fx('bybit-ticker-btc-2026-11-24.json'))).toMatchObject({ ts_ms: 1795523075313, value: 0.00003119 });
  });
});
