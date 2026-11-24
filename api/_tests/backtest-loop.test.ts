// @vitest-environment node
// Recherche autonome (S4, T-064), routes Vercel : session exigée, plan validé, bornes des marchés lues
// dans bt_candles (période, coupure dans / hors échantillon), une seule recherche à la fois,
// verdicts hors échantillon masqués tant que la recherche tourne, arrêt.
import { describe, expect, it } from 'vitest';
import { COOKIE_NAME, signSession } from '../_lib/bourse/auth.js';
import { handleBacktest } from '../_lib/backtest.js';
import { validatePlan } from '../_lib/backtest-loop.js';
import type { FetchFn } from '../_lib/okx.js';
import { createContext } from '../_lib/routes.js';

const HASH = 'pbkdf2-sha256$100000$AAECAwQFBgcICQoLDA0ODw$W96qzf7j9JBRjdvDcxWyNI1t7VDAmtdCWZ0FVrtrG_E';
const SECRET = 's'.repeat(48);
const NOW = Date.parse('2026-11-24T22:30:00Z');
const ENV = { BOURSE_PASSWORD_HASH: HASH, BOURSE_SESSION_SECRET: SECRET, SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_0123456789abcdefghij' };
const ORIGIN = 'https://terminal.example';
const PINE = '//@version=6\nstrategy("Test", overlay=true)\n';
const FIRST = '2018-03-23T00:00:00+00:00', LAST = '2026-11-23T00:00:00+00:00';

type R = Record<string, unknown>;
function db() {
  const t: Record<string, R[]> = { bt_loops: [], bt_attempts: [] };
  const match = (r: R, k: string, c: string) => {
    if (c.startsWith('eq.')) return String(r[k]) === c.slice(3);
    if (c.startsWith('in.(')) return c.slice(4, -1).split(',').includes(String(r[k]));
    return true;
  };
  const fetch: FetchFn = async (url, init) => {
    const u = new URL(url);
    const table = u.pathname.split('/').pop()!;
    const params = [...u.searchParams].filter(([k]) => !['select', 'order', 'limit'].includes(k));
    if (table === 'bt_candles') {
      return new Response(JSON.stringify([{ ts: u.searchParams.get('order') === 'ts.asc' ? FIRST : LAST }]), { status: 200 });
    }
    const rows = (t[table] ??= []).filter((r) => params.every(([k, c]) => match(r, k, c)));
    const method = init?.method ?? 'GET';
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': `0-0/${rows.length}` } });
    if (method === 'POST') { t[table].push(...(JSON.parse(String(init!.body)) as R[])); return new Response(null, { status: 201 }); }
    if (method === 'PATCH') { for (const r of rows) Object.assign(r, JSON.parse(String(init!.body))); return new Response(JSON.stringify(rows), { status: 200 }); }
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  return { t, ctx: createContext({ fetch, now: () => NOW, monotonic: () => 0, sleep: async () => {} }, ENV) };
}

async function call(c: ReturnType<typeof db>['ctx'], method: string, path: string, body?: unknown, session = true) {
  const headers = new Headers({ 'content-type': 'application/json', origin: ORIGIN, host: 'terminal.example' });
  if (session) headers.set('cookie', `${COOKIE_NAME}=${await signSession(Math.floor(NOW / 1000) + 3600, SECRET)}`);
  return handleBacktest(new Request(`${ORIGIN}/api/backtest/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), c);
}

const PLAN = { markets: [{ asset: 'BTC', tf: '1D' }, { asset: 'BTC', tf: '4H' }], period: '5y', is_share: 0.7, max_attempts: 50, max_gemini: 12,
  start: { kind: 'code', title: 'SMA', code: PINE, inputs: { fast: 10 } }, seed: 42 };

describe('recherche autonome : routes', () => {
  it('session exigée, y compris en lecture', async () => {
    const { ctx } = db();
    expect((await call(ctx, 'GET', 'loops', undefined, false)).status).toBe(401);
    expect((await call(ctx, 'POST', 'loop-create', PLAN, false)).status).toBe(401);
  });

  it('création : bornes lues dans bt_candles, période de 5 ans, coupure à 70 %, plan complété', async () => {
    const { t, ctx } = db();
    const r = await call(ctx, 'POST', 'loop-create', PLAN);
    expect(r.status).toBe(201);
    const { id, spec } = await r.json() as { id: string; spec: { markets: { from: number; to: number; split: number }[]; thresholds: R; settings: R; rewrite_every: number } };
    expect(t.bt_loops[0]).toMatchObject({ id, status: 'running', title: 'SMA' });
    const m = spec.markets[0];
    expect(m.to).toBe(Date.parse(LAST));
    expect(m.from).toBeCloseTo(Date.parse(LAST) - 5 * 365.25 * 86_400_000, -3);
    expect((m.split - m.from) / (m.to - m.from)).toBeCloseTo(0.7, 6);
    // 4H : dernière tranche complète (dernière bougie 1H à 00:00 → tranche du 22/11 à 20:00).
    expect(spec.markets[1].to).toBe(Date.parse('2026-11-22T20:00:00Z'));
    expect(spec).toMatchObject({ thresholds: { min_trades: 30, sharpe: 1, t_stat: 2, dsr: 0.95 }, settings: { capital: 10_000, margin: false }, rewrite_every: 5 });
    // Une seule recherche à la fois.
    expect((await call(ctx, 'POST', 'loop-create', PLAN)).status).toBe(409);
  });

  it('plan refusé : marché inconnu, départ sans strategy(), budget hors bornes, texte sans Gemini', () => {
    expect(() => validatePlan({ ...PLAN, markets: [{ asset: 'QQQ', tf: '1H' }] })).toThrow(/marché inconnu/);
    expect(() => validatePlan({ ...PLAN, start: { kind: 'code', code: 'indicator("x")' } })).toThrow(/strategy/);
    expect(() => validatePlan({ ...PLAN, max_attempts: 500 })).toThrow(/budget d’essais/);
    expect(() => validatePlan({ ...PLAN, start: { kind: 'prompt', prompt: 'x' }, max_gemini: 0 })).toThrow(/au moins un appel/);
    expect(() => validatePlan({ ...PLAN, mode: 'firm', firm: { id: 'autre' } })).toThrow(/société/);
  });

  it('hors échantillon masqué tant que la recherche tourne, montré une fois finie', async () => {
    const { t, ctx } = db();
    const id = '0a0b0c0d-1111-4222-8333-444455556666';
    t.bt_loops.push({ id, status: 'running', title: 'x', spec: { max_attempts: 50, markets: [] } });
    t.bt_attempts.push({ loop_id: id, n: 1, ok: true, is_pass: true, oos_pass: false, oos_reasons: ['BTC 1D : PnL négatif ou nul'] });
    const live = await (await call(ctx, 'GET', `loop?id=${id}`)).json() as { attempts: R[]; oos_hidden: boolean };
    expect(live.oos_hidden).toBe(true);
    expect(live.attempts[0]).toMatchObject({ oos_pass: null, oos_reasons: null });
    t.bt_loops[0].status = 'done';
    const done = await (await call(ctx, 'GET', `loop?id=${id}`)).json() as { attempts: R[]; oos_hidden: boolean };
    expect(done.attempts[0]).toMatchObject({ oos_pass: false, oos_reasons: ['BTC 1D : PnL négatif ou nul'] });
    const list = await (await call(ctx, 'GET', 'loops')).json() as { loops: R[] };
    expect(list.loops[0]).toMatchObject({ id, max_attempts: 50 });
    expect(list.loops[0].spec).toBeUndefined();
  });

  it('arrêt : statut « stopping », recherche finie refusée', async () => {
    const { t, ctx } = db();
    const id = '0a0b0c0d-1111-4222-8333-444455556666';
    t.bt_loops.push({ id, status: 'running' });
    expect((await call(ctx, 'POST', 'loop-stop', { id })).status).toBe(200);
    expect(t.bt_loops[0].status).toBe('stopping');
    t.bt_loops[0].status = 'done';
    expect((await call(ctx, 'POST', 'loop-stop', { id })).status).toBe(409);
  });
});
