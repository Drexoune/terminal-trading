/** @vitest-environment node */
// GET /api/collector-health : lecture de collector_runs et collector_gaps par
// PostgREST, avec la clé secrète côté serveur. Deux formes de clé (sb_secret_…
// en apikey seul ; JWT service_role en apikey + Bearer), configuration absente,
// erreurs sans fuite de secret, pagination des trous.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { authHeaders, supabaseConfig } from '../_lib/supabase.ts';
import { handleCollectorHealth } from '../_lib/routes.ts';
import { req, testContext } from './fakes.ts';

const NOW = Date.UTC(2026, 9, 20, 9, 30, 0);
const SINCE = new Date(NOW - 86_400_000).toISOString();
const URL_ = 'https://abcdefghijklmnop.supabase.co';
const SB_SECRET = 'sb_secret_test_only_not_a_real_key';

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role: string) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ iss: 'supabase', role, exp: 1983812996 })}.c2lnbmF0dXJl`;

interface Call { method: string; table: string; params: Record<string, string>; headers: Headers }

interface Db {
  lastRun?: Record<string, unknown> | null;
  runs?: number;
  failures?: number;
  gaps?: { missing: number | null }[];
  maxRows?: number; // max_rows du serveur (1 000 par défaut chez Supabase)
}

/** Faux PostgREST : lignes et décomptes (Content-Range) selon les filtres reçus. */
function fakeSupabase(db: Db, override?: (c: Call) => Response | undefined) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const call: Call = {
      method: init?.method ?? 'GET', table: u.pathname.replace('/rest/v1/', ''),
      params: Object.fromEntries(u.searchParams), headers: new Headers(init?.headers),
    };
    calls.push(call);
    const forced = override?.(call);
    if (forced) return forced;
    if (call.table === 'collector_runs' && call.method === 'HEAD') {
      const n = call.params.ok === 'is.false' ? db.failures ?? 0 : db.runs ?? 0;
      return new Response(null, { status: 200, headers: { 'Content-Range': n ? `0-${n - 1}/${n}` : '*/0' } });
    }
    if (call.table === 'collector_runs') {
      return Response.json(db.lastRun ? [db.lastRun] : []);
    }
    if (call.table === 'collector_gaps') {
      const all = db.gaps ?? [];
      const offset = Number(call.params.offset ?? 0);
      const page = all.slice(offset, offset + Math.min(Number(call.params.limit), db.maxRows ?? 1000));
      const range = page.length ? `${offset}-${offset + page.length - 1}/${all.length}` : `*/${all.length}`;
      return Response.json(page, { headers: { 'Content-Range': range } });
    }
    return Response.json({ code: 'PGRST205', message: 'not found' }, { status: 404 });
  };
  return { fetch, calls };
}

async function health(env: Record<string, string>, db: Db = {}, override?: (c: Call) => Response | undefined) {
  const sb = fakeSupabase(db, override);
  const t = testContext({ nowMs: NOW, env, fetch: sb.fetch });
  const res = await handleCollectorHealth(req('/api/collector-health'), t.ctx);
  const text = await res.text();
  return { res, text, body: JSON.parse(text), calls: sb.calls };
}

const LAST = {
  started_at: '2026-10-20T09:29:00.012+00:00', finished_at: '2026-10-20T09:29:01.5+00:00',
  ok: true, error: null, rows: 4,
};

afterEach(() => vi.restoreAllMocks());

describe('sans configuration', () => {
  it('variables absentes : configured false, 200, aucun appel', async () => {
    const { res, body, calls } = await health({});
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({
      configured: false, reason: 'variable(s) absente(s) : SUPABASE_URL, SUPABASE_SECRET_KEY',
      last_run: null, age_ms: null, runs_24h: null, failures_24h: null, gaps_24h: null, source: 'Supabase',
    });
    expect(calls).toHaveLength(0);
  });

  it('une seule variable : la raison nomme celle qui manque', async () => {
    expect((await health({ SUPABASE_URL: URL_ })).body.reason).toBe('variable(s) absente(s) : SUPABASE_SECRET_KEY');
    expect((await health({ SUPABASE_SECRET_KEY: SB_SECRET })).body.reason).toBe('variable(s) absente(s) : SUPABASE_URL');
  });

  it('clé publique, clé anon, format inconnu, adresse en clair : refusés sans appel ni fuite', async () => {
    const anon = jwt('anon');
    for (const [env, reason] of [
      [{ SUPABASE_URL: URL_, SUPABASE_SECRET_KEY: 'sb_publishable_abcdefghijklmnop' }, /clé publique/],
      [{ SUPABASE_URL: URL_, SUPABASE_SECRET_KEY: anon }, /rôle anon : la clé service_role est attendue/],
      [{ SUPABASE_URL: URL_, SUPABASE_SECRET_KEY: 'n-importe-quoi-123456' }, /format non reconnu/],
      [{ SUPABASE_URL: 'http://abcdefghijklmnop.supabase.co', SUPABASE_SECRET_KEY: SB_SECRET }, /SUPABASE_URL invalide/],
      [{ SUPABASE_URL: `${URL_}/rest/v1`, SUPABASE_SECRET_KEY: SB_SECRET }, /SUPABASE_URL invalide/],
    ] as const) {
      const { body, calls, text } = await health(env);
      expect(body.configured).toBe(false);
      expect(body.reason).toMatch(reason);
      expect(calls).toHaveLength(0);
      expect(text).not.toContain(env.SUPABASE_SECRET_KEY);
    }
  });

  it('Supabase local (supabase start) : http accepté vers la machine elle-même', () => {
    expect(supabaseConfig({ SUPABASE_URL: 'http://127.0.0.1:54321/', SUPABASE_SECRET_KEY: SB_SECRET }))
      .toEqual({ ok: true, config: { url: 'http://127.0.0.1:54321', headers: { apikey: SB_SECRET } } });
  });
});

describe('clés secrètes : sb_secret_… ou JWT service_role', () => {
  it('sb_secret_… : en-tête apikey SEUL (un Bearer provoquerait « Invalid JWT »)', async () => {
    const { calls } = await health({ SUPABASE_URL: URL_, SUPABASE_SECRET_KEY: SB_SECRET }, { lastRun: LAST, runs: 3 });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.headers.get('apikey')).toBe(SB_SECRET);
      expect(c.headers.get('authorization')).toBeNull();
    }
  });

  it('ancienne clé JWT service_role : apikey + Authorization Bearer', async () => {
    const key = jwt('service_role');
    const { calls, body } = await health({ SUPABASE_URL: URL_, SUPABASE_SECRET_KEY: key }, { lastRun: LAST });
    expect(body.configured).toBe(true);
    for (const c of calls) {
      expect(c.headers.get('apikey')).toBe(key);
      expect(c.headers.get('authorization')).toBe(`Bearer ${key}`);
    }
  });

  it('authHeaders seul', () => {
    expect(authHeaders(SB_SECRET)).toEqual({ ok: true, headers: { apikey: SB_SECRET } });
    expect(authHeaders(jwt('service_role'))).toMatchObject({ ok: true });
    expect(authHeaders('eyJ.pas.unjwt')).toMatchObject({ ok: false });
  });
});

describe('configuré', () => {
  const env = { SUPABASE_URL: `${URL_}/`, SUPABASE_SECRET_KEY: SB_SECRET };

  it('dernier passage terminé, comptes sur 24 h, minutes manquantes sur 24 h', async () => {
    const { res, body, calls } = await health(env, {
      lastRun: LAST, runs: 1440, failures: 3, gaps: [{ missing: 2 }, { missing: 3 }, { missing: null }],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({
      configured: true,
      last_run: { started_at: LAST.started_at, finished_at: LAST.finished_at, ok: true, error: null, rows: 4 },
      age_ms: NOW - Date.parse(LAST.finished_at),
      runs_24h: 1440, failures_24h: 3, gaps_24h: 5, source: 'Supabase',
    });
    // Requêtes PostgREST exactes.
    expect(calls.map((c) => [c.method, c.table, c.params, c.headers.get('prefer')])).toEqual([
      ['GET', 'collector_runs', {
        select: 'started_at,finished_at,ok,error,rows', finished_at: 'not.is.null', order: 'started_at.desc', limit: '1',
      }, null],
      ['HEAD', 'collector_runs', { select: 'id', started_at: `gte.${SINCE}` }, 'count=exact'],
      ['HEAD', 'collector_runs', { select: 'id', started_at: `gte.${SINCE}`, ok: 'is.false' }, 'count=exact'],
      ['GET', 'collector_gaps', {
        select: 'missing', detected_at: `gte.${SINCE}`, order: 'id.asc', offset: '0', limit: '1000',
      }, 'count=exact'],
    ]);
  });

  it('aucun passage terminé : last_run et age_ms null', async () => {
    const { body } = await health(env, {});
    expect(body).toMatchObject({ configured: true, last_run: null, age_ms: null, runs_24h: 0, failures_24h: 0, gaps_24h: 0 });
  });

  it('passage en échec : erreur transmise, tronquée, secrets masqués', async () => {
    const { body, text } = await health(env, {
      lastRun: { ...LAST, ok: false, error: `OKX HTTP 503 apikey=${SB_SECRET} ${'x'.repeat(400)}`, rows: null },
    });
    expect(body.last_run.ok).toBe(false);
    expect(body.last_run.error.startsWith('OKX HTTP 503 apikey=***')).toBe(true);
    expect(body.last_run.error.length).toBe(300);
    expect(text).not.toContain(SB_SECRET);
  });

  it('trous paginés : le décompte pilote la pagination, même si max_rows < 1 000', async () => {
    const gaps = Array.from({ length: 2500 }, (_, i) => ({ missing: (i % 3) + 1 }));
    const expected = gaps.reduce((s, g) => s + g.missing, 0);
    const a = await health(env, { gaps });
    expect(a.body.gaps_24h).toBe(expected);
    expect(a.calls.filter((c) => c.table === 'collector_gaps').map((c) => c.params.offset)).toEqual(['0', '1000', '2000']);
    const b = await health(env, { gaps, maxRows: 500 });
    expect(b.body.gaps_24h).toBe(expected);
    expect(b.calls.filter((c) => c.table === 'collector_gaps')).toHaveLength(5);
  });
});

describe('erreurs Supabase : 502, sans fuite', () => {
  const env = { SUPABASE_URL: URL_, SUPABASE_SECRET_KEY: SB_SECRET };

  it('clé refusée (401) : statut seulement, ni la clé ni le message de Supabase', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { res, body, text } = await health(env, {}, () => Response.json(
      { message: `Invalid API key ${SB_SECRET}`, hint: 'Double check your Supabase `anon` or `service_role` API key.' },
      { status: 401 }));
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({ detail: 'Supabase indisponible : HTTP 401' });
    expect(text).not.toContain(SB_SECRET);
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('HTTP 401');
    expect(logged).not.toContain(SB_SECRET);
  });

  it('table absente (migration non appliquée) : le code Postgres est donné, le message reste au journal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { body } = await health(env, {}, (c) => (c.table === 'collector_gaps'
      ? Response.json({ code: '42P01', message: 'relation "public.collector_gaps" does not exist' }, { status: 404 })
      : undefined));
    expect(body).toEqual({ detail: 'Supabase indisponible : HTTP 404 (code 42P01)' });
    expect(warn.mock.calls.flat().join(' ')).toContain('does not exist');
  });

  it('réseau coupé : message générique, l’erreur brute reste au journal (masquée)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { body, text } = await health(env, {}, () => {
      throw new TypeError(`fetch failed ${URL_}?apikey=${SB_SECRET}`);
    });
    expect(body).toEqual({ detail: 'Supabase indisponible : injoignable ou délai dépassé' });
    expect(text).not.toContain(SB_SECRET);
    expect(warn.mock.calls.flat().join(' ')).not.toContain(SB_SECRET);
  });

  it('décompte absent : erreur explicite plutôt que zéro supposé', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { body } = await health(env, {}, (c) => (c.method === 'HEAD' ? new Response(null, { status: 200 }) : undefined));
    expect(body).toEqual({ detail: 'Supabase indisponible : décompte absent de la réponse' });
  });
});
