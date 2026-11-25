// @vitest-environment node
// Moteur de la microstructure (P5) : bout à bout avec de fausses WebSockets (messages réels des
// fixtures) et un faux REST — carnet agrégé publié, rattrapage de la CVD à l'ouverture (bougies
// Binance sur les 4 h, OKX par `www`), coupure d'un flux publiée et tranche en cours en trou.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike, Item, WebSocketLike } from '../data/protocol';
import { MicroEngine } from './engine';
import { OKX_WS } from './venues/okx';
import { BYBIT_WS } from './venues/bybit';
import { BINANCE_MARKET } from './venues/binance';
import type { CvdState } from './cvd';
import type { AggBook } from './aggBook';
import type { MicroFeedState } from './stream';
import type { RestState } from './engine';

const fx = (v: string) => JSON.parse(readFileSync(new URL(`./fixtures/${v}.json`, import.meta.url), 'utf8')) as Record<string, unknown[]>;

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
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.({} as Event); }
  receive(d: unknown) { this.onmessage?.({ data: typeof d === 'string' ? d : JSON.stringify(d) } as MessageEvent); }
  drop() { this.readyState = 3; this.onclose?.({ code: 1006, reason: '' } as CloseEvent); }
}

const get = <T,>(items: Item[], k: string) => items.filter(([key]) => key === k).at(-1)?.[1] as T | undefined;
const NOW = Date.parse('2026-11-25T14:30:00Z');

