/** @vitest-environment node */
// /api/p1/* (plan « Tout en ligne », O2) : lecture de p1_state par PostgREST avec la clé
// secrète côté serveur ; semaine en cours, calendrier officiel et flux ; semaine archivée.

import { describe, expect, it } from 'vitest';
import { handleP1 } from '../_lib/p1.ts';
import { req, testContext } from './fakes.ts';

const NOW = Date.UTC(2026, 10, 23, 12, 0);
const ENV = { SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test_only_not_a_real_key' };
const STATE = [
  { key: 'calendar:week:2026-W47', value: { week: '2026-W47', archive: false, events: [] }, updated_ms: 1 },
  { key: 'calendar:week:2026-W48', value: { week: '2026-W48', archive: false, events: [{ id: 'x' }] }, updated_ms: 2 },
  { key: 'calendar:official', value: { releases: [], moved: [] }, updated_ms: 2 },
  { key: 'feed:calendar', value: { name: 'calendar', status: 'connected' }, updated_ms: 2 },
  { key: 'release:us-cpi-mm:2026-10', value: { indicator: 'us-cpi-mm', value: '0.4' }, updated_ms: 2 },
  { key: 'lock:burst:cpi:1', value: { at: 1 }, updated_ms: 2 },
  { key: 'news:item:7', value: { id: 7, title: 'Federal Reserve issues FOMC statement' }, updated_ms: 2 },
  { key: 'alert:rule:1', value: { id: 1 }, updated_ms: 2 },
];

/** Faux PostgREST pour p1_state : like, in, eq, order key.desc, limit. */
function fakeSupabase() {
  const calls: { params: Record<string, string>; headers: Headers }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const params = Object.fromEntries(u.searchParams);
    calls.push({ params, headers: new Headers(init?.headers) });
    let rows = [...STATE];
    const k = params.key ?? '';
    if (k.startsWith('like.')) rows = rows.filter((r) => r.key.startsWith(k.slice(5).replace('*', '')));
    if (k.startsWith('eq.')) rows = rows.filter((r) => r.key === k.slice(3));
    if (params.or) rows = rows.filter((r) => r.key.startsWith('release:us-') || r.key.startsWith('reaction:'));
    if (k.startsWith('in.(')) {
      const keys = k.slice(4, -1).split(',').map((x) => x.replace(/"/g, ''));
      rows = rows.filter((r) => keys.includes(r.key));
    }
    if (params.order === 'key.desc') rows.sort((a, b) => b.key.localeCompare(a.key));
    if (params.limit) rows = rows.slice(0, Number(params.limit));
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, calls };
}

describe('/api/p1', () => {
  it('sans variables Supabase : configured false, aucune donnée inventée', async () => {
    const { ctx } = testContext({ nowMs: NOW });
    const r = await handleP1(req('/api/p1?path=state'), ctx);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ configured: false, items: [], reason: expect.stringContaining('SUPABASE_URL') });
  });

  it('state : dernière semaine, calendrier officiel et flux, avec la clé secrète seulement côté serveur', async () => {
    const sb = fakeSupabase();
    const { ctx } = testContext({ nowMs: NOW, env: ENV, fetch: sb.fetch as never });
    const r = await handleP1(req('/api/p1?path=state'), ctx);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const body = await r.json() as { items: [string, unknown][] };
    expect(body.items.map(([k]) => k)).toEqual(['calendar:week:2026-W48', 'calendar:official', 'feed:calendar', 'release:us-cpi-mm:2026-10', 'news:item:7']);
    expect(sb.calls[2].params).toMatchObject({ or: '(key.like.release:us-*,key.like.reaction:*)' });   // jamais les verrous
    expect(sb.calls[0].headers.get('apikey')).toBe(ENV.SUPABASE_SECRET_KEY);
    expect(JSON.stringify(body)).not.toContain(ENV.SUPABASE_SECRET_KEY);
  });

  it('calendar : semaine archivée marquée archive ; semaine absente : 404 ; forme invalide : 400', async () => {
    const sb = fakeSupabase();
    const { ctx } = testContext({ nowMs: NOW, env: ENV, fetch: sb.fetch as never });
    const old = await handleP1(req('/api/p1?path=calendar&week=2026-W47'), ctx);
    expect(await old.json()).toMatchObject({ week: '2026-W47', archive: true });
    const cur = await handleP1(req('/api/p1?path=calendar&week=2026-W48'), ctx);
    expect(await cur.json()).toMatchObject({ week: '2026-W48', archive: false });
    expect((await handleP1(req('/api/p1?path=calendar&week=2026-W10'), ctx)).status).toBe(404);
    expect((await handleP1(req('/api/p1?path=calendar&week=2026-48'), ctx)).status).toBe(400);
    expect((await handleP1(req('/api/p1?path=calendar&week=2026-W48%29%2Ckey.neq.x'), ctx)).status).toBe(400);
  });

  it('route inconnue : 404 ; paramètre inconnu : 400', async () => {
    const { ctx } = testContext({ nowMs: NOW, env: ENV, fetch: fakeSupabase().fetch as never });
    expect((await handleP1(req('/api/p1?path=alerts'), ctx)).status).toBe(404);
    expect((await handleP1(req('/api/p1?path=state&x=1'), ctx)).status).toBe(400);
  });
});

