// Boucle de l'assistant IA (S3) : génération, compilation par notre moteur, réparations (3 au plus),
// refus visibles ; faits d'une lecture tirés de nos seules mesures.
import { describe, expect, it } from 'vitest';
import { explainFacts, generateAndCompile, MAX_REPAIRS, type Step } from './ai';
import type { RunError } from './engine';
import type { Metrics } from './metrics';

const ERR: RunError = { ok: false, error: 'Unexpected token EOF at 4:1', line: 4, column: 1 };
const req = { prompt: 'croisement', context: { asset: 'BTC', tf: '1D' } };

describe('génération et réparation', () => {
  it('code en erreur, réparé une fois, puis accepté', async () => {
    const steps: Step[] = [];
    const repairs: unknown[] = [];
    const r = await generateAndCompile(req, async (code) => (code === 'v1' ? ERR : null), (s) => steps.push(s), {
      generate: async () => ({ ok: true, code: 'v1', title: 'T' }),
      repair: async (b) => { repairs.push(b); return { ok: true, code: 'v2', change: 'parenthèse fermée' }; },
    });
    expect(r).toMatchObject({ ok: true, code: 'v2', repairs: 1 });
    expect(repairs[0]).toMatchObject({ code: 'v1', error: ERR.error, line: 4, context: { asset: 'BTC' } });
    expect(steps.map((s) => s.kind)).toEqual(['generate', 'compile', 'repair', 'repair', 'done']);
  });
  it(`toujours en erreur : arrêt après ${MAX_REPAIRS} réparations, code laissé à l’utilisateur`, async () => {
    let n = 0;
    const r = await generateAndCompile(req, async () => ERR, () => {}, {
      generate: async () => ({ ok: true, code: 'v0' }), repair: async () => ({ ok: true, code: `v${++n}` }) });
    expect(r).toMatchObject({ ok: false, code: `v${MAX_REPAIRS}`, repairs: MAX_REPAIRS });
  });
  it('génération refusée par le serveur : rien à compiler', async () => {
    const steps: Step[] = [];
    let compiled = 0;
    const r = await generateAndCompile(req, async () => { compiled++; return null; }, (s) => steps.push(s), {
      generate: async () => ({ ok: false, reason: 'réponse sans script strategy()' }), repair: async () => ({ ok: false }) });
    expect(r).toMatchObject({ ok: false, code: null });
    expect(compiled).toBe(0);
    expect(steps.at(-1)!.text).toMatch(/réponse sans script strategy\(\)/);
  });
});

describe('faits d’une lecture', () => {
  it('mesures mises en forme, seuils de lecture, rien d’autre', () => {
    const m = { trades: 16, winrate: 0.625, total_pnl: 4168.3, total_pnl_pct: 41.68, rr: 1.19, ex_pnl: 260.5, max_dd_pct: 23.2, sharpe: 0.9, t_stat: 1.03,
      dsr: 0.911, trials: 1, profit_factor: 1.98 } as unknown as Metrics;
    const f = explainFacts(m, 'USDT', { oos_sharpe: 2.47, is_sharpe: 0.25, mc_ruin_pct: 1.1 });
    expect(f).toMatchObject({ trades: 16, winrate_pct: '62,5 %', sharpe: '0,90', deflated_sharpe_pct: '91,1 %', out_of_sample_sharpe: '2,47',
      monte_carlo_ruin_pct: '1,1 %', thresholds: { t_stat: 2, deflated_sharpe_pct: 95 } });
    expect(f.total_pnl).toMatch(/^\+4\s168 USDT$/);
  });
});
