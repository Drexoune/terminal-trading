// Tâches « scores » et « backtest » de p3-jobs (plan P3, étapes M2 et M3).
//
// - scores (chaque jour après macro, puis toutes les 10 min) : matrice, scores et biais du jour,
//   écrits dans p3_state (« scores ») ; lus par /api/macro/state.
// - backtest (chaque mois, et à la demande) : porte de P3, écrit dans p3_state (« backtest »).

import type { Json, Rest } from '../p1-jobs/rest.ts';
import { ECONOMIES, INDICATORS, SERIES, type Economy, type Indicator } from './catalog.ts';
import { runBacktest, type Fx } from './backtest.ts';
import { shiftPeriod, type Obs } from './parse.ts';
import { scoreAt, type Panel } from './score.ts';

export interface JobDeps { now: () => number; rest: Rest }

const BACKTEST_FROM = '2008-01';   // 3 ans d'historique pour la moyenne de croissance

/** Historique de toutes les séries du catalogue et des changes, depuis la base. */
export async function loadPanel(rest: Rest): Promise<{ panel: Panel; fx: Fx; counts: Record<string, number> }> {
  const panel: Panel = {};
  const fx: Fx = {};
  const counts: Record<string, number> = {};
  const read = (id: string) => rest.select<{ period: string; value: number | string }>('macro_observations',
    { select: 'period,value', series_id: `eq.${id}`, order: 'period.asc', limit: '1000' });
  for (const s of SERIES) {
    const obs: Obs[] = (await read(s.id)).map((r) => ({ period: r.period, value: Number(r.value) }));
    counts[s.id] = obs.length;
    if (obs.length) ((panel[s.economy] ??= {}) as Partial<Record<Indicator, { freq: 'M' | 'Q'; obs: Obs[] }>>)[s.indicator] = { freq: s.freq, obs };
  }
  for (const e of ECONOMIES.filter((x) => x !== 'US')) {
    const obs = (await read(`FX:${e}`)).map((r) => ({ period: r.period, value: Number(r.value) }));
    counts[`FX:${e}`] = obs.length;
    if (obs.length) fx[e as Exclude<Economy, 'US'>] = obs;
  }
  return { panel, fx, counts };
}

const civil = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function runScores(deps: JobDeps): Promise<Record<string, unknown>> {
  const now = deps.now();
  const { panel, counts } = await loadPanel(deps.rest);
  const s = scoreAt(panel, civil(now));
  const empty = INDICATORS.filter((i) => ECONOMIES.every((e) => !counts[`${e}:${i}`]));
  await deps.rest.upsert('p3_state', [{ key: 'scores', updated_ms: now, value: { ...s, computed_ms: now, counts } as unknown as Json }], 'key');
  return { job: 'scores', ok: true, date: s.date, themes: s.themes, excluded: s.excluded, empty_indicators: empty };
}

export async function runBacktestJob(deps: JobDeps): Promise<Record<string, unknown>> {
  const now = deps.now();
  const { panel, fx } = await loadPanel(deps.rest);
  // Dernier mois dont le rendement à 3 mois est connu.
  const lastFx = Math.min(...Object.values(fx).map((o) => (o?.length ? Date.parse(`${o[o.length - 1].period}-01`) : 0)));
  const to = lastFx ? shiftPeriod(new Date(lastFx).toISOString().slice(0, 7), -3) : BACKTEST_FROM;
  const r = runBacktest(panel, fx, BACKTEST_FROM, to);
  await deps.rest.upsert('p3_state', [{ key: 'backtest', updated_ms: now, value: { ...r, computed_ms: now } as unknown as Json }], 'key');
  return { job: 'backtest', ok: true, months: r.months, proven: r.proven, verdict: r.verdict };
}
