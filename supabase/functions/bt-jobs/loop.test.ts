// @vitest-environment node
// Tâche loop (recherche autonome, S4, T-064) sur la base simulée, avec le paquet réellement déployé
// (research-core.gen.js) et 799 bougies quotidiennes réelles de BTC (OKX) ; Gemini simulé.
// Porte de S4 : une recherche de 50 essais tourne sans surveillance, passage après passage, et son
// rapport se reproduit (rejeu des essais → même empreinte). Aussi : hybride (Gemini tous les 5
// essais), réparation, plafond du jour → attente, hors échantillon jamais transmis, arrêt, bail.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemRest } from '../p1-jobs/_memrest.ts';
import type { Row } from '../p1-jobs/rest.ts';
import { KNOWN, knownById } from '../../../web/src/backtest/strategies.ts';
import * as core from './research-core.gen.js';
import { nextParisDay, runLoop, type LoopDeps } from './loop.ts';

const BTC = JSON.parse(readFileSync(new URL('../../../web/src/backtest/fixtures/okx-btc-1d-2024-09-16_2026-11-23.json', import.meta.url), 'utf8')) as
  { t: number; o: number; h: number; l: number; c: number }[];
const COLS = { t: BTC.map((b) => b.t), o: BTC.map((b) => b.o), h: BTC.map((b) => b.h), l: BTC.map((b) => b.l), c: BTC.map((b) => b.c), v: null, n: BTC.length, source: 'okx' };
const KEY = 'AIzaFAKEKEYFORTESTS0123456789';
const T0 = Date.parse('2026-11-24T10:00:00Z');
const SMA = knownById('sma_cross')!.source;
const BROKEN = '//@version=6\nstrategy("Cassé", overlay=true)\nx = ta.sma(close\n';

class Db extends MemRest {
  override async rpc<T>(fn: string, args: Row): Promise<T> {
    if (fn !== 'bt_candles_cols') throw new Error(`rpc ${fn}`);
    return (args.p_asset === 'BTC' && args.p_tf === '1D' ? [COLS] : [{ t: null, o: null, h: null, l: null, c: null, n: 0 }]) as T;
  }
}

function spec(o: Partial<core.LoopSpec> = {}): core.LoopSpec {
  const from = BTC[0].t, to = BTC[BTC.length - 1].t;
  return {
    v: 1, title: 'Test', markets: [{ asset: 'BTC', tf: '1D', from, to, split: BTC[Math.round(BTC.length * 0.7)].t }],
    mode: 'thresholds', thresholds: { ...core.DEFAULT_THRESHOLDS, sharpe: 4 },   // inatteignable : la recherche va au bout
    firm: null, oos_min_ratio: 0.5, settings: { capital: 10_000, commissionPct: 0.05, slippageTicks: 1, qtyPct: 100, margin: false },
    max_attempts: 50, max_gemini: 12, rewrite_every: 5, seed: 42, start: { kind: 'code', title: 'Croisement de moyennes', code: SMA, inputs: {} }, goal: 'tendance', ...o,
  };
}

interface Gem { prompts: { task: string; text: string }[]; status: number; script: (task: string, k: number) => Record<string, unknown> }
function gem(over: Partial<Gem> = {}): Gem {
  // Réécritures : les stratégies connues tour à tour ; la troisième est cassée puis réparée.
  return { prompts: [], status: 200, script: (task, k) => task === 'repair' ? { code: KNOWN[1].source, change: 'parenthèse fermée' }
    : k === 2 ? { title: 'Cassé', code: BROKEN, change: 'essai cassé' }
      : { title: KNOWN[k % KNOWN.length].name, code: `${KNOWN[k % KNOWN.length].source}// réécriture ${k}\n`, change: `logique ${k}` }, ...over };
}

function deps(db: Db, g: Gem, clock: { t: number }, env: Record<string, string> = { GEMINI_API_KEY: KEY }): LoopDeps {
  let k = 0;
  return {
    rest: db, env: (n) => env[n], now: () => clock.t, token: () => `tok-${clock.t}`,
    computeBudgetMs: 60,
    fetch: async (url, init) => {
      if (!url.startsWith(core.GEMINI)) throw new Error(`appel inattendu : ${url}`);
      expect((init!.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
      const body = JSON.parse(String(init!.body)) as { systemInstruction: { parts: { text: string }[] }; contents: { parts: { text: string }[] }[] };
      const task = body.systemInstruction.parts[0].text.includes('automated research loop') ? 'evolve' : body.systemInstruction.parts[0].text.startsWith('You fix') ? 'repair' : 'generate';
      g.prompts.push({ task, text: body.contents[0].parts[0].text });
      if (g.status !== 200) return new Response(JSON.stringify({ error: { message: 'quota' } }), { status: g.status });
      const data = g.script(task, task === 'repair' ? 0 : k++);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 } }));
    },
  };
}

function newLoop(db: Db, s: core.LoopSpec, id = 'loop-1') {
  db.rows('bt_loops').push({ id, status: 'running', title: s.title, spec: s as unknown as Row, attempts: 0, gemini_calls: 0, note: null,
    next_run_at: new Date(T0).toISOString(), lease_until: '1970-01-01T00:00:00.000Z', lease_token: null } as Row);
}

