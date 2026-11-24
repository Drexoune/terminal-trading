// Tâches « macro » et « fx » de p3-jobs (plan P3, étape M1), une fois par jour.
//
// - macro : toutes les séries du catalogue (FRED, BCE, copies DBnomics de l'ONS, de Statistics
//   Japan et de la RBA, Statistics Canada, BNS, BIS mensuel) depuis janvier 2005, réécrites à chaque
//   passage (une valeur révisée remplace la précédente). L'OCDE n'est plus utilisée (T-058).
// - fx : changes contre le dollar (FRED H.10), dernière valeur de chaque mois, pour le backtest.
//
// Rien n'est inventé : une série illisible garde ses observations et porte l'erreur dans
// macro_series.last_error ; l'état du flux va dans p3_state (feed:macro), lu par l'écran.

import type { Json, Rest, Row } from '../p1-jobs/rest.ts';
import { ECONOMIES, FX_SERIES, SERIES, type SeriesSpec } from './catalog.ts';
import { bisMonthly, dbnomicsJson, fredCsv, fredMonthEnd, periodEnd, sdmxCsv, snbCsv, statcanJson, yoy, yoyFromQoq, type Obs } from './parse.ts';

export type HttpFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ status: number; text(): Promise<string> }>;
export interface MacroDeps { fetch: HttpFetch; now: () => number; rest: Rest }

export const START = '2005-01';
export const FRED = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
export const ECB = 'https://data-api.ecb.europa.eu/service/data';
export const BIS = 'https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0';
export const DBNOMICS = 'https://api.db.nomics.world/v22/series';
export const STATCAN = 'https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods';
export const SNB = 'https://data.snb.ch/api/cube';
const UA = 'TERMINAL/1.0 (terminal personnel, lecture seule)';
const TIMEOUT_MS = 30_000;

