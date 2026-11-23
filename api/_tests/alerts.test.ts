// @vitest-environment node
// /api/alerts/* (O4) : session exigée partout, même origine pour les écritures, relais vers
// p1-jobs (tâche alerts-cmd) avec le secret d'appel, erreurs 400/404 rendues telles quelles.
import { describe, expect, it } from 'vitest';
import { COOKIE_NAME, signSession } from '../_lib/bourse/auth.js';
import { alertRoute, handleAlerts } from '../_lib/alerts.js';
import type { FetchFn } from '../_lib/okx.js';
import { createContext } from '../_lib/routes.js';

const HASH = 'pbkdf2-sha256$100000$AAECAwQFBgcICQoLDA0ODw$W96qzf7j9JBRjdvDcxWyNI1t7VDAmtdCWZ0FVrtrG_E';
const SECRET = 's'.repeat(48);
const JOBS = 'j'.repeat(40);
const NOW = Date.parse('2026-12-10T13:30:00Z');
const ENV = { BOURSE_PASSWORD_HASH: HASH, BOURSE_SESSION_SECRET: SECRET, P1_JOBS_SECRET: JOBS,
  SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_0123456789abcdefghij' };
const ORIGIN = 'https://terminal.example';

function fake(reply: { status: number; body: unknown } = { status: 200, body: { id: 3 } }) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetch: FetchFn = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    if (u.pathname.startsWith('/functions/v1/')) return new Response(JSON.stringify(reply.body), { status: reply.status });
    const key = u.searchParams.get('key') ?? '';
    const rows = key === 'like.alert:rule:*' ? [{ key: 'alert:rule:1', value: { id: 1 } }]
      : key === 'like.alert:fired:*' ? [{ key: 'alert:fired:aa', value: { id: 'aa' } }]
        : key === 'eq.alert:summary' ? [{ key: 'alert:summary', value: { rules: 1 } }] : [];
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  return { fetch, calls };
}

const ctx = (fetch: FetchFn, env: Record<string, string> = ENV) =>
  createContext({ fetch, now: () => NOW, monotonic: () => 0, sleep: async () => {} }, env);

async function req(path: string, init: RequestInit & { session?: boolean } = {}) {
  const headers = new Headers(init.headers);
  headers.set('host', 'terminal.example');
  if (init.session !== false) headers.set('cookie', `${COOKIE_NAME}=${await signSession(Math.floor(NOW / 1000) + 3600, SECRET)}`);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}
const write = (path: string, method: string, body?: unknown, extra: Record<string, string> = {}) => req(path, {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  headers: { origin: ORIGIN, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra } });

describe('/api/alerts', () => {
  it('chemins : d’origine ou réécrits', () => {
    expect(alertRoute(new Request('https://x/api/alerts/rules/12'))).toEqual({ route: 'rules', id: 12 });
    expect(alertRoute(new Request('https://x/api/alerts?path=rules/12'))).toEqual({ route: 'rules', id: 12 });
    expect(alertRoute(new Request('https://x/api/alerts/test-telegram?path=test-telegram'))).toEqual({ route: 'test-telegram', id: null });
    expect(alertRoute(new Request('https://x/api/alerts/rules/x'))).toEqual({ route: '', id: null });
  });

  it('session exigée, même pour lire', async () => {
    const { fetch, calls } = fake();
    const r = await handleAlerts(await req('/api/alerts/state', { session: false }), ctx(fetch));
    expect(r.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('état : règles, 50 dernières alertes par heure, résumé', async () => {
    const { fetch, calls } = fake();
    const r = await handleAlerts(await req('/api/alerts/state'), ctx(fetch));
    expect(r.status).toBe(200);
    const body = await r.json() as { items: [string, unknown][] };
    expect(body.items.map(([k]) => k)).toEqual(['alert:rule:1', 'alert:fired:aa', 'alert:summary']);
    expect(calls.find((c) => c.url.searchParams.get('key') === 'like.alert:fired:*')!.url.searchParams.get('order')).toBe('value->fired_ms.desc');
  });

  it('écritures relayées avec le secret d’appel ; corps traduit en commande', async () => {
    const { fetch, calls } = fake();
    const c = ctx(fetch);
    expect((await handleAlerts(await write('/api/alerts/rules', 'POST', { kind: 'release', params: {}, channels: ['telegram'] }), c)).status).toBe(200);
    await handleAlerts(await write('/api/alerts/rules/4', 'PATCH', { state: 'désactivée' }), c);
    await handleAlerts(await write('/api/alerts/rules/4', 'DELETE'), c);
    await handleAlerts(await write('/api/alerts/ack', 'POST', { ids: ['abcdef012345'] }), c);
    await handleAlerts(await write('/api/alerts/test-telegram', 'POST', {}), c);
    const sent = calls.filter((x) => x.url.pathname === '/functions/v1/p1-jobs');
    expect(sent.map((x) => x.url.searchParams.get('job'))).toEqual(Array(5).fill('alerts-cmd'));
    expect(sent.every((x) => (x.init?.headers as Record<string, string>)['x-jobs-secret'] === JOBS)).toBe(true);
    expect(sent.map((x) => JSON.parse(String(x.init?.body)))).toEqual([
      { op: 'create', kind: 'release', params: {}, channels: ['telegram'] },
      { op: 'update', id: 4, state: 'désactivée' },
      { op: 'delete', id: 4 },
      { op: 'ack', ids: ['abcdef012345'] },
      { op: 'test' },
    ]);
  });

  it('autre origine, corps non JSON, méthode inattendue : refusés avant tout relais', async () => {
    const { fetch, calls } = fake();
    const c = ctx(fetch);
    expect((await handleAlerts(await write('/api/alerts/ack', 'POST', {}, { origin: 'https://evil.example' }), c)).status).toBe(403);
    expect((await handleAlerts(await write('/api/alerts/rules/4', 'DELETE', undefined, { origin: 'https://evil.example' }), c)).status).toBe(403);
    expect((await handleAlerts(await req('/api/alerts/ack', { method: 'POST', body: 'ids=1', headers: { origin: ORIGIN, 'content-type': 'text/plain' } }), c)).status).toBe(403);
    expect((await handleAlerts(await write('/api/alerts/rules', 'DELETE'), c)).status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it('erreur de validation du moteur rendue telle quelle ; secret absent signalé', async () => {
    const { fetch } = fake({ status: 400, body: { ok: false, error: "instrument non suivi : 'SOL-USDT-SWAP'" } });
    const r = await handleAlerts(await write('/api/alerts/rules', 'POST', { kind: 'price', params: { inst: 'SOL-USDT-SWAP' } }), ctx(fetch));
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).toContain('instrument non suivi');
    const { P1_JOBS_SECRET: _drop, ...noSecret } = ENV;
    const r2 = await handleAlerts(await write('/api/alerts/ack', 'POST', {}), ctx(fake().fetch, noSecret));
    expect(r2.status).toBe(503);
    expect(JSON.stringify(await r2.json())).not.toContain(JOBS);
  });
});
