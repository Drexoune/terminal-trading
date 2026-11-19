// @vitest-environment node
// Routes /api/bourse/* : session par mot de passe (empreinte produite par
// scripts/bourse_password.py), limite d'essais, contrôle d'origine, routes
// protégées, lecture Supabase simulée.
import { describe, expect, it } from 'vitest';
import type { FetchFn } from '../_lib/okx.js';
import { createContext } from '../_lib/routes.js';
import {
  COOKIE_NAME, parsePasswordHash, readCookie, signSession, verifyPassword, verifySession,
} from '../_lib/bourse/auth.js';
import { handleBourse, MAX_FAILURES, nextRun, routeOf, SCHEDULES } from '../_lib/bourse/routes.js';

// Vecteur produit par scripts/bourse_password.py (make_hash, sel 00..0f, 100 000 itérations).
const PASSWORD = 'cheval correct agrafe';
const HASH = 'pbkdf2-sha256$100000$AAECAwQFBgcICQoLDA0ODw$W96qzf7j9JBRjdvDcxWyNI1t7VDAmtdCWZ0FVrtrG_E';
const SECRET = 's'.repeat(48);
const NOW = Date.parse('2026-11-19T10:00:00Z');
const ENV = {
  BOURSE_PASSWORD_HASH: HASH, BOURSE_SESSION_SECRET: SECRET,
  SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_0123456789abcdefghij',
};
const ORIGIN = 'https://terminal.example';

interface Call { method: string; url: URL; body: string | null }

function fakeSupabase(state: { failures: number; tables?: Record<string, unknown[]> }) {
  const calls: Call[] = [];
  const fetch: FetchFn = async (url, init) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    calls.push({ method, url: u, body: typeof init?.body === 'string' ? init.body : null });
    expect((init?.headers as Record<string, string>).apikey).toBe(ENV.SUPABASE_SECRET_KEY);
    const table = u.pathname.replace('/rest/v1/', '');
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Range': `*/${state.failures}` } });
    if (method === 'POST') { state.failures++; return new Response(null, { status: 201 }); }
    return new Response(JSON.stringify(state.tables?.[table] ?? []), { status: 200 });
  };
  return { fetch, calls };
}

function ctx(fetch: FetchFn, env: Record<string, string> = ENV, now = NOW) {
  return createContext({ fetch, now: () => now, monotonic: () => 0, sleep: async () => {} }, env);
}

const req = (path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  headers.set('host', 'terminal.example');
  if (init.cookie) headers.set('cookie', init.cookie);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
};

const loginReq = (password: string, headers: Record<string, string> = {}) => req('/api/bourse/session', {
  method: 'POST', body: JSON.stringify({ password }),
  headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '203.0.113.7, 10.0.0.1', ...headers },
});

async function cookieOf(): Promise<string> {
  return `${COOKIE_NAME}=${await signSession(Math.floor(NOW / 1000) + 3600, SECRET)}`;
}

describe('empreinte et session', () => {
  it('l’empreinte Python se vérifie en WebCrypto', async () => {
    const h = parsePasswordHash(HASH);
    expect(typeof h).toBe('object');
    if (typeof h === 'string') return;
    expect(await verifyPassword(PASSWORD, h)).toBe(true);
    expect(await verifyPassword(`${PASSWORD} `, h)).toBe(false);
    expect(await verifyPassword('', h)).toBe(false);
  });

  it('empreintes mal formées refusées avec la raison', () => {
    expect(parsePasswordHash(undefined)).toMatch(/absente ou mal formée/);
    expect(parsePasswordHash('pbkdf2-sha256$1000$AAECAwQFBgcICQoLDA0ODw$W96q')).toMatch(/itérations/);
    expect(parsePasswordHash('scrypt$1$2$3')).toMatch(/mal formée/);
  });

  it('cookie signé : valide, falsifié, expiré', async () => {
    const value = await signSession(Math.floor(NOW / 1000) + 60, SECRET);
    expect(await verifySession(value, SECRET, NOW)).toBe(Math.floor(NOW / 1000) + 60);
    expect(await verifySession(value, `${SECRET}x`, NOW)).toBeNull();
    expect(await verifySession(value.replace('v1.17', 'v1.18'), SECRET, NOW)).toBeNull();
    expect(await verifySession(value, SECRET, NOW + 61_000)).toBeNull();
    expect(await verifySession('n’importe quoi', SECRET, NOW)).toBeNull();
    expect(readCookie(`a=1; ${COOKIE_NAME}=${value}; b=2`, COOKIE_NAME)).toBe(value);
  });
});

