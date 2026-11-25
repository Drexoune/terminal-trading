// @vitest-environment node
// Microstructure (P5, étape S1) : connexions et adaptateurs contre une fausse WebSocket, avec des
// messages réels relevés le 24/11/2026 (scripts/explore_micro.py → micro/fixtures). Reconnexion à
// délai croissant et journal des coupures, maintien en vie, carnets resynchronisés après une
// rupture de séquence (OKX seqId, Binance pu, Bybit u), liquidations « plancher » de Binance et
// d'OKX, sens des trades (Coinbase : côté du teneur de marché), tailles OKX en contrats.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike, WebSocketLike } from '../data/protocol';
import { createBinance, BINANCE_DEPTH, BINANCE_MARKET, BINANCE_PUBLIC } from './venues/binance';
import { createBybit, BYBIT_WS } from './venues/bybit';
import { createCoinbase, COINBASE_WS } from './venues/coinbase';
import { createHyperliquid, HL_WS } from './venues/hyperliquid';
import { createOkx, CT_VAL, OKX_WS } from './venues/okx';
import type { VenueCtx } from './venues/ctx';
import type { MicroFeedState } from './stream';
import type { MicroEvent } from './types';

type Fx = Record<string, unknown[]>;
const fx = (v: string) => JSON.parse(readFileSync(new URL(`./fixtures/${v}.json`, import.meta.url), 'utf8')) as Fx;

class FakeWs implements WebSocketLike {
  static all: FakeWs[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  constructor(readonly url: string) { FakeWs.all.push(this); }
  static last(url: string) { return FakeWs.all.filter((w) => w.url === url).at(-1)!; }
  static count(url: string) { return FakeWs.all.filter((w) => w.url === url).length; }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.({} as Event); }
  receive(d: unknown) { this.onmessage?.({ data: typeof d === 'string' ? d : JSON.stringify(d) } as MessageEvent); }
  drop() { this.readyState = 3; this.onclose?.({ code: 1006, reason: '' } as CloseEvent); }
}

function ctx(fetch: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}) })) {
  const events: MicroEvent[] = [];
  const feeds = new Map<string, MicroFeedState>();
  const c: VenueCtx = {
    deps: { WebSocket: FakeWs as never, now: () => Date.now(), random: () => 0, fetch },
    emit: (e) => events.push(e), onFeed: (s) => feeds.set(s.name, s),
  };
  return { c, events, feeds };
}

beforeEach(() => { FakeWs.all = []; vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-11-24T19:43:10Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('connexion', () => {
  it('reconnexion à délai croissant (1, 2, 4 s…), coupure journalisée à la reprise', async () => {
    const { c, feeds } = ctx();
    const a = createCoinbase(c);
    a.streams[0].start();
    FakeWs.last(COINBASE_WS).open();
    FakeWs.last(COINBASE_WS).receive({ type: 'subscriptions' });
    expect(feeds.get('coinbase')!.status).toBe('connected');
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      FakeWs.last(COINBASE_WS).drop();
      const before = FakeWs.count(COINBASE_WS);
      let t = 0;
      while (FakeWs.count(COINBASE_WS) === before) { await vi.advanceTimersByTimeAsync(100); t += 100; }
      delays.push(t);
    }
    expect(delays).toEqual([1000, 2000, 4000]);
    expect(feeds.get('coinbase')!.status).toBe('reconnecting');
    FakeWs.last(COINBASE_WS).open();
    FakeWs.last(COINBASE_WS).receive({ type: 'subscriptions' });
    const s = feeds.get('coinbase')!;
    expect(s.status).toBe('connected');
    expect(s.outages).toHaveLength(1);
    expect(s.outages[0].duration_ms).toBeGreaterThanOrEqual(7000);
  });

  it('maintien en vie : ping après le silence, reconnexion sans réponse', async () => {
    const { c, feeds } = ctx();
    createBybit(c).streams[0].start();
    const ws = FakeWs.last(BYBIT_WS);
    ws.open();
    ws.receive({ op: 'subscribe', success: true });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ws.sent.at(-1)).toBe('{"op":"ping"}');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(feeds.get('bybit')!.status).toBe('reconnecting');
    expect(feeds.get('bybit')!.last_error).toMatch(/aucun message/);
  });
});

