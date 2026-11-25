// Journal de trading (P6, S5) : /api/bourse/journal derrière la session ; trade validé avant toute
// écriture (refus lisible, 400), création, modification et suppression par identifiant, liste.
import { describe, expect, it } from 'vitest';
import { COOKIE_NAME, signSession } from '../_lib/bourse/auth.js';
import { handleBourse } from '../_lib/bourse/routes.js';
import type { FetchFn } from '../_lib/okx.js';
import { createContext } from '../_lib/routes.js';

const HASH = 'pbkdf2-sha256$100000$AAECAwQFBgcICQoLDA0ODw$W96qzf7j9JBRjdvDcxWyNI1t7VDAmtdCWZ0FVrtrG_E';
const SECRET = 's'.repeat(48);
const NOW = Date.parse('2026-11-25T20:00:00Z');
const ENV = { BOURSE_PASSWORD_HASH: HASH, BOURSE_SESSION_SECRET: SECRET, SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_0123456789abcdefghij' };
const ORIGIN = 'https://terminal.example';
const TRADE = { asset: 'BTC', side: 'long', opened_ms: NOW - 3_600_000, qty: 0.5, entry: 60000, stop: 59500 };

function world(rows: unknown[] = [], affected = 1) {
  const calls: { method: string; url: URL; body: string | null }[] = [];
  const fetch: FetchFn = async (url, init) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    calls.push({ method, url: u, body: typeof init?.body === 'string' ? init.body : null });
    if (method === 'GET') return new Response(JSON.stringify(rows), { status: 200 });
    if (method === 'POST') return new Response(null, { status: 201 });
    return new Response(JSON.stringify(Array.from({ length: affected }, () => ({ id: 1 }))), { status: 200, headers: { 'Content-Range': `0-0/${affected}` } });
  };
  return { calls, ctx: createContext({ fetch, now: () => NOW, monotonic: () => 0, sleep: async () => {} }, ENV) };
}

async function call(w: ReturnType<typeof world>, method: string, path = '/api/bourse/journal', body?: unknown, session = true) {
  const headers = new Headers({ host: 'terminal.example', origin: ORIGIN, 'content-type': 'application/json' });
  if (session) headers.set('cookie', `${COOKIE_NAME}=${await signSession(Math.floor(NOW / 1000) + 3600, SECRET)}`);
  const r = await handleBourse(new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), w.ctx);
  return { status: r.status, body: await r.json() as Record<string, unknown> };
}

describe('journal', () => {
  it('liste derrière la session', async () => {
    const w = world([{ id: 3, ...TRADE }]);
    expect((await call(w, 'GET', undefined, undefined, false)).status).toBe(401);
    const r = await call(w, 'GET');
    expect(r.body.trades).toEqual([{ id: 3, ...TRADE }]);
    expect(w.calls.at(-1)!.url.searchParams.get('order')).toBe('opened_ms.desc');
  });
  it('création : trade validé puis écrit avec ses heures', async () => {
    const w = world();
    expect((await call(w, 'POST', undefined, TRADE)).body).toEqual({ ok: true });
    const ins = w.calls.find((c) => c.method === 'POST')!;
    expect(ins.url.pathname).toBe('/rest/v1/journal_trades');
    expect(JSON.parse(ins.body!)[0]).toMatchObject({ asset: 'BTC', side: 'long', qty: 0.5, exit: null, created_ms: NOW, updated_ms: NOW });
  });
  it('trade invalide : 400 avec la raison, rien d’écrit', async () => {
    const w = world();
    const r = await call(w, 'POST', undefined, { ...TRADE, stop: 60500 });
    expect(r).toEqual({ status: 400, body: { detail: 'stop du mauvais côté de l’entrée pour un long' } });
    expect(w.calls.some((c) => c.method === 'POST')).toBe(false);
  });
  it('modification et suppression par identifiant ; introuvable : 404', async () => {
    expect((await call(world(), 'PATCH', '/api/bourse/journal?id=7', { ...TRADE, exit: 61000, closed_ms: NOW })).body).toEqual({ ok: true });
    expect((await call(world(), 'DELETE', '/api/bourse/journal?id=7')).body).toEqual({ ok: true });
    expect((await call(world([], 0), 'DELETE', '/api/bourse/journal?id=9')).status).toBe(404);
    expect((await call(world(), 'DELETE', '/api/bourse/journal')).status).toBe(400);
  });
});
