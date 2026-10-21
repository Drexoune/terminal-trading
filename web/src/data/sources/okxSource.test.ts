/// <reference types="node" />
// Source OKX directe (Mode Online), contre une fausse WebSocket et un faux
// fetch : abonnements, maintien en vie, reconnexions, trous, horloge, et
// surtout mêmes clés et mêmes valeurs que la passerelle (fichier doré).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OkxEvent } from '../okx/parse';
import type {
  ClockState, ConnState, FeedState, FetchLike, Item, LatencySample, SourceSink, WebSocketLike,
} from '../protocol';
import {
  BACKOFF_MAX_MS, KEEPALIVE_MS, ONLINE_META, OPEN_TIMEOUT_MS, backoffDelay, createOkxSource,
  type OkxSourceOptions,
} from './okxSource';

const ROOT = `${resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')}/`;
const golden = JSON.parse(readFileSync(`${ROOT}collectors/tests/fixtures/parsed_golden.json`, 'utf-8')) as {
  cases: { name: string; recv_ms: number; raw: string; events?: OkxEvent[] }[];
};

// --- doublures -------------------------------------------------------------------

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  static of(url: string): FakeWebSocket[] {
    return FakeWebSocket.instances.filter((w) => w.url === url);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('socket non ouverte');
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  // côté serveur
  open(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }

  receive(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent);
  }

  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' } as CloseEvent);
  }

  get pings(): number {
    return this.sent.filter((s) => s === 'ping').length;
  }
}

class RecordingSink implements SourceSink {
  items: Item[] = [];
  state: Partial<ConnState> = {};
  latencies: LatencySample[] = [];
  item(key: string, value: unknown) { this.items.push([key, value]); }
  conn(patch: Partial<ConnState>) { Object.assign(this.state, patch); }
  latency(sample: LatencySample) { this.latencies.push(sample); }
  values<T>(key: string): T[] { return this.items.filter(([k]) => k === key).map(([, v]) => v as T); }
  last<T>(key: string): T | undefined { return this.values<T>(key).at(-1); }
}

const BTC = 'BTC-USDT-SWAP';
const ETH = 'ETH-USDT-SWAP';
const OPTS: OkxSourceOptions = {
  apiBase: 'https://terminal.test', publicWs: 'wss://pub.test', businessWs: 'wss://biz.test',
  instruments: [BTC, ETH], latencyKey: `trade:${BTC}`,
};
const instrument = (inst: string) => ({
  inst, ct_val: inst === BTC ? 0.01 : 0.1, ct_val_ccy: inst.split('-')[0], ct_type: 'linear',
  lot_sz: 0.01, min_sz: 0.01, tick_sz: 0.1, settle_ccy: 'USDT', state: 'live',
});

interface FetchPlan {
  okxAheadMs?: number;              // avance de l'horloge OKX sur le navigateur
  clockDelaysMs?: number[];         // aller-retour de chaque /api/okx-time
  clockDown?: boolean;
  instrumentFailures?: number;      // échecs avant la première réponse correcte
  extraField?: boolean;
}

function fakeFetch(plan: FetchPlan) {
  const calls: string[] = [];
  let failures = plan.instrumentFailures ?? 0;
  const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fn: FetchLike = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === '/api/okx-time') {
      if (plan.clockDown) return reply({ error: 'indisponible' }, 503);
      const d = plan.clockDelaysMs?.shift() ?? 0;
      const t0 = Date.now();
      await new Promise((r) => setTimeout(r, d));
      // OKX lit son heure tard dans le trajet : plus l'aller-retour est long,
      // plus l'estimation par le milieu se trompe (de 0,4 × aller-retour).
      return reply({ okx_ts: t0 + 0.9 * d + (plan.okxAheadMs ?? 0), fn_ts: t0, rtt_ms: d / 2 });
    }
    if (u.pathname === '/api/instruments') {
      if (failures > 0) {
        failures -= 1;
        return reply({ error: 'OKX injoignable' }, 502);
      }
      const inst = u.searchParams.get('inst')!;
      return reply({ ...instrument(inst), ...(plan.extraField ? { source: 'OKX EEA REST · Vercel' } : {}) });
    }
    return reply({ error: 'inconnu' }, 404);
  };
  return { fn, calls };
}