describe('OKX', () => {
  const f = fx('okx');
  it('carnet : instantané puis mises à jour réelles, tailles en BTC (contrats × 0,01)', () => {
    const { c } = ctx();
    const a = createOkx(c);
    a.streams[0].start();
    const ws = FakeWs.last(OKX_WS); ws.open();
    ws.receive({ event: 'subscribe', arg: { channel: 'books' } });
    ws.receive(f['okx__books__BTC-USDT-SWAP__snapshot'][0]);
    for (const u of f['okx__books__BTC-USDT-SWAP__update']) ws.receive(u);
    const v = a.books[0].view();
    expect(v.synced).toBe(true);
    expect(v.bids.px[0]).toBeLessThan(v.asks.px[0]);
    const snap = (f['okx__books__BTC-USDT-SWAP__snapshot'][0] as { data: { asks: string[][] }[] }).data[0].asks;
    expect(a.books[0].asks.size).toBeGreaterThan(300);
    expect(Math.max(...[...a.books[0].asks.values()])).toBeLessThan(Math.max(...snap.map((r) => Number(r[1]))) * CT_VAL * 10);
  });
  it('rupture de seqId : trou journalisé, carnet remis à zéro, réabonnement du seul carnet', () => {
    const { c, feeds } = ctx();
    const a = createOkx(c);
    a.streams[0].start();
    const ws = FakeWs.last(OKX_WS); ws.open();
    ws.receive(f['okx__books__BTC-USDT-SWAP__snapshot'][0]);
    const u = f['okx__books__BTC-USDT-SWAP__update'] as { data: { prevSeqId: number }[] }[];
    ws.receive(u[1]);                                         // u[0] manquant
    expect(feeds.get('okx-micro')!.gaps.at(-1)!.text).toMatch(/carnet resynchronisé : seqId attendu/);
    expect(a.books[0].synced).toBe(false);
    expect(ws.sent.slice(-2).map((s) => JSON.parse(s).op)).toEqual(['unsubscribe', 'subscribe']);
    expect(JSON.parse(ws.sent.at(-1)!).args).toEqual([{ channel: 'books', instId: 'BTC-USDT-SWAP' }]);
  });
  it('trades swap en BTC, spot tel quel ; liquidations BTC seulement, marquées plancher', () => {
    const { c, events } = ctx();
    createOkx(c).streams[0].start();
    const ws = FakeWs.last(OKX_WS); ws.open();
    const t = f['okx__trades__BTC-USDT-SWAP__'][0] as { data: { sz: string; side: string }[] };
    ws.receive(t);
    const e = events.find((x) => x.kind === 'trade')!;
    expect(e.kind === 'trade' && e.t.sz).toBeCloseTo(Number(t.data[0].sz) * CT_VAL, 9);
    ws.receive({ arg: { channel: 'liquidation-orders', instType: 'SWAP' }, data: [
      { instId: 'ETH-USDT-SWAP', details: [{ posSide: 'long', side: 'sell', sz: '3', bkPx: '2000', ts: '1' }] },
      { instId: 'BTC-USDT-SWAP', details: [{ posSide: 'short', side: 'buy', sz: '250', bkPx: '60000', ts: '2' }] }] });
    const liqs = events.filter((x) => x.kind === 'liq');
    expect(liqs).toHaveLength(1);
    expect(liqs[0]).toMatchObject({ l: { venue: 'okx', side: 'short', sz: 2.5, usd: 150_000, floor: true } });
  });
  it('funding : intervalle déduit des échéances ; prime marque / indice', () => {
    const { c, events } = ctx();
    createOkx(c).streams[0].start();
    const ws = FakeWs.last(OKX_WS); ws.open();
    for (const k of ['okx__funding-rate__BTC-USDT-SWAP__', 'okx__mark-price__BTC-USDT-SWAP__', 'okx__index-tickers__BTC-USDT__']) ws.receive(f[k][0]);
    expect(events.find((e) => e.kind === 'funding')).toMatchObject({ f: { venue: 'okx', interval_h: 8 } });
    expect(events.find((e) => e.kind === 'premium')).toBeTruthy();
  });
});