describe('routage', () => {
  it('chemin direct ou paramètre de réécriture', () => {
    expect(routeOf(new Request('https://x/api/bourse/sources')).route).toBe('sources');
    const r = routeOf(new Request('https://x/api/bourse?path=quote&listing=3'));
    expect(r.route).toBe('quote');
    expect(new URL(r.query.url).search).toBe('?listing=3');
  });

  it('404 route inconnue, 405 méthode', async () => {
    const { fetch } = fakeSupabase({ failures: 0 });
    expect((await handleBourse(req('/api/bourse/admin'), ctx(fetch))).status).toBe(404);
    expect((await handleBourse(req('/api/bourse/sources', { method: 'POST' }), ctx(fetch))).status).toBe(405);
  });

  it('prochain passage des tâches, en UTC', () => {
    const ecb = SCHEDULES.find((s) => s.job === 'ecb-fx')!;
    expect(nextRun(ecb.runs, NOW)).toBe('2026-11-19T16:30:00.000Z');                       // jeudi
    expect(nextRun(ecb.runs, Date.parse('2026-11-20T17:00:00Z'))).toBe('2026-11-23T16:30:00.000Z');   // vendredi soir → lundi
    const eu = SCHEDULES.find((s) => s.job === 'eu-close')!;
    expect(nextRun(eu.runs, Date.parse('2026-11-20T06:40:00Z'))).toBe('2026-11-20T06:45:00.000Z');
  });
});

