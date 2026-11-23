// @vitest-environment node
// GET /api/p1/watch (T-051, T-052) : dernier cours, référence de la variation, série réduite.
import { describe, expect, it } from 'vitest';
import type { FetchFn } from '../_lib/okx.js';
import { handleP1 } from '../_lib/p1.js';
import { createContext } from '../_lib/routes.js';
import { dailyAsset, thin, tiingoAsset } from '../_lib/watch.js';

const NOW = Date.parse('2026-11-23T20:30:00Z');
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const fx = (h: number, price: number) => ({ ts_source: iso(NOW - h * H), ts_recv: iso(NOW - h * H + 2000), price, bid: price - 0.0001, ask: price + 0.0001, prev_close: null, source: 'tiingo-fx' });

describe('Markets Watch : calculs', () => {
  it('change : variation sur 24 h seulement si la série couvre 20 h au moins', () => {
    const a = tiingoAsset('eurusd', [fx(25, 1.10), fx(23.9, 1.101), fx(12, 1.102), fx(0.05, 1.1031)], NOW);
    expect(a.ref).toEqual({ price: 1.101, ts: NOW - 23.9 * H, kind: '24h' });
    expect(a.last).toMatchObject({ price: 1.1031, ts_source: NOW - 0.05 * H });
    expect(a.series.map((p) => p.price)).toEqual([1.101, 1.102, 1.1031]);
    expect(tiingoAsset('eurusd', [fx(3, 1.1), fx(0.05, 1.2)], NOW).ref).toBeNull();
    expect(tiingoAsset('eurusd', [], NOW)).toEqual({ asset: 'eurusd', source: null, last: null, ref: null, series: [] });
  });

  it('IEX : clôture de la veille donnée par la source ; séries quotidiennes : observation précédente', () => {
    const q = tiingoAsset('qqq', [{ ts_source: iso(NOW - 60_000), ts_recv: iso(NOW), price: 724.045, bid: null, ask: null, prev_close: 689.81, source: 'tiingo-iex' }], NOW);
    expect(q.ref).toEqual({ price: 689.81, ts: NOW - 60_000, kind: 'veille' });
    const d = dailyAsset('us10y', [{ date: '2026-11-19T00:00:00+00:00', price: 5.04, recv: iso(NOW) }, { date: '2026-11-18T00:00:00+00:00', price: 5.07, recv: iso(NOW) }], 'fred');
    expect(d.last?.price).toBe(5.04);
    expect(d.ref).toEqual({ price: 5.07, ts: Date.parse('2026-11-18T00:00:00Z'), kind: 'veille' });
    expect(thin(Array.from({ length: 500 }, (_, i) => ({ t: i, price: i })), 120)).toHaveLength(120);
  });

  it('route : lit Supabase (clé secrète), ETF du PEA depuis les clôtures de Bourse', async () => {
    const urls: string[] = [];
    const fetch: FetchFn = async (url) => {
      urls.push(url);
      const u = new URL(url);
      const table = u.pathname.split('/').pop();
      const rows = table === 'instrument_listings' ? [{ id: 3, source_symbol: 'PUST.PAR', currency: 'EUR' }]
        : table === 'prices' ? [{ value_date: '2026-11-20', close: '93.77', received_at: iso(NOW), source: 'alphavantage' },
          { value_date: '2026-11-19', close: '99.40', received_at: iso(NOW), source: 'alphavantage' }]
          : table === 'p1_state' ? [{ value: { name: 'watch', status: 'connected' } }] : [];
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const ctx = createContext({ fetch, now: () => NOW, monotonic: () => 0, sleep: async () => {} },
      { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_0123456789abcdefghij' });
    const r = await handleP1(new Request('https://x/api/p1/watch?path=watch'), ctx);
    expect(r.status).toBe(200);
    const body = await r.json() as { assets: { asset: string; last: { price: number } | null; ref: { price: number } | null; currency?: string }[]; feed: unknown };
    expect(body.assets.map((a) => a.asset)).toEqual(['eurusd', 'usdjpy', 'xauusd', 'qqq', 'spy', 'us10y', 'usd-broad', 'pust', 'ese']);
    expect(body.assets.find((a) => a.asset === 'pust')).toMatchObject({ last: { price: 93.77 }, ref: { price: 99.4 }, currency: 'EUR' });
    expect(body.assets.find((a) => a.asset === 'ese')).toMatchObject({ last: null });
    expect(body.feed).toEqual({ name: 'watch', status: 'connected' });
  });
});
