// @vitest-environment node
// Service de la microstructure sur la machine Oracle (T-069) : SSE (état complet puis
// changements), origines refusées, plafond de clients, sauvegarde et reprise de l'état
// (carte, liquidations, journal des flux ; refus au-delà d'une heure), arrêt propre.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { get, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FetchLike, WebSocketLike } from '../../web/src/data/protocol';
import { MicroEngine, type EngineSave } from '../../web/src/micro/engine';
import type { BookView } from '../../web/src/micro/types';
import { startMicroServer } from './main';
import { SseHub } from './sse';

class FakeWs implements WebSocketLike {
  readyState = 0;
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  constructor(readonly url: string) {}
  send() {}
  close() { this.readyState = 3; }
}
const fetch: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
const deps = (now = () => Date.now()) => ({ WebSocket: FakeWs as never, fetch, now, random: () => 0 });
const ORIGIN = 'https://terminal-trading-steel.vercel.app';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'micro-')); dirs.push(d); return join(d, 'state.json'); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** Lit un flux SSE jusqu'à `until` (texte cumulé) ou 3 s. */
function readSse(port: number, origin: string | undefined, until: (text: string) => boolean): Promise<{ status: number; text: string; headers: IncomingMessage['headers'] }> {
  return new Promise((resolve, reject) => {
    const req = get({ port, host: '127.0.0.1', path: '/micro/stream', headers: origin ? { Origin: origin } : {} }, (res) => {
      let text = '';
      const done = () => { req.destroy(); resolve({ status: res.statusCode ?? 0, text, headers: res.headers }); };
      const t = setTimeout(done, 3_000);
      res.on('data', (c: Buffer) => { text += c.toString(); if (until(text)) { clearTimeout(t); done(); } });
      res.on('end', () => { clearTimeout(t); done(); });
    });
    req.on('error', reject);
  });
}

describe('service SSE', () => {
  it('état complet à la connexion, puis changements ; CORS sur l’origine du terminal', async () => {
    const s = startMicroServer({ port: 0, host: '127.0.0.1', stateFile: tmp(), origins: [ORIGIN], deps: deps() });
    await new Promise((r) => s.server.once('listening', r));
    const port = (s.server.address() as AddressInfo).port;
    const r = await readSse(port, ORIGIN, (t) => t.includes('event: items'));
    expect(r.status).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(r.headers['content-type']).toContain('text/event-stream');
    expect(r.text.startsWith('retry: 5000\nevent: state\ndata: [')).toBe(true);
    const items = JSON.parse(r.text.split('event: items\ndata: ')[1].split('\n')[0]) as [string, unknown][];
    expect(items.map(([k]) => k)).toContain('micro:book');
    await s.stop();
  });

  it('origine inconnue refusée (403) ; santé lisible sans origine', async () => {
    const bt = tmp().replace('state.json', 'bt.json');
    writeFileSync(bt, JSON.stringify({ at: 1, loop: 'L1', attempts: 7, idle: false }));
    const s = startMicroServer({ port: 0, host: '127.0.0.1', stateFile: tmp(), origins: [ORIGIN], deps: deps(), btStatusFile: bt });
    await new Promise((r) => s.server.once('listening', r));
    const port = (s.server.address() as AddressInfo).port;
    expect((await readSse(port, 'https://ailleurs.example', () => true)).status).toBe(403);
    const health = await new Promise<{ status: number; body: Record<string, unknown> }>((resolve) => get({ port, host: '127.0.0.1', path: '/micro/health' }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(b) }));
    }));
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, kind: 'server', host: 'Oracle', restored_from: null });
    expect(typeof health.body.sys_mem_pct).toBe('number');
    expect(health.body.bt).toEqual({ last_pass: { at: 1, loop: 'L1', attempts: 7, idle: false } });
    await s.stop();
  });

  it('plafond de clients : le suivant reçoit 503', () => {
    const hub = new SseHub([ORIGIN], 1);
    const res = () => {
      const r = { status: 0, headers: {} as Record<string, string>, body: '', writableLength: 0,
        writeHead(st: number, h: Record<string, string>) { r.status = st; r.headers = h; return r; }, write(x: string) { r.body += x; return true; },
        end(x?: string) { if (x) r.body += x; }, on() { return r; }, destroy() {} };
      return r;
    };
    const req = { headers: { origin: ORIGIN }, on() {} };
    const a = res(), b = res();
    hub.handle(req as never, a as never);
    hub.handle(req as never, b as never);
    expect(a.status).toBe(200);
    expect(b.status).toBe(503);
    hub.close();
  });
});

describe('sauvegarde et reprise', () => {
  const view = (wall: number): BookView => ({ venue: 'binance', ts: 1, recv: 1, synced: true,
    bids: { px: [59_990, 59_900, 59_800], sz: [1, wall, 1] }, asks: { px: [60_010, 60_100, 60_200], sz: [1, 1, 1] } });

  it('carte, liquidations et journal repris ; état de plus d’une heure refusé', () => {
    let t = Date.parse('2026-11-25T14:00:00Z');
    const a = new MicroEngine(deps(() => t));
    a.depth.sample(t, [view(50)]);
    a.depth.sample(t + 40_000, [view(2)]);
    a.liqs.add({ venue: 'bybit', ts: t, recv: t, side: 'long', px: 60_000, sz: 1, usd: 60_000, floor: false });
    a.adapters.bybit.streams[0].gap('carnet resynchronisé : test');
    const saved = JSON.parse(JSON.stringify(a.save(t + 41_000))) as EngineSave;

    t += 60_000;
    const b = new MicroEngine(deps(() => t));
    expect(b.restore(saved, t)).toBe(true);
    expect(b.depth.state().columns).toEqual(a.depth.state().columns);
    expect(b.depth.state().walls).toHaveLength(1);
    expect(b.liqs.state(t).count).toBe(1);
    expect(b.adapters.bybit.streams[0].snapshot().gaps.map((g) => g.text)).toEqual(['carnet resynchronisé : test']);

    const c = new MicroEngine(deps(() => t + 3_600_000));
    expect(c.restore(saved, t + 3_600_000)).toBe(false);
    expect(c.depth.state().columns).toEqual([]);
  });

  it('arrêt propre : état écrit, reprise au démarrage suivant (source « restored_from »)', async () => {
    const file = tmp();
    const s = startMicroServer({ port: 0, host: '127.0.0.1', stateFile: file, origins: [ORIGIN], deps: deps() });
    await new Promise((r) => s.server.once('listening', r));
    s.engine.liqs.add({ venue: 'okx', ts: Date.now(), recv: Date.now(), side: 'short', px: 60_000, sz: 2, usd: 120_000, floor: true });
    await s.stop();
    const saved = JSON.parse(readFileSync(file, 'utf8')) as EngineSave;
    expect(saved.liqs.list).toHaveLength(1);
    const s2 = startMicroServer({ port: 0, host: '127.0.0.1', stateFile: file, origins: [ORIGIN], deps: deps() });
    expect(s2.restored).toBe(true);
    expect(s2.engine.liqs.state(Date.now()).count).toBe(1);
    await s2.stop();
  });
});