function setup(plan: FetchPlan = { clockDown: true }) {
  const sink = new RecordingSink();
  const http = fakeFetch(plan);
  const src = createOkxSource(OPTS, sink, {
    WebSocket: FakeWebSocket, fetch: http.fn, now: () => Date.now(), random: () => 0.5,
  });
  src.start();
  const pub = () => FakeWebSocket.of(OPTS.publicWs).at(-1)!;
  const biz = () => FakeWebSocket.of(OPTS.businessWs).at(-1)!;
  const subscribed = (ws: FakeWebSocket, channel = 'trades') => {
    ws.open();
    ws.receive({ id: 'sub', event: 'subscribe', arg: { channel, instId: BTC }, connId: 'c0ffee' });
  };
  const feed = (name: string) => sink.last<FeedState>(`feed:${name}`)!;
  return { sink, src, http, pub, biz, subscribed, feed };
}

const tradeMsg = (tradeId: number, ts: number, count = 1, inst = BTC) => ({
  arg: { channel: 'trades', instId: inst },
  data: [{ instId: inst, tradeId: String(tradeId), px: '81408', sz: '0.3', side: 'buy', ts: String(ts), count: String(count) }],
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_792_487_000_000);
  FakeWebSocket.instances = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// --- tests -----------------------------------------------------------------------

describe('source OKX directe : connexions', () => {
  it('ouvre deux connexions et s’abonne aux canaux de chaque instrument', () => {
    const { pub, biz } = setup();
    expect(FakeWebSocket.instances.map((w) => w.url)).toEqual([OPTS.publicWs, OPTS.businessWs]);
    pub().open();
    biz().open();
    expect(pub().sent.map((s) => JSON.parse(s))).toEqual([{
      id: 'sub', op: 'subscribe', args: [BTC, ETH].flatMap((instId) =>
        ['trades', 'tickers', 'funding-rate', 'open-interest'].map((channel) => ({ channel, instId }))),
    }]);
    expect(biz().sent.map((s) => JSON.parse(s))).toEqual([{
      id: 'sub', op: 'subscribe',
      args: [{ channel: 'candle1m', instId: BTC }, { channel: 'candle1m', instId: ETH }],
    }]);
  });

  it('publie l’origine des données et un état de connexion qui suit le flux public', () => {
    const { sink, pub, biz, subscribed } = setup();
    expect(sink.items[0]).toEqual(['gateway:meta', ONLINE_META]);
    expect(sink.state.status).toBe('connecting');
    subscribed(biz(), 'candle1m');
    expect(sink.state.status).toBe('connecting'); // les bougies seules ne suffisent pas
    subscribed(pub());
    expect(sink.state).toMatchObject({ status: 'open', since: Date.now(), attempts: 0, lastMessage: Date.now() });
    pub().drop();
    expect(sink.state).toMatchObject({ status: 'closed', since: null, attempts: 1 });
  });

  it('envoie « ping » après 20 s de silence et reconnecte sans réponse', async () => {
    const { pub, subscribed, feed } = setup();
    subscribed(pub());
    const first = pub();
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS - 1);
    expect(first.pings).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(first.pings).toBe(1);
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS - 1);
    expect(first.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(first.closed).toBe(true);
    expect(feed('okx-public')).toMatchObject({ status: 'reconnecting', reconnects: 1, connected_since_ms: null });
    expect(feed('okx-public').last_error).toMatch(/pas de pong en 20/);
    // délai : 1 s + gigue (random 0,5 -> 125 ms)
    await vi.advanceTimersByTimeAsync(1_124);
    expect(FakeWebSocket.of(OPTS.publicWs)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.of(OPTS.publicWs)).toHaveLength(2);
  });

  it('un « pong » ou tout autre message garde la connexion', async () => {
    const { pub, subscribed } = setup();
    subscribed(pub());
    const ws = pub();
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS);
    expect(ws.pings).toBe(1);
    ws.receive('pong');
    // Des messages réguliers : aucun ping, aucune coupure.
    for (let k = 0; k < 12; k++) {
      await vi.advanceTimersByTimeAsync(5_000);
      ws.receive(tradeMsg(100 + k, Date.now()));
    }
    expect(ws.pings).toBe(1);
    expect(ws.closed).toBe(false);
    expect(FakeWebSocket.of(OPTS.publicWs)).toHaveLength(1);
  });

  it('refait la connexion quand OKX refuse l’abonnement, puis referme la coupure', async () => {
    const { pub, subscribed, feed, sink } = setup();
    pub().open();
    const t0 = Date.now();
    pub().receive({ event: 'error', code: '60018', msg: 'Wrong URL or channel', connId: 'a4d3ae55' });
    expect(pub().closed).toBe(true);
    expect(feed('okx-public')).toMatchObject({ status: 'reconnecting', reconnects: 1 });
    expect(feed('okx-public').last_error).toContain('60018');
    await vi.advanceTimersByTimeAsync(1_125);
    expect(FakeWebSocket.of(OPTS.publicWs)).toHaveLength(2);
    subscribed(pub());
    expect(feed('okx-public')).toMatchObject({
      status: 'connected', connected_since_ms: t0 + 1_125, reconnects: 1, last_error: null,
      outages: [{ from_ms: t0, to_ms: t0 + 1_125, duration_ms: 1_125 }],
    });
    // Le délai ne repart du minimum qu'à la première donnée reçue.
    expect(sink.state).toMatchObject({ status: 'open', attempts: 1 });
    pub().receive(tradeMsg(100, Date.now()));
    await vi.advanceTimersByTimeAsync(1_000);   // état republié chaque seconde
    expect(sink.state).toMatchObject({ status: 'open', attempts: 0 });
  });

  it('abonnement confirmé puis coupure sans donnée : le délai grandit', async () => {
    const { pub, subscribed, sink } = setup();
    subscribed(pub());
    pub().drop();
    expect(sink.state.attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1_125);
    subscribed(pub());
    pub().drop();
    expect(sink.state.attempts).toBe(2);
  });

  // Réponse réelle d'OKX (wseea, 21/10/2026) : chaque argument reçoit sa propre
  // réponse, la connexion reste ouverte et les autres abonnements sont servis.
  const rejectedMsg = (channel: string, instId: string) => ({
    event: 'error', code: '60018', id: 'sub', connId: '484baa70',
    msg: `Subscribe failed, wrong URL or channel:${channel},instId:${instId} doesn't exist. `
      + 'Please use the correct URL, channel and parameters referring to API document.',
  });

  it('écarte un abonnement refusé (60018) sans couper le reste du flux', async () => {
    const { pub, subscribed, feed, sink } = setup();
    subscribed(pub());
    pub().receive(rejectedMsg('tickers', ETH));
    expect(pub().closed).toBe(false);
    expect(feed('okx-public')).toMatchObject({ status: 'connected', reconnects: 0, rejected: [`tickers ${ETH}`] });
    pub().receive(tradeMsg(100, Date.now()));
    expect(sink.values(`trade:${BTC}`)).toHaveLength(1);
    // À la reconnexion, l'abonnement refusé n'est plus demandé.
    pub().drop();
    await vi.advanceTimersByTimeAsync(1_125);
    pub().open();
    const args = JSON.parse(pub().sent[0]).args as { channel: string; instId: string }[];
    expect(args).toHaveLength(7);
    expect(args).not.toContainEqual({ channel: 'tickers', instId: ETH });
    expect(feed('okx-public').rejected).toEqual([`tickers ${ETH}`]);
  });

  it('tous les abonnements refusés : le flux s’arrête avec la raison', () => {
    const { biz, feed } = setup();
    biz().open();
    biz().receive(rejectedMsg('candle1m', BTC));
    biz().receive(rejectedMsg('candle1m', ETH));
    expect(biz().closed).toBe(true);
    expect(feed('okx-business')).toMatchObject({ status: 'stopped', rejected: [`candle1m ${BTC}`, `candle1m ${ETH}`] });
    expect(feed('okx-business').last_error).toBe(`tous les abonnements refusés par OKX : candle1m ${BTC}, candle1m ${ETH}`);
  });

  it('abandonne une ouverture trop longue et réessaie à délai croissant', async () => {
    const { pub } = setup();
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS);
    expect(pub().closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1_125);          // tentative 2 après 1 s + gigue
    expect(FakeWebSocket.of(OPTS.publicWs)).toHaveLength(2);
    pub().drop();
    await vi.advanceTimersByTimeAsync(2_249);          // tentative 3 après 2 s + gigue
    expect(FakeWebSocket.of(OPTS.publicWs)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.of(OPTS.publicWs)).toHaveLength(3);
  });

  it('délai de reconnexion : au moins 1 s, croissant, plafonné à 30 s', () => {
    for (const r of [0, 0.5, 0.999]) {
      const delays = Array.from({ length: 12 }, (_, k) => backoffDelay(k + 1, () => r));
      expect(delays[0]).toBeGreaterThanOrEqual(1_000);
      expect(delays[3]).toBeGreaterThan(delays[0]);
      expect(Math.max(...delays)).toBeLessThanOrEqual(BACKOFF_MAX_MS);
      delays.slice(1).forEach((d, k) => expect(d).toBeGreaterThanOrEqual(delays[k]));
    }
  });

  it('republie l’état des flux chaque seconde, sous la forme de FeedState.snapshot()', async () => {
    const { sink } = setup();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sink.values('feed:okx-public').length).toBeGreaterThanOrEqual(3);
    expect(sink.values('feed:okx-business').length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(sink.last<FeedState>('feed:okx-business')!)).toEqual([
      'name', 'status', 'connected_since_ms', 'last_message_ms', 'reconnects', 'outages', 'last_error',
      'rejected',
    ]);
  });

  it('s’arrête proprement', async () => {
    const { src, pub, biz, subscribed, http, feed } = setup();
    subscribed(pub());
    src.stop();
    expect(pub().closed && biz().closed).toBe(true);
    expect(feed('okx-public').status).toBe('stopped');
    const calls = http.calls.length;
    const sockets = FakeWebSocket.instances.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWebSocket.instances).toHaveLength(sockets);
    expect(http.calls).toHaveLength(calls);
  });
});

