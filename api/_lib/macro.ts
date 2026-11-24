// /api/macro/* — P3 (macro et heatmap), lecture de l'état publié par l'Edge Function p3-jobs
// (p3_state, macro_observations) avec la clé secrète, côté serveur. Données publiques seulement.
//
//   GET /api/macro/state                          scores, matrice, fiches des 8 économies, backtest,
//                                                 flux ; taux et prochaine réunion de l'écran Taux (P2)
//   GET /api/macro/series?economy=&indicator=&years=   historique d'une série (5, 10 ou 20 ans)
//   GET /api/macro/probe                          sonde de l'OCDE (M0, T-057 ; l'OCDE refuse Vercel
//                                                 aussi, T-058), en-tête x-jobs-secret exigé

import { HttpError, json, NO_STORE, readQuery, respond, type Env } from './http.js';
import type { FetchFn } from './okx.js';
import type { Context } from './routes.js';
import { rest, supabaseConfig, type SupabaseConfig } from './supabase.js';

export const ECONOMIES = ['US', 'EA', 'GB', 'JP', 'CH', 'CA', 'AU', 'NZ'] as const;
export const INDICATORS = ['policy', 'cpi', 'cpi_core', 'gdp', 'unemployment', 'confidence', 'retail'] as const;
export const YEARS = [5, 10, 20] as const;
/** Banque centrale de chaque économie (codes de l'écran Taux). */
const BANK: Record<string, string> = { US: 'FED', EA: 'BCE', GB: 'BOE', JP: 'BOJ', CH: 'BNS', CA: 'BOC', AU: 'RBA', NZ: 'RBNZ' };

interface StateRow { key: string; value: unknown; updated_ms: number }

export async function macroState(cfg: SupabaseConfig, fetchFn: FetchFn, now: number) {
  const q = (table: string, params: Record<string, string>) => rest(cfg, fetchFn, 'GET', table, params, false).then((r) => r.rows);
  const [p3, p2, series] = await Promise.all([
    q('p3_state', { select: 'key,value,updated_ms', key: 'in.("scores","sheets","backtest","feed:macro")' }),
    q('p2_state', { select: 'value,updated_ms', key: 'eq.rates:state', limit: '1' }),
    q('macro_series', { select: 'id,source,last_period,last_ok_ms,last_error', order: 'id.asc', limit: '200' }),
  ]);
  const by = new Map((p3 as StateRow[]).map((r) => [r.key, r]));
  // Taux et prochaine réunion de l'écran Taux (P2), en lecture seule.
  const banks = ((p2[0] as { value?: { banks?: Record<string, { policy?: unknown; next?: { date?: string; days?: number } | null; name?: string; tz?: string }> } } | undefined)
    ?.value?.banks) ?? {};
  const rates = Object.fromEntries(ECONOMIES.map((e) => {
    const b = banks[BANK[e]];
    return [e, b ? { bank: BANK[e], name: b.name ?? null, tz: b.tz ?? null, policy: b.policy ?? null, next: b.next ? { date: b.next.date ?? null } : null } : null];
  }));
  return {
    configured: true,
    scores: by.get('scores')?.value ?? null, sheets: by.get('sheets')?.value ?? null, backtest: by.get('backtest')?.value ?? null,
    feed: by.get('feed:macro')?.value ?? null, series, rates, computed_ms: now,
  };
}

export async function macroSeries(cfg: SupabaseConfig, fetchFn: FetchFn, now: number, economy: string, indicator: string, years: number) {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - years);   // même jour, n années plus tôt
  const since = d.toISOString().slice(0, 10);
  const { rows } = await rest(cfg, fetchFn, 'GET', 'macro_observations',
    { select: 'period,value', series_id: `eq.${economy}:${indicator}`, period_end: `gte.${since}`, order: 'period.asc', limit: '1000' }, false);
  return { economy, indicator, years, points: (rows as { period: string; value: number | string }[]).map((r) => ({ period: r.period, value: Number(r.value) })),
    computed_ms: now };
}

export const OECD = 'https://sdmx.oecd.org/public/rest/data';
const AREAS = 'USA+GBR+JPN+CHE+CAN+AUS+NZL';
const UA = 'TERMINAL/1.0 (terminal personnel, lecture seule)';
const MIN_SECRET = 32;
const TIMEOUT_MS = 20_000;

