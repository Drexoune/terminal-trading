// @vitest-environment node
// Requête HTTP de l'Edge Function bourse-jobs : méthode, secret, tâche, appel rpc.
import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../okx-collector/postgrest.ts';
import { createHandler, createRpc } from './handler.ts';
import type { Job, JobDeps, JobResult } from './jobs.ts';

const SECRET = 'b'.repeat(40);
const ENV: Record<string, string> = {
  BOURSE_JOBS_SECRET: SECRET,
  SUPABASE_URL: 'https://ref.supabase.co',
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_0123456789abcdefghij' }),
};
const OK: JobResult = { ok: true, job: 'ecb-fx', started_at: 'a', finished_at: 'b', rows: 1, requests: 1, note: null, errors: [] };
const noFetch: FetchLike = async () => { throw new Error('aucun appel réseau attendu'); };

function setup(env: Record<string, string> = ENV, result: JobResult = OK) {
  const run = vi.fn(async (_job: Job, _deps: JobDeps) => result);
  const handler = createHandler((n) => env[n], { fetch: noFetch, now: () => 0, sleep: async () => {}, run });
  return { handler, run };
}

const post = (job: string, secret = SECRET) => new Request(`https://ref.supabase.co/functions/v1/bourse-jobs?job=${job}`, {
  method: 'POST', headers: { 'x-jobs-secret': secret }, body: '{}',
});

describe('bourse-jobs : contrôle de l’appel', () => {
  it('405 hors POST, 401 sans le bon secret, 500 sans secret configuré', async () => {
    const { handler, run } = setup();
    expect((await handler(new Request('https://x/functions/v1/bourse-jobs?job=ecb-fx'))).status).toBe(405);
    expect((await handler(post('ecb-fx', 'faux'))).status).toBe(401);
    expect((await setup({ ...ENV, BOURSE_JOBS_SECRET: 'court' }).handler(post('ecb-fx'))).status).toBe(500);
    expect(run).not.toHaveBeenCalled();
  });

  it('400 sur tâche inconnue', async () => {
    const { handler, run } = setup();
    const r = await handler(post('drop-table'));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/ecb-fx, us-close, us-backfill, eu-close, ref-sec, explore/);
    expect(run).not.toHaveBeenCalled();
  });

  it('lance la tâche demandée ; 500 si elle échoue', async () => {
    const { handler, run } = setup();
    const r = await handler(post('us-close'));
    expect(r.status).toBe(200);
    expect(run.mock.calls[0][0]).toBe('us-close');
    const failed = setup(ENV, { ...OK, ok: false, errors: ['x'] });
    expect((await failed.handler(post('ecb-fx'))).status).toBe(500);
  });
});

describe('rpc', () => {
  it('POST /rest/v1/rpc/<nom> avec la clé secrète, réponse JSON', async () => {
    const calls: { url: string; init: unknown }[] = [];
    const rpc = createRpc('https://ref.supabase.co/', 'sb_secret_0123456789abcdefghij', async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => 'true' };
    });
    expect(await rpc('bourse_reserve_quota', { p_source: 'alphavantage', p_day: '2026-11-19', p_max: 20 })).toBe(true);
    expect(calls[0].url).toBe('https://ref.supabase.co/rest/v1/rpc/bourse_reserve_quota');
    expect(calls[0].init).toMatchObject({ method: 'POST', headers: { apikey: 'sb_secret_0123456789abcdefghij' } });
    await expect(rpc('x; drop', {})).rejects.toThrow(/nom invalide/);
  });
});