describe('Binance', () => {
  const diff = (U: number, u: number, pu: number, b: string[][] = [], a: string[][] = []) =>
    ({ stream: 'btcusdt@depth@100ms', data: { e: 'depthUpdate', E: 1, T: 1, U, u, pu, b, a } });
  function setup(...ids: number[]) {
    const calls: string[] = [];
    let k = 0;
    const fetch: FetchLike = async (url) => {
      calls.push(url);
      const lastUpdateId = url === BINANCE_DEPTH ? ids[Math.min(k++, ids.length - 1)] : 0;
      return { ok: true, status: 200, json: async () => (url === BINANCE_DEPTH
        ? { lastUpdateId, E: 1, bids: [['60000', '2'], ['59990', '1']], asks: [['60010', '3'], ['60020', '1']] } : []) };
    };
    const { c, events, feeds } = ctx(fetch);
    const a = createBinance(c);
    a.streams.forEach((s) => s.start());
    const ws = FakeWs.last(BINANCE_PUBLIC); ws.open();
    return { a, ws, calls, events, feeds };
  }
  it('diffs mis de côté, instantané REST, premier diff couvrant lastUpdateId, puis continuité pu', async () => {
    const { a, ws, calls } = setup(100);
    ws.receive(diff(90, 95, 89));                             // avant l'instantané : écarté
    ws.receive(diff(96, 105, 95, [['60000', '0']]));          // couvre 100
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter((u) => u === BINANCE_DEPTH)).toHaveLength(1);
    expect(a.books[0].synced).toBe(true);
    expect(a.books[0].bestBid()).toBe(59990);
    ws.receive(diff(106, 110, 105, [], [['60005', '1']]));
    expect(a.books[0].bestAsk()).toBe(60005);
  });
  it('instantané plus récent que tous les diffs du tampon : le diff suivant qui le couvre est appliqué sans resynchronisation', async () => {
    const { a, ws, feeds } = setup(100);
    ws.receive(diff(90, 95, 89));                             // tampon entièrement antérieur à l'instantané
    await vi.advanceTimersByTimeAsync(0);
    expect(a.books[0].synced).toBe(true);
    ws.receive(diff(96, 99, 95));                             // u < 100 : écarté
    ws.receive(diff(100, 104, 99, [['60000', '5']]));         // couvre 100
    ws.receive(diff(105, 108, 104));
    expect(feeds.get('binance-book')?.gaps ?? []).toEqual([]);
    expect(a.books[0].bids.get(60000)).toBe(5);
  });
  it('rupture de pu : trou journalisé, nouvel instantané ; instantané en retard : nouvel essai', async () => {
    const { a, ws, calls, feeds } = setup(100, 100, 135);
    ws.receive(diff(96, 105, 95));
    await vi.advanceTimersByTimeAsync(0);
    ws.receive(diff(120, 130, 119));
    expect(feeds.get('binance-book')!.gaps.at(-1)!.text).toBe('carnet resynchronisé : pu 119 au lieu de 105');
    expect(a.books[0].synced).toBe(false);
    ws.receive(diff(131, 140, 130));
    await vi.advanceTimersByTimeAsync(0);
    expect(feeds.get('binance-book')!.gaps.at(-1)!.text).toBe('instantané REST plus ancien que les diffs : nouvel essai');
    await vi.advanceTimersByTimeAsync(500);
    expect(calls.filter((u) => u === BINANCE_DEPTH)).toHaveLength(3);
    expect(a.books[0].synced).toBe(true);
    ws.receive(diff(141, 150, 140));
    expect(a.books[0].synced).toBe(true);
  });
  it('liquidations BTC (plancher, S = SELL : position longue), aggTrade réel (m : vente agressive)', () => {
    const { ws: _w, events } = setup(1);
    const m = FakeWs.last(BINANCE_MARKET); m.open();
    m.receive({ stream: 'btcusdt@forceOrder', data: { e: 'forceOrder', E: 1, o: { s: 'BTCUSDT', S: 'SELL', q: '0.5', z: '0.5', p: '59000', ap: '59100', T: 5 } } });
    m.receive({ stream: '!forceOrder@arr', data: { e: 'forceOrder', E: 1, o: { s: 'ETHUSDT', S: 'BUY', q: '1', z: '1', p: '2000', ap: '2000', T: 5 } } });
    for (const t of fx('binance')['binance-market__btcusdt-aggTrade']) m.receive(t);
    const liqs = events.filter((e) => e.kind === 'liq');
    expect(liqs).toEqual([{ kind: 'liq', l: expect.objectContaining({ venue: 'binance', side: 'long', sz: 0.5, px: 59100, floor: true }) }]);
    const trades = events.filter((e) => e.kind === 'trade');
    const raw = fx('binance')['binance-market__btcusdt-aggTrade'] as { data: { m: boolean } }[];
    expect(trades.map((e) => e.kind === 'trade' && e.t.side)).toEqual(raw.map((r) => (r.data.m ? 'sell' : 'buy')));
  });
});