beforeEach(() => { FakeWs.all = []; vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

function setup() {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const json = async (): Promise<unknown> => {
      if (url.includes('/klines')) {
        const from = Number(/startTime=(\d+)/.exec(url)![1]), to = Number(/endTime=(\d+)/.exec(url)![1]);
        const rows = [];
        for (let t = from; t <= to && t + 60_000 <= Date.now(); t += 60_000) rows.push([t, '1', '1', '1', '1', '10', t + 59_999, '0', 1, '6', '0', '0']);
        return rows;
      }
      if (url.includes('taker-volume')) {
        const rows = [];
        for (let t = Math.floor(Date.now() / 300_000) * 300_000; t > Date.now() - 5 * 3_600_000; t -= 300_000) rows.push([String(t), '1', '2']);
        return { code: '0', msg: '', data: rows };
      }
      if (url.includes('books-full')) return { code: '0', msg: '', data: [{ ts: String(Date.now()), bids: [['59000', '100']], asks: [['61000', '100']] }] };
      if (url.includes('liquidation-orders')) return { code: '0', msg: '', data: [] };
      if (url.includes('fapi/v1/depth')) return { lastUpdateId: 1, E: 1, bids: [], asks: [] };
      return {};
    };
    return { ok: true, status: 200, json };
  };
  const e = new MicroEngine({ WebSocket: FakeWs as never, fetch, now: () => Date.now(), random: () => 0, okxStatsBase: 'https://relais.test/okx' });
  return { e, calls };
}

describe('moteur', () => {
  it('rattrapage de la CVD à l’ouverture : 4 h de bougies Binance, OKX par www, courbes prêtes', async () => {
    const { e, calls } = setup();
    e.start();
    await vi.advanceTimersByTimeAsync(0);
    const kl = calls.filter((u) => u.includes('/klines'));
    expect(kl).toHaveLength(2);
    expect(kl[0]).toContain(`startTime=${NOW - 4 * 3_600_000}`);
    expect(calls.some((u) => u.startsWith('https://relais.test/okx/rubik/stat/taker-volume-contract'))).toBe(true);
    const cvd = get<CvdState>(e.publish(), 'micro:cvd')!;
    expect(cvd.ready).toBe(true);
    expect(cvd.perp_venues.sort()).toEqual(['binance', 'okx']);
    // Fenêtre = 239 minutes closes + la minute en cours. Binance : bougies closes depuis 2 s au
    // moins (238 dans la fenêtre) × (6 − 4) ; OKX : 48 tranches × (2 − 1), la première à 4/5 dans la fenêtre.
    expect(cvd.perp).toBeCloseTo(238 * 2 + 47.8, 6);
    // La dernière minute close (il y a moins de 2 s) est rattrapée au contrôle suivant (10 s).
    expect(cvd.holes.filter((h) => h.id.startsWith('binance')).map((h) => h.from)).toEqual([NOW - 60_000, NOW - 60_000]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(get<CvdState>(e.publish(), 'micro:cvd')!.holes.filter((h) => h.id.startsWith('binance'))).toEqual([]);
    expect(get<RestState[]>(e.publish(), 'micro:rest')).toBeUndefined();   // publié avec l'état complet, une fois par seconde
    e.stop();
  });

  it('sans relais des statistiques d’OKX : courbes Binance seules, OKX en direct à part, OI 24 h « — » avec la raison', async () => {
    const calls: string[] = [];
    const e = new MicroEngine({ WebSocket: FakeWs as never, random: () => 0, now: () => Date.now(),
      fetch: async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => (url.includes('/klines') ? [] : {}) }; } });
    e.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.some((u) => u.includes('rubik'))).toBe(false);
    const okx = FakeWs.last(OKX_WS); okx.open();
    okx.receive(fx('okx')['okx__trades__BTC-USDT-SWAP__'][0]);
    okx.receive(fx('okx')['okx__open-interest__BTC-USDT-SWAP__'][0]);
    const items = e.publish();
    const cvd = get<CvdState>(items, 'micro:cvd')!;
    expect(cvd.perp_venues).toEqual(['binance']);
    expect(cvd.others.map((o) => o.venue)).toEqual(['okx']);
    const f = get<{ rows: { venue: string; oi_24h_reason: string | null }[] }>(items, 'micro:funding')!;
    expect(f.rows.find((r) => r.venue === 'okx')!.oi_24h_reason).toMatch(/aucun en-tête CORS/);
    e.stop();
  });

  it('heure du dernier message republiée chaque seconde, sans changement d’état', async () => {
    const { e } = setup();
    e.start();
    const by = FakeWs.last(BYBIT_WS); by.open();
    by.receive({ op: 'subscribe', success: true });
    await vi.advanceTimersByTimeAsync(5_000);
    by.receive({ topic: 'tickers.BTCUSDT', type: 'delta', ts: 1, data: {} });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(get<MicroFeedState>(e.publish(), 'micro:feed:bybit')!.last_message_ms).toBe(NOW + 5_000);
    e.stop();
  });

  it('carnets réels d’OKX et de Bybit agrégés ; coupure publiée, flux de CVD en trou', async () => {
    const { e } = setup();
    e.start();
    await vi.advanceTimersByTimeAsync(0);
    const okx = FakeWs.last(OKX_WS); okx.open();
    const fo = fx('okx');
    okx.receive(fo['okx__books__BTC-USDT-SWAP__snapshot'][0]);
    const by = FakeWs.last(BYBIT_WS); by.open();
    by.receive(fx('bybit')['bybit__orderbook.1000.BTCUSDT__snapshot'][0]);
    const book = get<AggBook>(e.publish(), 'micro:book')!;
    expect(book.venues.sort()).toEqual(['bybit', 'okx']);
    expect(book.bids).toHaveLength(10);
    // Fixtures relevées à quelques minutes d'écart : seul le calcul du croisement est vérifié ici.
    expect(book.crossed).toBe(book.best_bid! >= book.best_ask!);
    expect(book.bids[0].sz).toBeGreaterThan(0);

    const m = FakeWs.last(BINANCE_MARKET); m.open();
    for (const t of fx('binance')['binance-market__btcusdt-aggTrade']) m.receive(t);
    m.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    const feed = get<MicroFeedState>(e.publish(), 'micro:feed:binance-perp')!;
    expect(feed.status).toBe('reconnecting');
    expect(feed.last_error).toMatch(/connexion fermée/);
    expect(feed.stale_after_ms).toBe(30_000);
    e.stop();
  });
});
