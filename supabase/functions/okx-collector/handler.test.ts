// @vitest-environment node
// Requête HTTP de l'Edge Function okx-collector : méthode, secret d'appel
// (comparaison à temps constant), choix de la clé Supabase, réponse sans secret.
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_INSTRUMENTS, OKX_EEA_REST, type CollectorDeps, type RunResult } from './collector.ts';
import { createHandler, instrumentsFrom, secretKeyFrom, secretMatches, type EnvGetter } from './handler.ts';
import type { FetchLike } from './postgrest.ts';

const SECRET = 'a'.repeat(31) + 'Z' + '0123456789abcdef0123456789abcdef';
const SERVICE_KEY = 'sb_secret_0123456789abcdefghij';

const okRun: RunResult = {
  ok: true, started_at: '2026-10-20T10:35:00.000Z', finished_at: '2026-10-20T10:35:00.900Z', duration_ms: 900,
  rows: 6, gaps: 0, okx_offset_ms: 12.5, rtt_ms: 140, errors: [],
};

function envOf(vars: Record<string, string | undefined>): EnvGetter {
  return (name) => vars[name];
}

const BASE_ENV = {
  COLLECTOR_SECRET: SECRET,
  SUPABASE_URL: 'https://ref.supabase.co',
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: SERVICE_KEY }),
};

const noFetch: FetchLike = async () => { throw new Error('aucun appel réseau attendu'); };

function setup(vars: Record<string, string | undefined> = BASE_ENV, result: RunResult | Error = okRun) {
  const run = vi.fn(async (_deps: CollectorDeps) => {
    if (result instanceof Error) throw result;
    return result;
  });
  const handler = createHandler(envOf(vars), { fetch: noFetch, now: () => 0, run });
  return { handler, run };
}

const post = (secret?: string) => new Request('https://ref.supabase.co/functions/v1/okx-collector', {
  method: 'POST',
  headers: secret === undefined ? {} : { 'x-collector-secret': secret },
  body: '{}',
});

describe('contrôle de l’appel', () => {
  it('405 hors POST', async () => {
    const { handler, run } = setup();
    const r = await handler(new Request('https://ref.supabase.co/functions/v1/okx-collector'));
    expect(r.status).toBe(405);
    expect(r.headers.get('Allow')).toBe('POST');
    expect(run).not.toHaveBeenCalled();
  });

  it('401 sans en-tête ou avec un mauvais secret', async () => {
    const { handler, run } = setup();
    for (const given of [undefined, '', SECRET.slice(0, -1), `${SECRET}x`, SECRET.toUpperCase()]) {
      const r = await handler(post(given));
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ ok: false, error: 'secret d’appel invalide' });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('500 si COLLECTOR_SECRET est absent ou trop court : jamais ouverte par défaut', async () => {
    for (const s of [undefined, '', 'court']) {
      const { handler, run } = setup({ ...BASE_ENV, COLLECTOR_SECRET: s });
      const r = await handler(post(s ?? ''));
      expect(r.status).toBe(500);
      expect(run).not.toHaveBeenCalled();
    }
  });

  it('secretMatches : égalité exacte seulement', async () => {
    expect(await secretMatches(SECRET, SECRET)).toBe(true);
    expect(await secretMatches('', SECRET)).toBe(false);
    expect(await secretMatches(`${SECRET} `, SECRET)).toBe(false);
    expect(await secretMatches('', '')).toBe(false);
  });
});

describe('passage', () => {
  it('200 : collecteur lancé sur OKX EEA, réponse JSON sans aucun secret', async () => {
    const { handler, run } = setup();
    const r = await handler(post(SECRET));
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const text = await r.text();
    expect(JSON.parse(text)).toEqual(okRun);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(SERVICE_KEY);
    const deps = run.mock.calls[0][0];
    expect(deps.okxBase).toBe(OKX_EEA_REST);
    expect(deps.instruments).toEqual(DEFAULT_INSTRUMENTS);
  });

  it('500 si le passage a rencontré des erreurs (visible dans net._http_response)', async () => {
    const { handler } = setup(BASE_ENV, { ...okRun, ok: false, errors: ['ETH-USDT-SWAP · ticker : code 51001'] });
    const r = await handler(post(SECRET));
    expect(r.status).toBe(500);
    expect((await r.json()).errors).toEqual(['ETH-USDT-SWAP · ticker : code 51001']);
  });

  it('500 si le journal ne peut pas être écrit', async () => {
    const { handler } = setup(BASE_ENV, new Error('PostgREST 503 sur collector_runs : indisponible'));
    const r = await handler(post(SECRET));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ ok: false, error: 'PostgREST 503 sur collector_runs : indisponible' });
  });

  it('500 sans URL ni clé Supabase, ou avec une clé publiable', async () => {
    for (const vars of [
      { COLLECTOR_SECRET: SECRET, SUPABASE_SECRET_KEYS: BASE_ENV.SUPABASE_SECRET_KEYS },
      { COLLECTOR_SECRET: SECRET, SUPABASE_URL: BASE_ENV.SUPABASE_URL },
      { ...BASE_ENV, SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_publishable_x' }) },
    ]) {
      const { handler, run } = setup(vars);
      const r = await handler(post(SECRET));
      expect(r.status).toBe(500);
      expect(run).not.toHaveBeenCalled();
    }
  });
});

describe('configuration', () => {
  it('clé : SUPABASE_SECRET_KEYS.default, sinon SUPABASE_SERVICE_ROLE_KEY', () => {
    expect(secretKeyFrom(envOf({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_new"}', SUPABASE_SERVICE_ROLE_KEY: 'eyJold' })))
      .toBe('sb_secret_new');
    expect(secretKeyFrom(envOf({ SUPABASE_SECRET_KEYS: 'pas du json', SUPABASE_SERVICE_ROLE_KEY: 'eyJold' }))).toBe('eyJold');
    expect(secretKeyFrom(envOf({ SUPABASE_SECRET_KEYS: '{"autre":"x"}' }))).toBeNull();
    expect(secretKeyFrom(envOf({}))).toBeNull();
  });

  it('instruments : défaut, liste explicite, identifiants refusés', () => {
    expect(instrumentsFrom(undefined)).toEqual(['BTC-USDT-SWAP', 'ETH-USDT-SWAP']);
    expect(instrumentsFrom(' BTC-USDT-SWAP , BTC-USDT-SWAP ')).toEqual(['BTC-USDT-SWAP']);
    expect(() => instrumentsFrom('BTC-USDT-SWAP,btc&x=1')).toThrow('invalide');
  });
});
