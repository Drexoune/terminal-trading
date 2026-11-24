// @vitest-environment node
// /api/backtest/candles (section Backtest, S1) : une série en colonnes lue par la fonction SQL
// bt_candles_cols, actifs et unités de temps contrôlés, état de la collecte joint.
import { describe, expect, it } from 'vitest';
import { handleBacktest } from '../_lib/backtest.js';
import type { FetchFn } from '../_lib/okx.js';
import { createContext } from '../_lib/routes.js';

const ENV = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_0123456789abcdefghij' };
const NOW = Date.parse('2026-11-24T14:00:00Z');

function ctx(env: Record<string, string> = ENV) {
  const urls: string[] = [];
  const fetch: FetchFn = async (url) => {
    urls.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith('/rpc/bt_candles_cols')) {
      return new Response(JSON.stringify([{ t: [1, 2], o: [10, 11], h: [12, 13], l: [9, 10], c: [11, 12], v: [5, null], n: 2, source: 'okx' }]), { status: 200 });
    }
    return new Response(JSON.stringify([{ key: 'series', value: { 'BTC:1H': { complete: false, last: '2026-11-24T13:00:00Z' } } },
      { key: 'feed:candles', value: { status: 'connected' } }]), { status: 200 });
  };
  return { urls, c: createContext({ fetch, now: () => NOW, monotonic: () => 0, sleep: async () => {} }, env) };
}
const get = (c: ReturnType<typeof ctx>['c'], path: string) => handleBacktest(new Request(`https://x${path}`), c);

describe('/api/backtest/candles', () => {
  it('série en colonnes, état de la série horaire pour le 4H, cache réseau', async () => {
    const { c, urls } = ctx();
    const r = await get(c, '/api/backtest/candles?asset=btc&tf=4h');
    expect(r.headers.get('cache-control')).toMatch(/s-maxage=300/);
    const b = await r.json() as Record<string, unknown>;
    expect(b).toMatchObject({ asset: 'BTC', tf: '4H', n: 2, t: [1, 2], c: [11, 12], v: [5, null], aggregated: expect.stringMatching(/1 h/),
      series: { complete: false }, feed: { status: 'connected' } });
    const rpc = new URL(urls.find((u) => u.includes('/rpc/'))!);
    expect(Object.fromEntries(rpc.searchParams)).toMatchObject({ p_asset: 'BTC', p_tf: '4H' });
  });
  it('actif et unité de temps contrôlés ; route inconnue ; sans Supabase', async () => {
    const { c } = ctx();
    expect((await get(c, '/api/backtest/candles?asset=DOGE&tf=1D')).status).toBe(400);
    expect((await get(c, '/api/backtest/candles?asset=QQQ&tf=1H')).status).toBe(400);
    expect((await get(c, '/api/backtest/candles?asset=BTC&tf=1D&x=1')).status).toBe(400);
    expect((await get(c, '/api/backtest/nope')).status).toBe(404);
    expect((await get(c, '/api/backtest?path=candles&asset=SPY&tf=1D')).status).toBe(200);
    expect(await (await get(ctx({}).c, '/api/backtest/candles?asset=BTC&tf=1D')).json()).toMatchObject({ configured: false, n: 0 });
  });
});