async function get(deps: MacroDeps, url: string, post?: unknown): Promise<string> {
  const r = await deps.fetch(url, { method: post === undefined ? 'GET' : 'POST', body: post === undefined ? undefined : JSON.stringify(post),
    headers: { 'User-Agent': UA, Accept: 'text/csv, application/json, */*', ...(post === undefined ? {} : { 'Content-Type': 'application/json' }) },
    signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await r.text();
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return body;
}

const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 160);

/** Lignes du catalogue (métadonnées, sans toucher à l'état du dernier relevé). */
export function catalogRows(now: number): Row[] {
  return SERIES.map((s) => ({ id: s.id, economy: s.economy, indicator: s.indicator, source: s.source, code: s.code, freq: s.freq,
    unit: s.unit, url: s.url, updated_ms: now }));
}

/** Mise en forme commune : variation sur un an quand la source publie un indice ou un niveau. */
export function transform(s: SeriesSpec, raw: Obs[]): Obs[] {
  const out = s.transform === 'yoy' ? yoy(raw, s.freq) : s.transform === 'yoy_qoq' ? yoyFromQoq(raw) : raw;
  return out.filter((o) => o.period >= (s.freq === 'Q' ? '2005-Q1' : START));
}

/** Observations brutes d'une série (hors Statistics Canada, relevé en un seul appel). */
export async function fetchSeries(deps: MacroDeps, s: SeriesSpec): Promise<Obs[]> {
  if (s.source === 'fred') return fredCsv(await get(deps, `${FRED}?id=${s.code}`), s.freq).filter((o) => o.period >= shiftStart(s));
  if (s.source === 'ecb') {
    const m = sdmxCsv(await get(deps, `${ECB}/${s.code}?format=csvdata&startPeriod=${s.freq === 'Q' ? '2004-Q1' : '2004-01'}`), ['KEY']);
    return [...m.values()][0] ?? [];
  }
  if (s.source === 'dbnomics') {
    // « A+B » : la première série fait foi sur les périodes communes, la seconde complète les plus récentes.
    const parts = await Promise.all(s.code.split('+').map(async (c) => dbnomicsJson(await get(deps, `${DBNOMICS}/${c}?observations=1`), s.freq)));
    const merged = new Map<string, number>();
    for (const part of [...parts].reverse()) for (const o of part) merged.set(o.period, o.value);
    return [...merged.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([period, value]) => ({ period, value }))
      .filter((o) => o.period >= shiftStart(s));
  }
  if (s.source === 'snb') {
    const [cube, ...dims] = s.code.split('|');
    return snbCsv(await get(deps, `${SNB}/${cube}/data/csv/en`), dims, s.freq).filter((o) => o.period >= shiftStart(s));
  }
  throw new Error(`source relevée à part : ${s.source}`);
}

/** Un an de plus pour calculer la variation sur un an dès janvier 2005. */
const shiftStart = (s: SeriesSpec) => (s.transform === 'level' ? (s.freq === 'Q' ? '2005-Q1' : START) : (s.freq === 'Q' ? '2004-Q1' : '2004-01'));

function obsRows(id: string, obs: Obs[], recv: string): Row[] {
  return obs.map((o) => ({ series_id: id, period: o.period, period_end: periodEnd(o.period), value: o.value, ts_recv: recv }));
}

async function save(rest: Rest, rows: Row[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 1000) await rest.upsert('macro_observations', rows.slice(i, i + 1000), 'series_id,period');
}

export async function runMacro(deps: MacroDeps): Promise<Record<string, unknown>> {
  const { rest } = deps;
  const now = deps.now();
  const recv = new Date(now).toISOString();
  await rest.upsert('macro_series', catalogRows(now), 'id');
  const done: Record<string, string> = {};
  const problems: string[] = [];
  const status: Row[] = [];
  const mark = (id: string, ok: boolean, last: string | null, error: string | null) =>
    status.push({ id, ...(ok ? { last_ok_ms: now } : {}), ...(last ? { last_period: last } : {}), last_error: error });

  const record = async (s: SeriesSpec, raw: Obs[]) => {
    const obs = transform(s, raw);
    if (!obs.length) throw new Error('aucune observation chiffrée');
    await save(rest, obsRows(s.id, obs, recv));
    done[s.id] = obs[obs.length - 1].period;
    mark(s.id, true, obs[obs.length - 1].period, null);
  };
  for (const s of SERIES.filter((x) => ['fred', 'ecb', 'dbnomics', 'snb'].includes(x.source))) {
    try { await record(s, await fetchSeries(deps, s)); } catch (e) { problems.push(`${s.id} : ${errText(e)}`); mark(s.id, false, null, errText(e)); }
  }
  // Statistics Canada : un appel pour tous les vecteurs (25 ans de mois ou de trimestres).
  const ca = SERIES.filter((x) => x.source === 'statcan');
  try {
    const m = statcanJson(await get(deps, STATCAN, ca.map((s) => ({ vectorId: Number(s.code), latestN: s.freq === 'M' ? 300 : 100 }))),
      Object.fromEntries(ca.map((s) => [s.code, s.freq])));
    for (const s of ca) {
      try { await record(s, m.get(s.code) ?? []); } catch (e) { problems.push(`${s.id} : ${errText(e)}`); mark(s.id, false, null, errText(e)); }
    }
  } catch (e) { problems.push(`Statistics Canada : ${errText(e)}`); for (const s of ca) mark(s.id, false, null, errText(e)); }
  // BIS : une requête pour les 8 banques.
  try {
    const areas = SERIES.filter((x) => x.source === 'bis');
    const m = bisMonthly(await get(deps, `${BIS}/M.${areas.map((s) => s.code).join('+')}?startPeriod=${START}&format=csv`));
    for (const s of areas) {
      const obs = m.get(s.code) ?? [];
      if (!obs.length) { problems.push(`${s.id} : aucune observation`); mark(s.id, false, null, 'aucune observation'); continue; }
      await save(rest, obsRows(s.id, obs, recv));
      done[s.id] = obs[obs.length - 1].period;
      mark(s.id, true, obs[obs.length - 1].period, null);
    }
  } catch (e) { problems.push(`BIS : ${errText(e)}`); for (const s of SERIES.filter((x) => x.source === 'bis')) mark(s.id, false, null, errText(e)); }
  for (const row of status) await rest.update('macro_series', { id: `eq.${row.id}` }, row);
  await rest.upsert('p3_state', [{ key: 'feed:macro', updated_ms: now, value: {
    name: 'macro', label: 'Macro (instituts, BCE, FRED, BIS)', late_after_ms: 30 * 3_600_000, stale_after_ms: 54 * 3_600_000,
    status: problems.length && !Object.keys(done).length ? 'reconnecting' : 'connected', connected_since_ms: null,
    last_message_ms: Object.keys(done).length ? now : null, reconnects: 0, outages: [], last_error: problems.join(' ; ').slice(0, 500) || null,
  } as unknown as Json }], 'key');
  return { job: 'macro', ok: problems.length === 0, series: Object.keys(done).length, done, problems };
}

export async function runFx(deps: MacroDeps): Promise<Record<string, unknown>> {
  const { rest } = deps;
  const now = deps.now();
  const recv = new Date(now).toISOString();
  const problems: string[] = [];
  const done: Record<string, string> = {};
  await rest.upsert('macro_series', Object.entries(FX_SERIES).map(([e, f]) => ({ id: `FX:${e}`, economy: e, indicator: 'fx', source: 'fred',
    code: f.code, freq: 'M', unit: 'USD', url: `https://fred.stlouisfed.org/series/${f.code}`, updated_ms: now })), 'id');
  for (const [e, f] of Object.entries(FX_SERIES)) {
    try {
      const obs = fredMonthEnd(await get(deps, `${FRED}?id=${f.code}`)).filter((o) => o.period >= START)
        .map((o) => ({ period: o.period, value: f.invert ? Math.round((1 / o.value) * 1e8) / 1e8 : o.value }));
      if (!obs.length) throw new Error('aucune observation chiffrée');
      await save(rest, obsRows(`FX:${e}`, obs, recv));
      done[e] = obs[obs.length - 1].period;
      await rest.update('macro_series', { id: `eq.FX:${e}` }, { last_ok_ms: now, last_period: obs[obs.length - 1].period, last_error: null });
    } catch (err) {
      problems.push(`FX:${e} : ${errText(err)}`);
      await rest.update('macro_series', { id: `eq.FX:${e}` }, { last_error: errText(err) });
    }
  }
  return { job: 'fx', ok: problems.length === 0, done, problems, economies: ECONOMIES.length - 1 };
}
