// Tâche « loop » de bt-jobs (section Backtest, S4, T-064) : fait avancer la recherche autonome en
// arrière-plan, navigateur fermé. Appelée chaque minute par pg_cron (supabase/cron-bt.sql) quand
// une recherche attend son tour ; chaque passage prend une recherche, la verrouille (bail de
// 150 s), fait autant d'essais que son budget de calcul le permet, puis rend la main.
//
// Hybride (T-064) : Gemini réécrit la logique tous les `rewrite_every` essais (et répare un script
// qui ne tourne pas) ; entre deux, la boucle fait varier les paramètres du meilleur essai, sans IA.
// Offre gratuite seulement (T-063) : chaque appel est compté dans bt_ai_calls, sous le plafond de
// 50 par jour de Paris partagé avec l'assistant ; plafond atteint : la recherche attend le
// lendemain. Le hors échantillon n'est consulté que pour un essai qui passe dans l'échantillon, et
// jamais transmis à Gemini.

import * as core from './research-core.gen.js';
import type { Json, Rest, Row } from '../p1-jobs/rest.ts';
import type { AttemptRow, LoopSpec, MarketData } from './research-core.gen.js';

export interface LoopDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  now: () => number; rest: Rest; env: (n: string) => string | undefined;
  wallBudgetMs?: number;      // durée d'un passage (sous la limite de 150 s des Edge Functions)
  computeBudgetMs?: number;   // temps de calcul du moteur par passage (limite de CPU des Edge Functions)
  token?: () => string;
}

export const LEASE_MS = 150_000;
export const WALL_BUDGET_MS = 90_000;
export const COMPUTE_BUDGET_MS = 900;
export const MAX_REPAIRS = 2;
const EPOCH = '1970-01-01T00:00:00.000Z';
const ACTIVE = 'in.(running,waiting,stopping)';

interface LoopRow { id: string; status: string; spec: LoopSpec; attempts: number; gemini_calls: number; note: string | null }

const iso = (ms: number) => new Date(ms).toISOString();

/** Premier instant (à l'heure pleine) d'un autre jour de Paris : reprise après le plafond quotidien. */
export function nextParisDay(now: number): number {
  const day = core.parisDay(now);
  let t = Math.ceil(now / 3_600_000) * 3_600_000;
  while (core.parisDay(t) === day) t += 3_600_000;
  return t + 5 * 60_000;
}

const toRow = (a: AttemptRow): Row => a as unknown as Row;