describe('/api/p1/displayed (porte P1 en ligne)', () => {
  const KEY = 'release:us-cpi-mm:2026-11';
  function fakeWrites(value: Record<string, unknown> | null) {
    const calls: { method: string; table: string; params: Record<string, string>; body: unknown }[] = [];
    const fetch = async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const call = { method: init?.method ?? 'GET', table: u.pathname.replace('/rest/v1/', ''), params: Object.fromEntries(u.searchParams),
        body: init?.body ? JSON.parse(String(init.body)) : null };
      calls.push(call);
      if (call.method === 'GET') return new Response(JSON.stringify(value ? [{ value }] : []), { status: 200 });
      return new Response(JSON.stringify([{}]), { status: 200 });
    };
    return { fetch, calls };
  }
  const post = (body: unknown, type = 'application/json') => new Request('https://terminal.example/api/p1?path=displayed',
    { method: 'POST', headers: { 'content-type': type }, body: JSON.stringify(body) });
  const CAPTURED = { release: 'cpi', period: '2026-11', edition: '', scheduled_ms: NOW - 1500, first_byte_ms: NOW - 900, bus_ms: NOW - 400, value: '0.3' };

  it('première heure d’affichage : délai depuis 08:30, écrite dans l’état et dans release_timings', async () => {
    const sb = fakeWrites(CAPTURED);
    const { ctx } = testContext({ nowMs: NOW, env: ENV, fetch: sb.fetch as never });
    const r = await handleP1(post({ key: KEY, display_ms: NOW - 100 }), ctx);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, display_delay_ms: 1400, display_after_capture_ms: 800 });
    const [, state, timings] = sb.calls;
    expect(state).toMatchObject({ method: 'PATCH', table: 'p1_state', params: { key: `eq.${KEY}`, 'value->>display_ms': 'is.null' } });
    expect((state.body as { value: Record<string, unknown> }).value).toMatchObject({ value: '0.3', display_ms: NOW - 100, display_delay_ms: 1400 });
    expect(timings).toMatchObject({ method: 'PATCH', table: 'release_timings', params: { release: 'eq.cpi', period: 'eq.2026-11', edition: 'eq.', display_ms: 'is.null' }, body: { display_ms: NOW - 100 } });
  });

  it('déjà affiché, ou plus d’une minute après la publication : rien n’est écrit', async () => {
    for (const value of [{ ...CAPTURED, display_ms: NOW - 50 }, { ...CAPTURED, bus_ms: NOW - 120_000 }]) {
      const sb = fakeWrites(value);
      const { ctx } = testContext({ nowMs: NOW, env: ENV, fetch: sb.fetch as never });
      const body = await (await handleP1(post({ key: KEY, display_ms: NOW }), ctx)).json() as { ok: boolean };
      expect(body.ok).toBe(false);
      expect(sb.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    }
  });

  it('refus : clé invalide, horloge absurde, corps non JSON, GET, chiffre inconnu', async () => {
    const sb = fakeWrites(null);
    const { ctx } = testContext({ nowMs: NOW, env: ENV, fetch: sb.fetch as never });
    expect((await handleP1(post({ key: 'calendar:official', display_ms: NOW }), ctx)).status).toBe(400);
    expect((await handleP1(post({ key: KEY, display_ms: NOW + 3_600_000 }), ctx)).status).toBe(400);
    expect((await handleP1(post({ key: KEY, display_ms: NOW }, 'text/plain'), ctx)).status).toBe(415);
    expect((await handleP1(req('/api/p1?path=displayed'), ctx)).status).toBe(405);
    expect((await handleP1(post({ key: KEY, display_ms: NOW }), ctx)).status).toBe(404);
  });
});