describe('connexion', () => {
  it('sans configuration : GET dit pourquoi, POST refuse', async () => {
    const { fetch } = fakeSupabase({ failures: 0 });
    const c = ctx(fetch, { ...ENV, BOURSE_SESSION_SECRET: '' });
    const g = await handleBourse(req('/api/bourse/session'), c);
    expect(await g.json()).toMatchObject({ authenticated: false, configured: false });
    expect((await handleBourse(loginReq(PASSWORD), c)).status).toBe(503);
  });

  it('bon mot de passe : cookie HttpOnly, Secure, SameSite=Strict, 30 jours', async () => {
    const { fetch } = fakeSupabase({ failures: 0 });
    const r = await handleBourse(loginReq(PASSWORD), ctx(fetch));
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const cookie = r.headers.get('Set-Cookie')!;
    expect(cookie).toMatch(new RegExp(`^${COOKIE_NAME}=v1\\.\\d+\\.[A-Za-z0-9_-]{43}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict$`));
    expect((await r.json()).expires_at).toBe('2026-12-19T10:00:00.000Z');
    const s = await handleBourse(req('/api/bourse/session', { cookie: cookie.split(';')[0] }), ctx(fetch));
    expect(await s.json()).toMatchObject({ authenticated: true });
  });

  it('mauvais mot de passe : 401 et essai compté sous une empreinte, jamais l’adresse', async () => {
    const state = { failures: 0 };
    const { fetch, calls } = fakeSupabase(state);
    const r = await handleBourse(loginReq('faux'), ctx(fetch));
    expect(r.status).toBe(401);
    expect(r.headers.get('Set-Cookie')).toBeNull();
    const insert = calls.find((c) => c.method === 'POST')!;
    expect(insert.url.pathname).toBe('/rest/v1/auth_failures');
    expect(insert.body).not.toContain('203.0.113.7');
    expect(JSON.parse(insert.body!)[0].key_hash).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it(`${MAX_FAILURES} échecs en 15 minutes : 429, même avec le bon mot de passe`, async () => {
    const { fetch } = fakeSupabase({ failures: MAX_FAILURES });
    const r = await handleBourse(loginReq(PASSWORD), ctx(fetch));
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toBe('900');
  });

  it('autre origine ou corps non JSON : 403', async () => {
    const { fetch } = fakeSupabase({ failures: 0 });
    expect((await handleBourse(loginReq(PASSWORD, { origin: 'https://evil.example' }), ctx(fetch))).status).toBe(403);
    expect((await handleBourse(loginReq(PASSWORD, { 'content-type': 'text/plain' }), ctx(fetch))).status).toBe(403);
  });

  it('déconnexion : cookie effacé', async () => {
    const { fetch } = fakeSupabase({ failures: 0 });
    const r = await handleBourse(req('/api/bourse/session', { method: 'DELETE', headers: { origin: ORIGIN, 'content-type': 'application/json' } }), ctx(fetch));
    expect(r.headers.get('Set-Cookie')).toMatch(/Max-Age=0/);
  });
});

describe('routes protégées', () => {
  it('401 sans session, cookie expiré ou signé avec un autre secret', async () => {
    const { fetch, calls } = fakeSupabase({ failures: 0 });
    for (const cookie of [undefined, `${COOKIE_NAME}=${await signSession(Math.floor(NOW / 1000) - 1, SECRET)}`,
      `${COOKIE_NAME}=${await signSession(Math.floor(NOW / 1000) + 60, 'x'.repeat(40))}`]) {
      for (const path of ['/api/bourse/sources', '/api/bourse/quote?listing=1', '/api/bourse/instruments?q=air']) {
        expect((await handleBourse(req(path, { cookie }), ctx(fetch))).status).toBe(401);
      }
    }
    expect(calls).toEqual([]);
  });

  it('sources : tâches, quota, EUR/USD, cotations avec leur dernière clôture', async () => {
    const tables = {
      bourse_runs: [{ job: 'eu-close', started_at: '2026-11-19T06:30:00Z', finished_at: '2026-11-19T06:30:20Z', ok: true, error: null, rows: 14, requests: 7, note: null }],
      api_quota: [{ used: 7, max: 20 }],
      fx_rates: [{ value_date: '2026-11-18', per_eur: 1.0989, received_at: '2026-11-18T16:30:05Z', source: 'BCE' }],
      instrument_listings: [
        { id: 1, symbol: 'PUST', currency: 'EUR', price_source: 'alphavantage', source_symbol: 'PUST.PAR',
          instruments: { name: 'Amundi PEA Nasdaq-100', isin: 'FR0011871110', kind: 'etf', pea_eligible: true, pea_reason: 'table' },
          prices: [{ value_date: '2026-11-18', close: 97.67, source: 'Alpha Vantage', received_at: '2026-11-19T06:30:10Z', currency: 'EUR' }] },
        { id: 2, symbol: 'X', currency: 'EUR', price_source: 'saisie', source_symbol: 'X', instruments: null, prices: [] },
      ],
    };
    const { fetch, calls } = fakeSupabase({ failures: 0, tables });
    const r = await handleBourse(req('/api/bourse/sources', { cookie: await cookieOf() }), ctx(fetch));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.jobs.map((j: { job: string }) => j.job)).toEqual(['ecb-fx', 'us-close', 'eu-close', 'ref-sec']);
    expect(body.jobs[2].last_run).toMatchObject({ ok: true, rows: 14 });
    expect(body.jobs[0].last_run).toBeNull();
    expect(body.quota).toEqual({ source: 'Alpha Vantage', day: '2026-11-19', used: 7, max: 20 });
    expect(body.fx).toEqual({ pair: 'EUR/USD', per_eur: '1.0989', value_date: '2026-11-18', received_at: '2026-11-18T16:30:05Z', source: 'BCE' });
    expect(body.listings[0].last).toEqual({ value_date: '2026-11-18', close: '97.67', currency: 'EUR', source: 'Alpha Vantage', received_at: '2026-11-19T06:30:10Z' });
    expect(body.listings[1]).toMatchObject({ name: 'X', last: null });
    const listing = calls.find((c) => c.url.pathname.endsWith('instrument_listings'))!;
    expect(listing.url.searchParams.get('prices.limit')).toBe('1');
    expect(listing.url.searchParams.get('tracked')).toBe('is.true');
  });

  it('recherche : caractères de syntaxe PostgREST refusés', async () => {
    const { fetch, calls } = fakeSupabase({ failures: 0 });
    const cookie = await cookieOf();
    for (const q of ['a,b', 'x)', 'a"b', '*', '']) {
      expect((await handleBourse(req(`/api/bourse/instruments?q=${encodeURIComponent(q)}`, { cookie }), ctx(fetch))).status).toBe(400);
    }
    expect(calls).toEqual([]);
    const ok = await handleBourse(req('/api/bourse/instruments?q=air liquide', { cookie }), ctx(fetch));
    expect(ok.status).toBe(200);
    expect(calls[0].url.searchParams.get('or')).toBe('(name.ilike."*air liquide*",isin.eq."AIR LIQUIDE")');
  });

  it('quote : identifiant numérique, 404 inconnu', async () => {
    const { fetch } = fakeSupabase({ failures: 0, tables: { instrument_listings: [] } });
    const cookie = await cookieOf();
    expect((await handleBourse(req('/api/bourse/quote?listing=abc', { cookie }), ctx(fetch))).status).toBe(400);
    expect((await handleBourse(req('/api/bourse/quote?listing=9', { cookie }), ctx(fetch))).status).toBe(404);
  });

  it('sans Supabase : 503 explicite', async () => {
    const { fetch } = fakeSupabase({ failures: 0 });
    const r = await handleBourse(req('/api/bourse/sources', { cookie: await cookieOf() }), ctx(fetch, { ...ENV, SUPABASE_URL: '' }));
    expect(r.status).toBe(503);
    expect((await r.json()).detail).toMatch(/non configuré/);
  });
});