export async function runLoop(d: LoopDeps): Promise<Record<string, Json>> {
  const { rest } = d;
  const now = d.now();
  const due = await rest.select<LoopRow>('bt_loops', { select: 'id,status,spec,attempts,gemini_calls,note', status: ACTIVE,
    next_run_at: `lte.${iso(now)}`, lease_until: `lt.${iso(now)}`, order: 'next_run_at.asc', limit: '1' });
  if (!due.length) return { ok: true, idle: true };
  const loop = due[0];
  // Bail : un seul passage à la fois sur une recherche.
  const token = (d.token ?? (() => crypto.randomUUID()))();
  await rest.update('bt_loops', { id: `eq.${loop.id}`, lease_until: `lt.${iso(now)}` }, { lease_until: iso(now + LEASE_MS), lease_token: token });
  const mine = await rest.select('bt_loops', { select: 'id', id: `eq.${loop.id}`, lease_token: `eq.${token}` });
  if (!mine.length) return { ok: true, busy: loop.id };

  const spec = loop.spec;
  const attempts = await rest.select<AttemptRow>('bt_attempts', {
    select: 'n,kind,parent,title,code,inputs,change,gemini_calls,ok,error,score,is_pass,oos_pass,detail,sr_bars,ms', loop_id: `eq.${loop.id}`, order: 'n.asc' });
  let gemini = loop.gemini_calls;
  const release = async (patch: Row) => {
    await rest.update('bt_loops', { id: `eq.${loop.id}` }, { ...patch, lease_until: EPOCH, lease_token: null, updated_at: iso(d.now()) });
  };
  const finish = async (status: 'done' | 'stopped' | 'failed', reason: string) => {
    const report = core.buildReport(spec, attempts, status, reason, gemini);
    await release({ status, note: reason, verdict: report.verdict, report: report as unknown as Json, finished_at: iso(d.now()), gemini_calls: gemini, attempts: attempts.length });
    return { ok: true, loop: loop.id, status, reason, attempts: attempts.length, verdict: report.verdict, fingerprint: report.fingerprint };
  };

  if (loop.status === 'stopping') return finish('stopped', 'recherche arrêtée depuis l’écran');

  // Bougies : bornes fixées à la création, pour qu'un rejeu voie les mêmes barres.
  let data: MarketData[];
  try {
    data = [];
    for (const m of spec.markets) {
      const rows = await rest.rpc<core.Cols[]>('bt_candles_cols', { p_asset: m.asset, p_tf: m.tf, p_from: iso(m.from) });
      const md = core.sliceMarket(m, rows[0] ?? { t: null, o: null, h: null, l: null, c: null });
      if (md.candles.length < 100 || md.splitBar < 50 || md.candles.length - md.splitBar < 20) throw new Error(`${m.asset} ${m.tf} : ${md.candles.length} bougies, trop peu pour couper l’échantillon`);
      data.push(md);
    }
  } catch (e) {
    return finish('failed', `bougies : ${(e as Error).message}`.slice(0, 300));
  }

  const key = d.env('GEMINI_API_KEY')?.trim() ?? '';
  const prior: (number | null)[][] = data.map((_, i) => attempts.filter((a) => a.ok && a.sr_bars).map((a) => a.sr_bars![i] ?? null));
  const seen = new Set(attempts.filter((a) => a.code).map((a) => core.variantOf(a.code!, a.inputs)));
  const paramsCache = new Map<number, boolean>();
  const hasParams = (a: AttemptRow) => {
    if (!paramsCache.has(a.n)) paramsCache.set(a.n, core.hasNumericInputs(a.code));
    return paramsCache.get(a.n)!;
  };

  /** Un appel à Gemini, compté et journalisé ; null + motif d'attente si le quota ne le permet pas. */
  async function gem(task: 'generate' | 'repair' | 'evolve', text: string): Promise<{ data: Record<string, unknown> } | { wait: string; until: number } | { error: string }> {
    if (!key) return { error: 'GEMINI_API_KEY absente des secrets de Supabase' };
    const t = d.now();
    const day = core.parisDay(t);
    const used = (await rest.select('bt_ai_calls', { select: 'id', day: `eq.${day}`, cached: 'eq.false' })).length;
    if (used >= core.DAILY_CALLS) return { wait: `plafond de ${core.DAILY_CALLS} appels à Gemini atteint le ${day} : reprise demain (T-063)`, until: nextParisDay(t) };
    try {
      const r = await core.callGemini(d.fetch, key, task, text);
      await rest.insert('bt_ai_calls', [{ day, route: `loop-${task}`, model: core.MODEL, status: 200, input_tokens: r.input_tokens, output_tokens: r.output_tokens }]);
      gemini++;
      return { data: r.data };
    } catch (e) {
      const g = e as { status?: number; message?: string };
      await rest.insert('bt_ai_calls', [{ day, route: `loop-${task}`, model: core.MODEL, status: g.status ?? 0, error: String(g.message).slice(0, 300) }]);
      if (g.status === 429) return { wait: 'quota gratuit de Google atteint : nouvel essai dans une heure (offre gratuite seulement)', until: t + 3_600_000 };
      if (g.status === 500 || g.status === 503 || g.status === 0) return { wait: `Gemini indisponible (${g.status}) : nouvel essai dans 5 min`, until: t + 300_000 };
      return { error: `Gemini : ${g.message ?? 'erreur'}`.slice(0, 300) };
    }
  }

  if (loop.status === 'waiting') await rest.update('bt_loops', { id: `eq.${loop.id}` }, { status: 'running', note: null });

  /** Variante voisine inédite du meilleur essai, ou null quand son voisinage est épuisé. */
  const neighbour = (p: AttemptRow, n: number): Record<string, unknown> | null => {
    const meta = core.scriptInputs(p.code!);
    const rnd = core.attemptRng(spec.seed, n);
    for (let k = 0; k < 25; k++) {
      const cand = core.mutateInputs(Array.isArray(meta) ? meta : [], p.inputs, rnd);
      if (!seen.has(core.variantOf(p.code!, cand))) return cand;
    }
    return null;
  };

  const t0 = d.now();
  let compute = 0;
  const wall = d.wallBudgetMs ?? WALL_BUDGET_MS, cpu = d.computeBudgetMs ?? COMPUTE_BUDGET_MS;
  while (d.now() - t0 < wall && compute < cpu) {
    if (attempts.length > loop.attempts) {
      const st = await rest.select<{ status: string }>('bt_loops', { select: 'status', id: `eq.${loop.id}` });
      if (st[0]?.status === 'stopping') return finish('stopped', 'recherche arrêtée depuis l’écran');
    }
    let act = core.nextAction(spec, attempts, gemini, hasParams);
    const n = attempts.length + 1;
    let inputs: Record<string, unknown> = {};
    if (act.kind === 'params') {
      const p = attempts.find((a) => a.n === (act as { parent: number }).parent)!;
      const cand = neighbour(p, n);
      if (cand) inputs = cand;
      else if (gemini < spec.max_gemini) act = { kind: 'rewrite', parent: p.n };
      else act = { kind: 'finish', reason: 'voisinage des paramètres épuisé et budget Gemini épuisé' };
    }
    if (act.kind === 'finish') return finish('done', act.reason);
    const g0 = gemini;
    let title: string | null = null, code: string | null = null, change: string | null = null;
    let parent: number | null = null;

    if (act.kind === 'start' && spec.start.kind === 'code') {
      ({ title, code } = spec.start); inputs = spec.start.inputs ?? {};
    } else if (act.kind === 'params') {
      const p = attempts.find((a) => a.n === (act as { parent: number }).parent)!;
      parent = p.n; title = p.title; code = p.code;
      change = Object.entries(inputs).filter(([k, v]) => p.inputs[k] !== v).map(([k, v]) => `${k} = ${v}`).join(', ') || null;
    } else {
      // generate (départ en texte) ou rewrite (Gemini réécrit le meilleur essai).
      const parentRow = act.kind === 'rewrite' ? attempts.find((a) => a.n === (act as { parent: number }).parent)! : null;
      const text = parentRow ? core.evolvePrompt(spec, parentRow, attempts)
        : `Market: ${spec.markets.map((m) => `${m.asset} ${m.tf}`).join(', ')}.\n\nRequest: ${spec.start.kind === 'prompt' ? spec.start.prompt : ''}`;
      const r = await gem(parentRow ? 'evolve' : 'generate', text);
      if ('wait' in r) { await release({ status: 'waiting', note: r.wait, next_run_at: iso(r.until), gemini_calls: gemini }); return { ok: true, loop: loop.id, waiting: r.wait }; }
      if ('error' in r) return finish('failed', r.error);
      parent = parentRow?.n ?? null;
      title = typeof r.data.title === 'string' ? r.data.title.slice(0, 120) : null;
      code = typeof r.data.code === 'string' ? r.data.code : null;
      change = typeof r.data.change === 'string' ? r.data.change.slice(0, 300) : typeof r.data.summary === 'string' ? r.data.summary.slice(0, 300) : null;
    }

    // Évaluation, avec réparation par Gemini (MAX_REPAIRS au plus) d'un script qui ne tourne pas.
    let ev: core.Evaluation | null = null;
    let repairs = 0;
    for (;;) {
      if (!code || !/strategy\s*\(/.test(code)) { ev = { ok: false, ms: 0, error: 'réponse sans script strategy()', line: null }; break; }
      const twin = act.kind !== 'params' ? attempts.find((a) => a.code && core.variantOf(a.code, a.inputs) === core.variantOf(code!, inputs)) : undefined;
      if (twin) { ev = { ok: false, ms: 0, error: `variante identique à l’essai ${twin.n} : non réévaluée`, line: null }; break; }
      ev = await core.evaluate(code, inputs, data, spec, prior);
      compute += ev.ms;
      if (ev.ok || act.kind === 'params' || act.kind === 'start' || repairs >= MAX_REPAIRS || gemini >= spec.max_gemini) break;
      const r = await gem('repair', `Market: ${spec.markets.map((m) => `${m.asset} ${m.tf}`).join(', ')}.\n\nError${ev.line ? ` at line ${ev.line}` : ''}: ${ev.error}\n\nScript:\n${code}`);
      if (!('data' in r)) break;
      repairs++;
      code = typeof r.data.code === 'string' ? r.data.code : code;
    }
    const row: AttemptRow = ev.ok
      ? { n, kind: act.kind as AttemptRow['kind'], parent, title, code, inputs, change, gemini_calls: gemini - g0, ok: true, error: null,
        score: ev.score, is_pass: ev.is_pass, oos_pass: ev.is_pass ? ev.oos_pass : null, detail: ev.per, sr_bars: ev.sr_bars, ms: ev.ms }
      : { n, kind: act.kind as AttemptRow['kind'], parent, title, code, inputs, change, gemini_calls: gemini - g0, ok: false, error: ev.error,
        score: null, is_pass: false, oos_pass: null, detail: null, sr_bars: null, ms: ev.ms };
    attempts.push(row);
    if (code) seen.add(core.variantOf(code, inputs));
    if (ev.ok) ev.sr_bars.forEach((s, i) => prior[i].push(s));
    await rest.insert('bt_attempts', [{ loop_id: loop.id, ...toRow(row), oos_reasons: ev.ok && ev.is_pass ? ev.oos_reasons : null }]);
    const best = core.bestAttempt(attempts);
    await rest.update('bt_loops', { id: `eq.${loop.id}` }, { attempts: attempts.length, gemini_calls: gemini, best_score: best?.score ?? null, best_n: best?.n ?? null,
      updated_at: iso(d.now()) });
    if (row.is_pass && row.oos_pass) return finish('done', `l’essai ${n} passe dans l’échantillon et hors échantillon`);
    if (spec.start.kind === 'code' && n === 1 && !row.ok) return finish('failed', `la stratégie de départ ne s’exécute pas : ${row.error}`);
  }
  await release({ next_run_at: iso(d.now()) });
  return { ok: true, loop: loop.id, attempts: attempts.length, gemini_calls: gemini, compute_ms: compute };
}