describe('source OKX directe : données', () => {
  // Clé de bus de chaque événement, comme OkxService._on_events côté passerelle.
  const keyOf = (e: OkxEvent) => e.kind === 'candle' ? `candle:${e.bar}:${e.inst}`
    : `${e.kind === 'open_interest' ? 'oi' : e.kind}:${e.inst}`;

  it('mêmes clés et mêmes valeurs que la passerelle, message par message (fichier doré)', () => {
    const { sink, pub, biz } = setup();
    pub().open();
    biz().open();
    const cases = golden.cases.filter((c) => c.events);
    expect(cases.length).toBeGreaterThan(100);
    for (const c of cases) {
      // Horloge OKX non mesurée : ts_recv = heure du navigateur, ici celle de l'enregistrement.
      vi.setSystemTime(c.recv_ms);
      const channel = (JSON.parse(c.raw).arg?.channel ?? '') as string;
      const before = sink.items.length;
      (channel.startsWith('candle') ? biz() : pub()).receive(c.raw);
      const published = sink.items.slice(before).filter(([k]) => !k.startsWith('gaps:'));
      expect(JSON.stringify(published), c.name)
        .toBe(JSON.stringify(c.events!.map((e) => [keyOf(e), e])));
    }
    expect(pub().closed || biz().closed).toBe(false);
  });

  it('publie les trous de séquence sous gaps:okx', () => {
    const { sink, pub, subscribed } = setup();
    subscribed(pub());
    pub().receive(tradeMsg(100, Date.now()));
    pub().receive(tradeMsg(103, Date.now(), 3));   // agrège 101 à 103 : continu
    expect(sink.values('gaps:okx')).toEqual([]);
    pub().receive(tradeMsg(113, Date.now()));
    expect(sink.values('gaps:okx')).toEqual([
      { count: 1, last: 'BTC-USDT-SWAP : 9 trade(s) manquant(s) entre 103 et 113', ts_recv: Date.now() },
    ]);
    pub().receive(tradeMsg(113, Date.now()));
    expect(sink.last('gaps:okx')).toMatchObject({ count: 2, last: expect.stringContaining('doublon') });
    expect(sink.values(`trade:${BTC}`)).toHaveLength(4); // un trou n'efface aucune donnée
  });

  it('lit les paramètres d’instrument une fois, sous la forme de rest.py', async () => {
    const { sink, http } = setup({ clockDown: true, extraField: true });
    await vi.advanceTimersByTimeAsync(0);
    const btc = sink.last(`instrument:${BTC}`);
    expect(JSON.stringify(btc)).toBe(JSON.stringify(instrument(BTC))); // champ en trop écarté
    expect(sink.last(`instrument:${ETH}`)).toEqual(instrument(ETH));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(http.calls.filter((u) => u.includes('/api/instruments'))).toEqual([
      `${OPTS.apiBase}/api/instruments?inst=${BTC}`, `${OPTS.apiBase}/api/instruments?inst=${ETH}`,
    ]);
  });

  it('réessaie les paramètres d’instrument sans jamais en supposer', async () => {
    const { sink } = setup({ clockDown: true, instrumentFailures: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sink.values(`instrument:${BTC}`)).toEqual([]);
    expect(sink.values(`instrument:${ETH}`)).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sink.last(`instrument:${BTC}`)).toEqual(instrument(BTC));
    expect(sink.last(`instrument:${ETH}`)).toEqual(instrument(ETH));
  });
});