export const PROBES: { label: string; url: string }[] = [
  { label: 'oecd-cpi-2018', url: `${OECD}/OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0/${AREAS}.M+Q.N.CPI.._T..GY?startPeriod=2026-04&dimensionAtObservation=AllDimensions&format=csvfilewithlabels` },
  { label: 'oecd-unemployment', url: `${OECD}/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/${AREAS}.UNE_LF_M...Y._T.Y_GE15..?startPeriod=2026-04&dimensionAtObservation=AllDimensions&format=csvfilewithlabels` },
];

/** Comparaison à temps constant : empreintes SHA-256 des deux valeurs, comparées octet par octet. */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Une ligne CSV (RFC 4180) : champs entre guillemets, virgules et guillemets doublés compris. */
export function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Nombre de séries et dernière période par zone d'un CSV SDMX. */
export function lastByArea(body: string): Record<string, string> {
  const [head, ...rows] = body.trim().split(/\r?\n/);
  const cols = csvFields(head ?? '');
  const ia = cols.indexOf('REF_AREA'), it = cols.indexOf('TIME_PERIOD'), iv = cols.indexOf('OBS_VALUE');
  const out: Record<string, string> = {};
  if (ia < 0 || it < 0 || iv < 0) return out;
  for (const line of rows) {
    const f = csvFields(line);
    if (f[iv] && (!out[f[ia]] || f[it] > out[f[ia]])) out[f[ia]] = f[it];
  }
  return out;
}

export async function probeOecd(fetchFn: FetchFn, now: () => number) {
  const lines = [];
  for (const p of PROBES) {
    const t0 = now();
    try {
      const r = await fetchFn(p.url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = await r.text();
      lines.push({ label: p.label, status: r.status, ms: now() - t0, size: body.length,
        cache: r.headers.get('cf-cache-status'), age: r.headers.get('age'),
        last: r.status === 200 ? lastByArea(body) : body.slice(0, 80) });
    } catch (e) {
      lines.push({ label: p.label, status: null, ms: now() - t0, error: `${(e as Error).name} : ${(e as Error).message}`.slice(0, 160) });
    }
  }
  return { ok: lines.every((l) => l.status === 200), region: (globalThis as { process?: { env?: Env } }).process?.env?.VERCEL_REGION ?? null, lines };
}

export function handleMacro(request: Request, ctx: Context): Promise<Response> {
  return respond(ctx.env, '/api/macro', async () => {
    if (request.method !== 'GET') throw new HttpError(405, 'méthode non autorisée : GET attendu');
    const q = readQuery(request, ['path', 'economy', 'indicator', 'years']);
    const path = q.get('path') ?? '';
    const now = ctx.deps.now();
    if (path === 'probe') {
      const secret = ctx.env.P1_JOBS_SECRET?.trim() ?? '';
      if (secret.length < MIN_SECRET) throw new HttpError(503, 'P1_JOBS_SECRET absente des variables de Vercel');
      if (!(await sameSecret(request.headers.get('x-jobs-secret') ?? '', secret))) throw new HttpError(401, 'secret d’appel invalide');
      return json(await probeOecd(ctx.deps.fetch, ctx.deps.now), NO_STORE);
    }
    const cfg = supabaseConfig(ctx.env);
    if (path === 'state') {
      if (q.has('economy') || q.has('indicator') || q.has('years')) throw new HttpError(400, 'cette route ne prend aucun paramètre');
      if (!cfg.ok) return json({ configured: false, reason: cfg.reason, scores: null, sheets: null, backtest: null, feed: null, series: [], rates: {}, computed_ms: now }, NO_STORE);
      return json(await macroState(cfg.config, ctx.deps.fetch, now), NO_STORE);
    }
    if (path === 'series') {
      const economy = q.get('economy') ?? '', indicator = q.get('indicator') ?? '';
      const years = Number(q.get('years') ?? 10);
      if (!(ECONOMIES as readonly string[]).includes(economy)) throw new HttpError(400, `economy attendu parmi ${ECONOMIES.join(', ')}`);
      if (!(INDICATORS as readonly string[]).includes(indicator)) throw new HttpError(400, `indicator attendu parmi ${INDICATORS.join(', ')}`);
      if (!(YEARS as readonly number[]).includes(years)) throw new HttpError(400, 'years : 5, 10 ou 20');
      if (!cfg.ok) throw new HttpError(503, `écran macro non configuré : ${cfg.reason}`);
      return json(await macroSeries(cfg.config, ctx.deps.fetch, now, economy, indicator, years), NO_STORE);
    }
    throw new HttpError(404, 'route inconnue (attendues : /api/macro/state, /api/macro/series?economy=&indicator=&years=)');
  });
}
