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
    expect(body.items.map(([k]) => k)).toEqual(['calendar:week:2026-W48', 'calendar:official', 'feed:calendar']);
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