describe('Bybit', () => {
  const f = fx('bybit');
  it('carnet réel : instantané puis deltas ; delta manquant → resynchronisation', () => {
    const { c, feeds } = ctx();
    const a = createBybit(c);
    a.streams[0].start();
    const ws = FakeWs.last(BYBIT_WS); ws.open();
    ws.receive(f['bybit__orderbook.1000.BTCUSDT__snapshot'][0]);
    const d = f['bybit__orderbook.1000.BTCUSDT__delta'];
    for (const x of d.slice(0, 5)) ws.receive(x);
    expect(a.books[0].synced).toBe(true);
    expect(a.books[0].crossed()).toBe(false);
    ws.receive(d[6]);
    expect(feeds.get('bybit')!.gaps.at(-1)!.text).toMatch(/u attendu/);
    expect(ws.sent.slice(-2).map((s) => JSON.parse(s).op)).toEqual(['unsubscribe', 'subscribe']);
  });
  it('liquidations complètes (S = Buy : position longue), tickers fusionnés', () => {
    const { c, events } = ctx();
    createBybit(c).streams[0].start();
    const ws = FakeWs.last(BYBIT_WS); ws.open();
    ws.receive({ topic: 'allLiquidation.BTCUSDT', type: 'snapshot', ts: 1, data: [{ T: 1, s: 'BTCUSDT', S: 'Buy', v: '0.2', p: '59000' }] });
    expect(events[0]).toEqual({ kind: 'liq', l: expect.objectContaining({ venue: 'bybit', side: 'long', floor: false, usd: 11_800 }) });
    ws.receive(f['bybit__tickers.BTCUSDT__snapshot'][0]);
    for (const t of f['bybit__tickers.BTCUSDT__delta']) ws.receive(t);
    expect(events.some((e) => e.kind === 'funding')).toBe(true);
    expect(events.some((e) => e.kind === 'oi')).toBe(true);
  });
});

describe('Hyperliquid et Coinbase', () => {
  it('Hyperliquid : carnets rangés selon leur pas (10 $ fin, 100 $ profond), funding horaire', () => {
    const { c, events } = ctx();
    const a = createHyperliquid(c);
    a.streams[0].start();
    const ws = FakeWs.last(HL_WS); ws.open();
    const lv = (st: number) => [[0, 1, 2].map((i) => ({ px: String(60000 - i * st), sz: '1', n: 1 })), [0, 1, 2].map((i) => ({ px: String(60000 + (i + 1) * st), sz: '1', n: 1 }))];
    ws.receive({ channel: 'l2Book', data: { coin: 'BTC', time: 1, levels: lv(10) } });
    ws.receive({ channel: 'l2Book', data: { coin: 'BTC', time: 1, levels: lv(100) } });
    ws.receive({ channel: 'l2Book', data: { coin: 'BTC', time: 1, levels: lv(1) } });
    expect(a.books[0].bestAsk()).toBe(60010);
    expect(a.books[1].bestAsk()).toBe(60100);
    for (const m of fx('hyperliquid')['hyperliquid__activeAssetCtx']) ws.receive(m);
    expect(events.find((e) => e.kind === 'funding')).toMatchObject({ f: { venue: 'hyperliquid', interval_h: 1 } });
  });
  it('Coinbase : side = teneur de marché, donc inversé ; trou de trade_id journalisé', () => {
    const { c, events, feeds } = ctx();
    createCoinbase(c).streams[0].start();
    const ws = FakeWs.last(COINBASE_WS); ws.open();
    const base = { type: 'match', product_id: 'BTC-USD', price: '60000', size: '0.1', time: '2026-11-24T19:43:09.358Z' };
    ws.receive({ ...base, trade_id: 10, side: 'sell' });
    ws.receive({ ...base, trade_id: 13, side: 'buy' });
    expect(events.map((e) => e.kind === 'trade' && e.t.side)).toEqual(['buy', 'sell']);
    expect(feeds.get('coinbase')!.gaps.at(-1)!.text).toBe('2 trade(s) manquant(s)');
  });
});
