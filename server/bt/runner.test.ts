// @vitest-environment node
// Recherche autonome sur la machine Oracle (T-070) : budgets d'un passage (au-delà des 900 ms de
// Supabase), bail long, enchaînement ou attente selon la réponse de la boucle, erreur → 60 s,
// aucun secret dans l'état écrit, arrêt entre deux passages. La boucle elle-même (essais, plafond
// de Gemini, bail renouvelé) est testée dans supabase/functions/bt-jobs/loop.test.ts.
import { describe, expect, it } from 'vitest';
import type { LoopDeps } from '../../supabase/functions/bt-jobs/loop';
import type { Json, Rest } from '../../supabase/functions/p1-jobs/rest';
import { ERROR_MS, IDLE_MS, LEASE_MS, onePass, PASS_MS, runForever, type PassStatus, type RunnerDeps } from './main';

const SECRET = 'sb_secret_NE_DOIT_JAMAIS_SORTIR';
function deps(run: RunnerDeps['run']): RunnerDeps & { written: PassStatus[]; slept: number[] } {
  const written: PassStatus[] = [], slept: number[] = [];
  return {
    rest: {} as Rest, env: (n) => (n === 'SUPABASE_SECRET_KEY' || n === 'GEMINI_API_KEY' ? SECRET : undefined),
    fetch: async () => new Response('{}'), now: () => 1_000, sleep: async (ms) => { slept.push(ms); },
    writeStatus: (s) => written.push(s), run, written, slept,
  };
}

describe('service de recherche (Oracle)', () => {
  it('budgets d’un passage : 5 min de calcul, bail de 6 min ; essais faits → passage suivant aussitôt', async () => {
    let seen: LoopDeps | null = null;
    const d = deps(async (x) => { seen = x; return { ok: true, loop: 'L1', attempts: 12, gemini_calls: 2, compute_ms: 41_000 }; });
    const r = await onePass(d, 1);
    expect(seen!).toMatchObject({ wallBudgetMs: PASS_MS, computeBudgetMs: PASS_MS, leaseMs: LEASE_MS });
    expect(PASS_MS).toBeGreaterThan(900);
    expect(r).toEqual({ delay: 0, status: expect.objectContaining({ loop: 'L1', attempts: 12, compute_ms: 41_000, idle: false, error: null }) });
  });

  it('rien à faire, recherche occupée ou en attente du plafond de Gemini : 15 s ; erreur : 60 s', async () => {
    expect((await onePass(deps(async () => ({ ok: true, idle: true })), 1)).delay).toBe(IDLE_MS);
    expect((await onePass(deps(async () => ({ ok: true, busy: 'L1' })), 1)).delay).toBe(IDLE_MS);
    expect((await onePass(deps(async () => ({ ok: true, loop: 'L1', waiting: 'plafond de 50 appels à Gemini atteint' })), 1)).delay).toBe(IDLE_MS);
    const e = await onePass(deps(async () => { throw new Error('PostgREST 503'); }), 1);
    expect(e.delay).toBe(ERROR_MS);
    expect(e.status.error).toBe('PostgREST 503');
  });

  it('état écrit sans secret ; arrêt entre deux passages', async () => {
    let n = 0;
    const d = deps(async () => { n++; return (n === 1 ? { ok: true, loop: 'L1', attempts: 3, compute_ms: 5 } : { ok: true, idle: true }) as Record<string, Json>; });
    await runForever(d, () => n >= 3);
    expect(d.written).toHaveLength(3);
    expect(d.slept).toEqual([IDLE_MS]);                         // arrêt demandé après le 3e passage : pas d'attente
    expect(JSON.stringify(d.written)).not.toContain(SECRET);
  });
});
