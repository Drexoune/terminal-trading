// @vitest-environment node
// Tâche « watch » (T-051, T-052) : heures de marché, lecture de Tiingo et de FRED, doublons, ménage.
import { describe, expect, it } from 'vitest';
import { MemRest } from '../p1-jobs/_memrest.ts';
import { fredLast, fredSeries, fxOpen, fxRows, iexRows, iexWindow, runWatch, type WatchDeps } from './watch.ts';

const FX = JSON.stringify([
  { ticker: 'eurusd', quoteTimestamp: '2026-11-23T20:32:07.684000+00:00', bidPrice: 1.1031, askPrice: 1.1032, midPrice: 1.10315 },
  { ticker: 'usdjpy', quoteTimestamp: '2026-11-23T20:32:07.100000+00:00', bidPrice: 158.96, askPrice: 158.962, midPrice: 158.961 },
  { ticker: 'xauusd', quoteTimestamp: '2026-11-23T20:32:07.684000+00:00', bidPrice: 3643.1, askPrice: 3643.2, midPrice: 3643.15 },
  { ticker: 'gbpusd', quoteTimestamp: null, midPrice: 1.3 },
]);
const IEX = JSON.stringify([
  { ticker: 'QQQ', timestamp: '2026-11-23T15:59:59-05:00', tngoLast: 724.045, prevClose: 689.81, bidPrice: null, askPrice: null },
  { ticker: 'SPY', timestamp: '2026-11-23T15:59:59-05:00', tngoLast: null, prevClose: 650.1 },
]);
const CSV = 'observation_date,DGS10\n2026-11-18,5.07\n2026-11-19,5.04\n2026-11-20,\n';

describe('watch : règles', () => {
  it('marché des changes : dimanche 17:00 → vendredi 17:00 à New York ; IEX 04:00–20:00 en semaine', () => {
    expect(fxOpen(Date.UTC(2026, 10, 22, 21, 59))).toBe(false);   // dimanche 16:59 à New York
    expect(fxOpen(Date.UTC(2026, 10, 22, 22, 0))).toBe(true);     // dimanche 17:00
    expect(fxOpen(Date.UTC(2026, 10, 27, 21, 59))).toBe(true);    // vendredi 16:59
    expect(fxOpen(Date.UTC(2026, 10, 27, 22, 0))).toBe(false);    // vendredi 17:00
    expect(fxOpen(Date.UTC(2026, 10, 28, 15, 0))).toBe(false);    // samedi
    expect(iexWindow(Date.UTC(2026, 10, 23, 8, 59))).toBe(false); // lundi 03:59
    expect(iexWindow(Date.UTC(2026, 10, 23, 9, 0))).toBe(true);
    expect(iexWindow(Date.UTC(2026, 10, 24, 1, 0))).toBe(false);  // lundi 20:00
  });

  it('lecture : milieu de fourchette pour le change, prix de référence IEX, rien d’inventé', () => {
    const fx = fxRows(FX, 'r');
    expect(fx.map((r) => [r.asset, r.price, r.bid])).toEqual([['eurusd', 1.10315, 1.1031], ['usdjpy', 158.961, 158.96], ['xauusd', 3643.15, 3643.1]]);
    expect(iexRows(IEX, 'r')).toEqual([{ asset: 'qqq', source: 'tiingo-iex', ts_source: '2026-11-23T15:59:59-05:00', ts_recv: 'r', price: 724.045,
      bid: null, ask: null, prev_close: 689.81 }]);
    expect(fredLast(CSV)).toEqual(['2026-11-19', 5.04]);
    expect(fredSeries(CSV)).toEqual([['2026-11-18', 5.07], ['2026-11-19', 5.04]]);
    expect(fredLast('observation_date,X\n')).toBeNull();
  });
});

describe('watch : passage', () => {
  function setup(now: number, env: Record<string, string> = { TIINGO_API_KEY: 'tok' }) {
    const rest = new MemRest();
    const urls: string[] = [];
    const deps: WatchDeps = {
      rest, now: () => now, env: (k) => env[k],
      fetch: async (url, init) => {
        urls.push(url);
        expect(JSON.stringify(init?.headers ?? {})).not.toContain('apikey');
        return { status: 200, text: async () => (url.includes('/fx/') ? FX : url.includes('/iex/') ? IEX : CSV) };
      },
    };
    return { rest, deps, urls };
  }

  it('lundi 15:00 à New York : change, IEX, FRED ; un cours relu n’est pas doublé', async () => {
    const { rest, deps, urls } = setup(Date.UTC(2026, 10, 23, 20, 0));
    const r = await runWatch(deps);
    expect(r).toMatchObject({ ok: true, fx: '3 cours', iex: '1 cours', rows: 8 });
    expect(urls.filter((u) => u.includes('tiingo')).length).toBe(2);
    expect(rest.rows('watch_quotes')).toHaveLength(8);
    await runWatch(deps);                                       // mêmes cotations, FRED relu < 6 h : rien de neuf
    expect(rest.rows('watch_quotes')).toHaveLength(8);
    const feed = rest.rows('p1_state').find((x) => x.key === 'feed:watch')!.value as Record<string, unknown>;
    expect(feed).toMatchObject({ status: 'connected', label: 'Watchlist', fx_open: true, iex_window: true });
  });

  it('samedi : aucune requête Tiingo ; cours de plus de 3 jours effacés, FRED gardé', async () => {
    const { rest, deps, urls } = setup(Date.UTC(2026, 10, 28, 12, 0));
    await rest.insert('watch_quotes', [
      { asset: 'eurusd', source: 'tiingo-fx', ts_source: 'a', ts_recv: '2026-11-20T10:00:00.000Z', price: 1 },
      { asset: 'us10y', source: 'fred', ts_source: 'b', ts_recv: '2026-11-20T10:00:00.000Z', price: 5 }]);
    await runWatch(deps);
    expect(urls.filter((u) => u.includes('tiingo'))).toEqual([]);
    expect(rest.rows('watch_quotes').map((x) => x.asset).sort()).toEqual(['us10y', 'us10y', 'us10y', 'usd-broad', 'usd-broad']);
  });

  it('clé absente : dit, sans requête Tiingo', async () => {
    const { deps, urls } = setup(Date.UTC(2026, 10, 23, 20, 0), {});
    const r = await runWatch(deps);
    expect(r.problems).toContain('TIINGO_API_KEY absente des secrets');
    expect(urls.some((u) => u.includes('tiingo'))).toBe(false);
  });
});
