// @vitest-environment node
// Alertes à la seconde sur Oracle (T-071) : base simulée (MemRest), Telegram simulé, fausse
// WebSocket OKX. Franchissement sur un trade → Telegram dans le même lot ; même clé de minute que
// Supabase (pas de double) ; règle déclenchée non rejugée ; liquidations sur fenêtre ; murs du
// premier état jamais alertés ; flux SSE découpé ; aucun secret dans le battement de cœur.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemRest } from '../../supabase/functions/p1-jobs/_memrest';
import { runAlertCommand, type AlertDeps } from '../../supabase/functions/p1-jobs/alerts';
import type { WebSocketLike } from '../../web/src/data/protocol';
import { judgeWalls, LiqWindow, minuteKey, PriceJudge } from './judge';
import { AlertService, OKX_WS, SseParser } from './main';

class FakeWs implements WebSocketLike {
  static last: FakeWs | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  constructor(readonly url: string) { FakeWs.last = this; }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.({} as Event); }
  receive(d: unknown) { this.onmessage?.({ data: JSON.stringify(d) } as MessageEvent); }
}

const T0 = Date.parse('2026-11-25T17:42:31.250Z');
const ENV: Record<string, string> = { TELEGRAM_BOT_TOKEN: 'tok-secret-123', TELEGRAM_CHAT_ID: '42', SUPABASE_SECRET_KEY: 'sb_secret_xyz' };

function setup() {
  const rest = new MemRest();
  let now = T0;
  const sent: string[] = [];
  const tg: AlertDeps['fetch'] = async (url, init) => {
    sent.push(String(JSON.parse(init?.body ?? '{}').text));
    expect(url).toContain('/sendMessage');
    return { status: 200, arrayBuffer: async () => new TextEncoder().encode('{"ok":true,"result":{}}').buffer };
  };
  const deps: AlertDeps = { rest, now: () => now, sleep: async () => {}, env: (k) => ENV[k], fetch: tg };
  const svc = new AlertService({
    rest, env: (k) => ENV[k], fetch: tg, now: () => now, random: () => 0, sleep: async () => {},
    sseFetch: async () => ({ ok: false, status: 503, body: null }), WebSocket: FakeWs as never, microUrl: 'http://127.0.0.1:1',
  });
  return { rest, deps, svc, sent, at: (ms: number) => { now = ms; } };
}

const trade = (inst: string, px: number, ts: number) => ({ arg: { channel: 'trades', instId: inst }, data: [{ px: String(px), ts: String(ts), sz: '1', side: 'buy', tradeId: '1' }] });

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('évaluateurs', () => {
  it('clé de minute au format de PostgREST (okx_candles_1m.t)', () => {
    expect(minuteKey(T0)).toBe('2026-11-25T17:42:00+00:00');
  });
  it('prix : franchissement entre deux trades, sens respecté', () => {
    const j = new PriceJudge();
    const rule = { id: 1, kind: 'price', state: 'armée', params: { inst: 'BTC-USDT-SWAP', level: '60000', direction: 'hausse' } } as never;
    expect(j.onTrade('BTC-USDT-SWAP', 59_990, T0, [rule])).toEqual([]);
    expect(j.onTrade('BTC-USDT-SWAP', 60_010, T0 + 5, [rule])).toHaveLength(1);
    expect(j.onTrade('BTC-USDT-SWAP', 59_980, T0 + 9, [rule])).toEqual([]);           // baisse : pas pour une règle « hausse »
  });
  it('liquidations : somme sur la fenêtre, côté, une alerte par tranche', () => {
    const w = new LiqWindow();
    const rule = { id: 2, kind: 'liquidations', state: 'armée', params: { min_usd: '3000000', window_min: 5, side: 'long' } } as never;
    w.add([{ venue: 'binance', ts: T0 - 400_000, side: 'long', px: 60_000, sz: 50, usd: 3_000_000 },     // hors fenêtre
      { venue: 'okx', ts: T0 - 60_000, side: 'long', px: 60_000, sz: 30, usd: 1_800_000 },
      { venue: 'bybit', ts: T0 - 30_000, side: 'short', px: 60_000, sz: 40, usd: 2_400_000 }]);
    expect(w.judge(T0, [rule])).toEqual([]);
    w.add([{ venue: 'binance', ts: T0 - 10_000, side: 'long', px: 60_000, sz: 25, usd: 1_500_000 },
      { venue: 'binance', ts: T0 - 10_000, side: 'long', px: 60_000, sz: 25, usd: 1_500_000 }]);   // doublon écarté
    const f = w.judge(T0, [rule]);
    expect(f).toHaveLength(1);
    expect(f[0].dedupe).toBe(`liq:${Math.floor(T0 / 300_000)}`);
    expect(f[0].data).toMatchObject({ total: 3_300_000, count: 2 });
  });
  it('murs : seuil et côté', () => {
    const rule = { id: 3, kind: 'wall', state: 'armée', params: { min_btc: '100', side: 'vente' } } as never;
    const walls = [{ t: T0, px: 60_100, sz: 420, side: 'ask' as const, left: 12 }, { t: T0, px: 59_900, sz: 500, side: 'bid' as const, left: 3 },
      { t: T0, px: 60_200, sz: 50, side: 'ask' as const, left: 1 }];
    expect(judgeWalls(walls, [rule]).map((f) => f.dedupe)).toEqual([`wall:${T0}|60100`]);
  });
  it('flux SSE découpé en événements, même coupé au milieu', () => {
    const p = new SseParser();
    expect(p.push('retry: 5000\nevent: state\ndata: [["a",1]]\n\nevent: it')).toEqual([{ event: 'state', data: '[["a",1]]' }]);
    expect(p.push('ems\ndata: [["b",2]]\n\n: ping\n\n')).toEqual([{ event: 'items', data: '[["b",2]]' }]);
  });
});