/** Passages successifs, comme pg_cron chaque minute, jusqu'à la fin ou `max` passages. */
async function cron(d: LoopDeps, clock: { t: number }, max = 200) {
  const reports = [];
  for (let i = 0; i < max; i++) {
    const r = await runLoop(d);
    reports.push(r);
    const st = (d.rest as Db).rows('bt_loops')[0].status;
    if (st === 'done' || st === 'failed' || st === 'stopped' || st === 'waiting') break;
    clock.t += 60_000;
  }
  return reports;
}

describe('recherche autonome : porte de S4', () => {
  it('50 essais sans surveillance, hybride, rapport reproduit par rejeu', async () => {
    const db = new Db(), g = gem(), clock = { t: T0 };
    newLoop(db, spec());
    const passes = await cron(deps(db, g, clock), clock);
    const loop = db.rows('bt_loops')[0];
    const attempts = db.rows('bt_attempts') as unknown as core.AttemptRow[];
    expect(loop.status).toBe('done');
    expect(attempts.length).toBe(50);
    expect(passes.length).toBeGreaterThan(5);                                   // plusieurs passages : budget de calcul tenu
    expect(attempts.map((a) => a.n)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    // Hybride : départ, puis Gemini aux essais 6, 11, … 46 ; paramètres entre deux.
    expect(attempts.filter((a) => a.kind === 'rewrite').map((a) => a.n)).toEqual([6, 11, 16, 21, 26, 31, 36, 41, 46]);
    expect(attempts.filter((a) => a.kind === 'params').length).toBe(40);
    // Réécriture cassée (3e) : une réparation, l'essai tourne.
    const repaired = attempts.find((a) => a.n === 16)!;
    expect(repaired).toMatchObject({ ok: true, gemini_calls: 2 });
    expect(loop.gemini_calls).toBe(10);
    expect(db.rows('bt_ai_calls').map((r) => r.route)).toEqual([...Array(2).fill('loop-evolve'), 'loop-evolve', 'loop-repair', ...Array(6).fill('loop-evolve')]);
    // Toutes les variantes sont distinctes ; le Sharpe déflaté compte les essais.
    expect(new Set(attempts.map((a) => core.variantOf(a.code!, a.inputs))).size).toBe(50);
    expect(attempts[49].detail![0].is.trials).toBeGreaterThan(40);
    // Hors échantillon : jamais transmis à Gemini, consulté seulement pour un essai qui passe dans l'échantillon.
    for (const p of g.prompts) expect(p.text).not.toMatch(/oos|out-of-sample/i);
    for (const a of attempts) if (!a.is_pass) expect(a.oos_pass).toBeNull();
    // Rapport et rejeu.
    const report = loop.report as unknown as core.LoopReport;
    expect(report).toMatchObject({ status: 'done', attempts: 50, gemini_calls: 10, verdict: 'none', reason: 'budget de 50 essais atteint', seed: 42 });
    const data = spec().markets.map((m) => core.sliceMarket(m, COLS));
    const again = await core.replay(spec(), attempts, data);
    expect(again.differs).toEqual([]);
    expect(again.fingerprint).toBe(report.fingerprint);
  }, 60_000);

  it('même plan, même graine, même Gemini : mêmes essais et même empreinte', async () => {
    const runOnce = async () => {
      const db = new Db(), clock = { t: T0 };
      newLoop(db, spec({ max_attempts: 12 }));
      await cron(deps(db, gem(), clock), clock);
      return (db.rows('bt_loops')[0].report as unknown as core.LoopReport).fingerprint;
    };
    expect(await runOnce()).toBe(await runOnce());
  }, 60_000);
});

describe('budget et attente', () => {
  it('plafond de 50 appels du jour atteint : la recherche attend le lendemain (Paris), sans perdre d’essai', async () => {
    const db = new Db(), g = gem(), clock = { t: T0 };
    for (let i = 0; i < 50; i++) db.rows('bt_ai_calls').push({ id: i, day: core.parisDay(T0), cached: false, route: 'generate' });
    newLoop(db, spec());
    await cron(deps(db, g, clock), clock);
    const loop = db.rows('bt_loops')[0];
    expect(loop.status).toBe('waiting');
    expect(loop.note).toMatch(/plafond de 50 appels/);
    expect(db.rows('bt_attempts').length).toBe(5);                              // départ + 4 variantes, puis la réécriture attend
    expect(g.prompts.length).toBe(0);
    expect(Date.parse(String(loop.next_run_at))).toBe(nextParisDay(clock.t));
    expect(core.parisDay(nextParisDay(clock.t))).toBe('2026-11-25');
    // Le lendemain : la recherche reprend où elle était.
    clock.t = nextParisDay(clock.t);
    await runLoop(deps(db, g, clock));
    expect(db.rows('bt_attempts').length).toBeGreaterThan(5);
    expect(db.rows('bt_attempts')[5].kind).toBe('rewrite');
  }, 60_000);

  it('quota gratuit de Google refusé (429) : attente d’une heure, aucun modèle payant', async () => {
    const db = new Db(), g = gem({ status: 429 }), clock = { t: T0 };
    newLoop(db, spec());
    await cron(deps(db, g, clock), clock);
    const loop = db.rows('bt_loops')[0];
    expect(loop).toMatchObject({ status: 'waiting' });
    expect(loop.note).toMatch(/quota gratuit/);
    expect(db.rows('bt_ai_calls').at(-1)).toMatchObject({ status: 429, model: core.MODEL });
  }, 60_000);

  it('budget Gemini du plan épuisé : la recherche continue sur les paramètres', async () => {
    const db = new Db(), g = gem(), clock = { t: T0 };
    newLoop(db, spec({ max_attempts: 14, max_gemini: 1 }));
    await cron(deps(db, g, clock), clock);
    const a = db.rows('bt_attempts') as unknown as core.AttemptRow[];
    expect(a.length).toBe(14);
    expect(a.filter((x) => x.kind === 'rewrite').length).toBe(1);
    expect(db.rows('bt_loops')[0].gemini_calls).toBe(1);
  }, 60_000);

  it('réécriture identique à un essai précédent : notée, pas réévaluée', async () => {
    const db = new Db(), clock = { t: T0 };
    newLoop(db, spec({ max_attempts: 6 }));
    await cron(deps(db, gem({ script: () => ({ title: 'Même', code: SMA, change: 'rien' }) }), clock), clock);
    const a = db.rows('bt_attempts') as unknown as core.AttemptRow[];
    expect(a[5]).toMatchObject({ kind: 'rewrite', ok: false, error: 'variante identique à l’essai 1 : non réévaluée', sr_bars: null });
  });

  it('sans clé Gemini : la recherche échoue au premier appel, avec la raison', async () => {
    const db = new Db(), clock = { t: T0 };
    newLoop(db, spec({ start: { kind: 'prompt', prompt: 'tendance' } }));
    await cron(deps(db, gem(), clock, {}), clock);
    expect(db.rows('bt_loops')[0]).toMatchObject({ status: 'failed', note: 'GEMINI_API_KEY absente des secrets de Supabase' });
  });
});

describe('fin de recherche', () => {
  it('un essai passe dans et hors échantillon : la recherche s’arrête, gagnant au rapport', async () => {
    const db = new Db(), clock = { t: T0 };
    newLoop(db, spec({ thresholds: { min_trades: 1, sharpe: -10, t_stat: -10, dsr: 0, max_dd_pct: 100, profit_factor: 0 }, oos_min_ratio: -100 }));
    await cron(deps(db, gem(), clock), clock);
    const loop = db.rows('bt_loops')[0];
    const first = (db.rows('bt_attempts') as unknown as core.AttemptRow[]).find((a) => a.is_pass)!;
    if (first.oos_pass) {
      expect(loop).toMatchObject({ status: 'done', verdict: 'passed' });
      expect((loop.report as unknown as core.LoopReport).winner).toBe(first.n);
    } else {
      expect(first.oos_pass).toBe(false);
    }
  });

  it('arrêt demandé : rapport « arrêtée », bail rendu', async () => {
    const db = new Db(), clock = { t: T0 };
    newLoop(db, spec());
    await runLoop(deps(db, gem(), clock));
    db.rows('bt_loops')[0].status = 'stopping';
    clock.t += 60_000;
    await runLoop(deps(db, gem(), clock));
    expect(db.rows('bt_loops')[0]).toMatchObject({ status: 'stopped', lease_token: null, lease_until: '1970-01-01T00:00:00.000Z' });
  });

  it('bail tenu par un autre passage : rien n’est fait', async () => {
    const db = new Db(), clock = { t: T0 };
    newLoop(db, spec());
    db.rows('bt_loops')[0].lease_until = new Date(T0 + 60_000).toISOString();
    expect(await runLoop(deps(db, gem(), clock))).toEqual({ ok: true, idle: true });
    expect(db.rows('bt_attempts').length).toBe(0);
  });

  it('bougies trop courtes : échec avec la raison', async () => {
    const db = new Db(), clock = { t: T0 };
    const s = spec();
    newLoop(db, { ...s, markets: [{ ...s.markets[0], asset: 'ETH' }] });
    await runLoop(deps(db, gem(), clock));
    expect(db.rows('bt_loops')[0]).toMatchObject({ status: 'failed' });
    expect(String(db.rows('bt_loops')[0].note)).toMatch(/ETH 1D : 0 bougies/);
  });
});

describe('paquet généré', () => {
  it('research-core.gen.js à jour de ses sources (sinon : cd web && node scripts/build-research-core.mjs)', () => {
    const head = readFileSync(new URL('./research-core.gen.js', import.meta.url), 'utf8').slice(0, 400);
    const expected = execFileSync(process.execPath, ['--input-type=module', '-e',
      "import('./scripts/build-research-core.mjs').then((m) => process.stdout.write(m.sourcesHash()))"], { cwd: new URL('../../../web/', import.meta.url) }).toString();
    expect(head).toContain(`// sources: ${expected}`);
  });
});
