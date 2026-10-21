// Source passerelle (Modes Local et Tour) : comportement repris de l'ancien
// worker, vérifié contre une fausse WebSocket.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnState, Item, LatencySample, SourceSink, WebSocketLike } from '../protocol';
import { PING_EVERY_MS, createGatewaySource } from './gatewaySource';

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; this.readyState = 3; this.onclose?.({ code: 1000, reason: '' } as CloseEvent); }
  open() { this.readyState = 1; this.onopen?.({} as Event); }
  receive(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent); }
  json() { return this.sent.map((s) => JSON.parse(s)); }
}

class RecordingSink implements SourceSink {
  items: Item[] = [];
  state: Partial<ConnState> = {};
  latencies: LatencySample[] = [];
  item(key: string, value: unknown) { this.items.push([key, value]); }
  conn(patch: Partial<ConnState>) { Object.assign(this.state, patch); }
  latency(sample: LatencySample) { this.latencies.push(sample); }
}

const WS_URL = 'wss://tour.example.ts.net/ws';
const TOPICS = ['ticker:', 'trade:'];
const KEY = 'trade:BTC-USDT-SWAP';

function setup() {
  const sink = new RecordingSink();
  const src = createGatewaySource({ wsUrl: WS_URL, topics: TOPICS, latencyKey: KEY }, sink,
    { WebSocket: FakeWebSocket, now: () => Date.now(), random: () => 0.5 });
  src.start();
  return { sink, src, ws: () => FakeWebSocket.instances.at(-1)! };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_792_487_000_000);
  FakeWebSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('source passerelle', () => {
  it('s’abonne aux préfixes puis envoie un premier ping', () => {
    const { ws, sink } = setup();
    expect(ws().url).toBe(WS_URL);
    expect(sink.state.status).toBe('connecting');
    ws().open();
    expect(ws().json()).toEqual([
      { op: 'subscribe', topics: TOPICS },
      { op: 'ping', id: 1, t0: Date.now() },
    ]);
  });

  it('déduit l’écart d’horloge et l’aller-retour du pong', async () => {
    const { ws, sink } = setup();
    ws().open();
    const t0 = Date.now();
    await vi.advanceTimersByTimeAsync(40);
    // passerelle en avance de 500 ms ; aller 20 ms, retour 20 ms
    ws().receive({ type: 'pong', id: 1, t0, ts: t0 + 20 + 500 });
    expect(sink.state).toMatchObject({ offsetMs: 500, rttMs: 40 });
  });

  it('relaie les valeurs, passe « ouverte » et découpe la latence des deltas', () => {
    const { ws, sink } = setup();
    ws().open();
    const t0 = Date.now();
    ws().receive({ type: 'hello', app: 'TERMINAL', version: '0', ts_sent: t0 });
    expect(sink.state.status).toBe('connecting');
    ws().receive({ type: 'pong', id: 1, t0, ts: t0 + 500 }); // écart 500 ms, aller-retour nul
    const trade = { inst: 'BTC-USDT-SWAP', ts_source: t0 + 500 - 160, ts_recv: t0 + 500 - 44 };
    ws().receive({ type: 'snapshot', items: [[KEY, trade], ['ticker:BTC-USDT-SWAP', { last: 1 }]], ts_sent: t0 });
    expect(sink.items).toEqual([[KEY, trade], ['ticker:BTC-USDT-SWAP', { last: 1 }]]);
    expect(sink.state).toMatchObject({ status: 'open', since: t0 + 500, lastMessage: t0 + 500 });
    expect(sink.latencies).toEqual([]); // l'instantané n'est pas un trade frais
    ws().receive({ type: 'delta', items: [[KEY, trade]], ts_sent: t0 });
    expect(sink.latencies).toEqual([{ total: 160, okxToGateway: 116, gatewayToScreen: 44 }]);
  });

  it('pingue toutes les 5 s', async () => {
    const { ws } = setup();
    ws().open();
    await vi.advanceTimersByTimeAsync(PING_EVERY_MS * 3);
    expect(ws().json().filter((m) => m.op === 'ping').map((m) => m.id)).toEqual([1, 2, 3, 4]);
  });

  it('se reconnecte à délai croissant après une fermeture', async () => {
    const { ws, sink } = setup();
    ws().open();
    ws().close();
    expect(sink.state).toMatchObject({ status: 'closed', since: null, attempts: 1 });
    await vi.advanceTimersByTimeAsync(1_125);            // 1 s + gigue
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(sink.state.status).toBe('connecting');
    ws().close();
    expect(sink.state.attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(2_249);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
    ws().open();
    expect(sink.state.attempts).toBe(0);
  });

  it('s’arrête sans se reconnecter', async () => {
    const { ws, src, sink } = setup();
    ws().open();
    src.stop();
    expect(ws().closed).toBe(true);
    expect(sink.state.status).toBe('closed');
    const sent = ws().sent.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws().sent).toHaveLength(sent);
  });
});

describe('source passerelle : correctifs de la revue', () => {
  it('ramène la latence sur l’horloge OKX avec clock:okx (tour en retard de 800 ms)', async () => {
    const { ws, sink } = setup();
    ws().open();
    const t0 = Date.now();
    await vi.advanceTimersByTimeAsync(10);
    // navigateur et passerelle à la même heure B ; OKX est en avance de 800 ms (heure OKX = B + 800)
    ws().receive({ type: 'pong', id: 1, t0, ts: t0 + 5 });
    const B = Date.now(); // heure locale du trade
    await vi.advanceTimersByTimeAsync(120); // le navigateur le reçoit 120 ms plus tard
    ws().receive({
      type: 'delta', ts_sent: 0, items: [
        ['clock:okx', { offset_ms: 800, uncertainty_ms: 10, ok: true, ts_recv: B }],
        // trade daté par OKX (B + 800) ; reçu par la passerelle 100 ms plus tard, sur son horloge
        [KEY, { inst: 'BTC-USDT-SWAP', trade_id: 1, count: 1, px: 1, sz: 1, side: 'buy',
          ts_source: B + 800, ts_recv: B + 100 }],
      ],
    });
    const l = sink.latencies.at(-1)!;
    expect(l.okxToGateway).toBe(100);
    expect(l.total).toBe(120);
    expect(l.gatewayToScreen).toBe(20);
  });

  it('remplace une connexion muette (aucun message pendant 15 s) avec délai croissant', async () => {
    const { ws, sink } = setup();
    ws().open();
    const first = ws();
    // pings sans réponse (tour éteinte, TCP non fermé) : coupée au ping qui suit 15 s de silence
    await vi.advanceTimersByTimeAsync(20_000);
    expect(first.closed).toBe(true);
    expect(sink.state.status).toBe('closed');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it('adresse refusée par le constructeur WebSocket : arrêt avec la raison, sans exception', () => {
    class Refusing extends FakeWebSocket {
      constructor(url: string) { super(url); throw new SyntaxError('URL invalide'); }
    }
    const sink = new RecordingSink();
    const src = createGatewaySource({ wsUrl: 'ws://x/#', topics: TOPICS, latencyKey: KEY }, sink,
      { WebSocket: Refusing, now: () => Date.now(), random: () => 0.5 });
    expect(() => src.start()).not.toThrow();
    expect(sink.state.status).toBe('closed');
    expect(sink.state.reason).toMatch(/^adresse WebSocket refusée/);
  });
});