describe('source OKX directe : horloge et latence', () => {
  it('mesure l’écart avec OKX au plus court aller-retour et corrige les heures de réception', async () => {
    const start = Date.now();
    const { sink, pub, subscribed } = setup({ okxAheadMs: 500, clockDelaysMs: [80, 30, 200, 50, 120] });
    subscribed(pub());
    pub().receive(tradeMsg(1, Date.now() - 100));
    expect(sink.latencies).toEqual([]); // pas de latence sans horloge mesurée
    await vi.advanceTimersByTimeAsync(2_000);
    // meilleur échantillon : aller-retour 30 ms -> écart 500 + 0,4 × 30
    const clock = sink.last<ClockState>('clock:okx')!;
    // publiée à la fin de la série : 5 allers-retours + 4 × 200 ms d'espacement
    const published = start + 80 + 30 + 200 + 50 + 120 + 4 * 200;
    expect(clock).toEqual({ offset_ms: 512, uncertainty_ms: 15, ok: true, ts_recv: published + 512 });
    expect(Object.keys(clock)).toEqual(['offset_ms', 'uncertainty_ms', 'ok', 'ts_recv']);
    expect(sink.state).toMatchObject({ offsetMs: 512, rttMs: 30 });

    // Trade horodaté par OKX 120 ms avant sa réception (heure OKX).
    const okxNow = Date.now() + 500;
    pub().receive(tradeMsg(2, okxNow - 120));
    const t = sink.last<{ ts_recv: number; ts_source: number }>(`trade:${BTC}`)!;
    expect(t.ts_recv).toBe(Date.now() + 512);
    expect(sink.latencies).toEqual([{ total: 132, okxToGateway: null, gatewayToScreen: null }]);
    // Les autres instruments n'entrent pas dans la latence du flux principal.
    pub().receive(tradeMsg(5, okxNow, 1, ETH));
    expect(sink.latencies).toHaveLength(1);
  });

  it('refait la mesure chaque minute, 5 échantillons à chaque fois', async () => {
    const { http } = setup({ okxAheadMs: 0 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(http.calls.filter((u) => u.endsWith('/api/okx-time'))).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(http.calls.filter((u) => u.endsWith('/api/okx-time'))).toHaveLength(10);
  });

  it('signale une horloge de navigateur décalée de plus de 5 s', async () => {
    const { sink } = setup({ okxAheadMs: -7_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sink.last<ClockState>('clock:okx')).toMatchObject({ offset_ms: -7_000, ok: false });
  });

  it('sans /api/okx-time, les données passent quand même, sans latence', async () => {
    const { sink, pub, subscribed } = setup({ clockDown: true });
    await vi.advanceTimersByTimeAsync(2_000);
    subscribed(pub());
    pub().receive(tradeMsg(1, Date.now()));
    expect(sink.values('clock:okx')).toEqual([]);
    expect(sink.values(`trade:${BTC}`)).toHaveLength(1);
    expect(sink.latencies).toEqual([]);
    expect(sink.state.offsetMs).toBeUndefined();
  });
});