describe('service', () => {
  it('franchissement sur un trade : alerte enregistrée avec la clé de Supabase, Telegram envoyé, règle déclenchée', async () => {
    const { rest, deps, svc, sent } = setup();
    await runAlertCommand(deps, { op: 'create', kind: 'price', params: { inst: 'BTC-USDT-SWAP', level: '60000' }, channels: ['telegram'] });
    await svc.start();
    const ws = FakeWs.last!;
    expect(ws.url).toBe(OKX_WS);
    ws.open();
    expect(JSON.parse(ws.sent[0]).args).toEqual([{ channel: 'trades', instId: 'BTC-USDT-SWAP' }, { channel: 'trades', instId: 'ETH-USDT-SWAP' }]);
    ws.receive({ event: 'subscribe', arg: { channel: 'trades' } });
    ws.receive(trade('BTC-USDT-SWAP', 59_995, T0 - 50));
    ws.receive(trade('BTC-USDT-SWAP', 60_003, T0));
    ws.receive(trade('BTC-USDT-SWAP', 59_990, T0 + 20));          // repasse : règle déjà déclenchée
    await svc.settled();
    const ev = rest.rows('alert_events');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ dedupe: '2026-11-25T17:42:00+00:00', telegram: 'envoyé' });
    expect(rest.rows('alert_rules')[0].state).toBe('déclenchée');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/BTC-USDT perp franchit 60.000 à la hausse/);
    // Supabase jugeant la même bougie : même clé, la base n'en garde qu'une.
    const dup = await rest.insertIgnore('alert_events', [{ id: 'x', rule_id: 1, dedupe: '2026-11-25T17:42:00+00:00', fired_ms: T0 + 90_000, title: 't', body: 'b', source: 's', source_ms: null, data: '{}', telegram: null }], 'rule_id,dedupe');
    expect(dup).toEqual([]);
    svc.stop();
  });

  it('murs du premier état connus sans alerte ; mur nouveau alerté une fois ; battement de cœur sans secret', async () => {
    const { rest, deps, svc, sent } = setup();
    await runAlertCommand(deps, { op: 'create', kind: 'wall', params: { min_btc: '100' }, channels: ['telegram'] });
    await svc.start();
    const old = { t: T0 - 600_000, px: 59_000, sz: 300, side: 'bid', left: 2 };
    svc.onMicro([['micro:depth', { walls: [old] }]], T0);
    const fresh = { t: T0, px: 60_500, sz: 250, side: 'ask', left: 8 };
    svc.onMicro([['micro:depth', { walls: [old, fresh] }]], T0 + 5_000);
    svc.onMicro([['micro:depth', { walls: [old, fresh] }]], T0 + 10_000);
    await svc.settled();
    expect(rest.rows('alert_events').map((e) => e.dedupe)).toEqual([`wall:${T0}|60500`]);
    expect(sent).toHaveLength(1);
    await svc.heartbeat();
    const [hb] = await rest.select<{ value: Record<string, unknown> }>('p1_state', { select: 'value', key: 'eq.alert:oracle' });
    expect(hb.value).toMatchObject({ armed: 1, fired: 1 });
    expect(JSON.stringify(hb.value)).not.toMatch(/tok-secret|sb_secret/);
    svc.stop();
  });
});
