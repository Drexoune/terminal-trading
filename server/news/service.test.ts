// @vitest-environment node
// Service Tree of Alpha (T-072) : base simulée (MemRest), Telegram simulé, fausse WebSocket, vrais
// messages du 20/11/2026. Un tweet devient un titre enregistré, publié (news:item:<id>) et annoncé
// par une alerte mot-clé ; doublon ignoré ; connexion tenue dès l'ouverture puis coupure dans
// feed:toa ; aucun secret dans l'état.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemRest } from '../../supabase/functions/p1-jobs/_memrest';
import { runAlertCommand, type AlertDeps } from '../../supabase/functions/p1-jobs/alerts';
import type { WebSocketLike } from '../../web/src/data/protocol';
import { NewsService } from './main';
import { TOA_WS, type ToaRaw } from './toa';

class FakeWs implements WebSocketLike {
  static last: FakeWs | null = null;
  readyState = 0;
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  constructor(readonly url: string) { FakeWs.last = this; }
  send() {}
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.({} as Event); }
  receive(d: unknown) { this.onmessage?.({ data: JSON.stringify(d) } as MessageEvent); }
  drop() { this.readyState = 3; this.onclose?.({ code: 1011, reason: 'keepalive ping timeout' } as CloseEvent); }
}

const FX = JSON.parse(readFileSync(new URL('./fixtures/toa.json', import.meta.url), 'utf8')) as { t_recv_ms: number; raw: ToaRaw }[];
const ENV: Record<string, string> = { TELEGRAM_BOT_TOKEN: 'tok-secret-123', TELEGRAM_CHAT_ID: '42', SUPABASE_SECRET_KEY: 'sb_secret_xyz' };

function setup() {
  const rest = new MemRest();
  let now = FX[0].t_recv_ms;
  const sent: string[] = [];
  const statuses: Record<string, unknown>[] = [];
  const tg: AlertDeps['fetch'] = async (_u, init) => {
    sent.push(String(JSON.parse(init?.body ?? '{}').text));
    return { status: 200, arrayBuffer: async () => new TextEncoder().encode('{"ok":true,"result":{}}').buffer };
  };
  const deps: AlertDeps = { rest, now: () => now, sleep: async () => {}, env: (k) => ENV[k], fetch: tg };
  const svc = new NewsService({ rest, env: (k) => ENV[k], fetch: tg, WebSocket: FakeWs as never, now: () => now, random: () => 0,
    sleep: async () => {}, writeStatus: (s) => statuses.push(s) });
  return { rest, deps, svc, sent, statuses, at: (ms: number) => { now = ms; } };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('service Tree of Alpha', () => {
  it('tweet → news_items, news:item:<id>, alerte mot-clé sur Telegram ; doublon ignoré', async () => {
    const { rest, deps, svc, sent } = setup();
    await runAlertCommand(deps, { op: 'create', kind: 'keyword', params: { words: ['Zcash'] }, channels: ['telegram'] });
    await svc.start();
    const ws = FakeWs.last!;
    expect(ws.url).toBe(TOA_WS);
    ws.open();
    expect(svc.feed?.status).toBe('connected');                 // tenue pour établie dès l'ouverture
    ws.receive(FX[0].raw);
    ws.receive(FX[0].raw);                                      // même _id : doublon
    await svc.settled();
    const rows = rest.rows('news_items');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feed: 'treeofalpha', source: 'Tree of Alpha · The Block', category: 'crypto', backfill: false });
    const [item] = await rest.select<{ key: string; value: Record<string, unknown> }>('p1_state', { select: 'key,value', key: `eq.news:item:${rows[0].id}` });
    expect(item.value).toMatchObject({ feed: 'treeofalpha', lang: 'en', backfill: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/Zcash/);
    expect(svc.stats).toMatchObject({ kept: 1, duplicates: 1, alerts: 1 });
    svc.stop();
  });

  it('les messages réels des 5 types sont gardés ; coupure visible dans feed:toa ; état sans secret', async () => {
    const { rest, svc, statuses } = setup();
    await svc.start();
    const ws = FakeWs.last!;
    ws.open();
    for (const m of FX) ws.receive(m.raw);
    await svc.settled();
    expect(rest.rows('news_items').length).toBeGreaterThanOrEqual(12);   // quelques quasi-doublons possibles
    await svc.beat();
    let [st] = await rest.select<{ value: Record<string, unknown> }>('p1_state', { select: 'value', key: 'eq.feed:toa' });
    expect(st.value).toMatchObject({ label: 'Tree of Alpha', status: 'connected' });
    ws.drop();
    await svc.beat();
    [st] = await rest.select<{ value: Record<string, unknown> }>('p1_state', { select: 'value', key: 'eq.feed:toa' });
    expect(st.value).toMatchObject({ status: 'reconnecting' });
    expect(String(st.value.last_error)).toMatch(/connexion fermée \(code 1011/);
    expect(JSON.stringify(statuses)).not.toMatch(/tok-secret|sb_secret/);
    svc.stop();
  });
});
