// Étape M0 du plan P3 (macro et heatmap) : sonde des sources DEPUIS Supabase, c'est-à-dire depuis
// les adresses IP qui feront la collecte. Rien n'est écrit en base. Une requête par source, sur
// une fenêtre courte (statut, délai, taille, dernière période lue) :
//   - OCDE (API SDMX directe) : IPC COICOP 2018 et chômage mensuel ;
//   - BCE : IPCH de la zone euro (jeu « HICP » depuis 2026) ;
//   - FRED : IPC américain ;
//   - BIS : taux directeurs mensuels ;
//   - DBnomics : copie de l'OCDE, pour dater son retard (indexée le 16/06/2026 au relevé du Mac).
// Module pur : réseau et horloges injectés, testé par Vitest.

export interface HeadersLike { get(name: string): string | null }
export interface ProbeResponse { status: number; headers: HeadersLike; text(): Promise<string> }
export type ProbeFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<ProbeResponse>;

export interface ExploreDeps {
  fetch: ProbeFetch;
  now: () => number;
  perf: () => number;
  sleep: (ms: number) => Promise<void>;
  env: (name: string) => string | undefined;
}

export const OECD = 'https://sdmx.oecd.org/public/rest/data';
export const ECB = 'https://data-api.ecb.europa.eu/service/data';
export const FRED = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
export const BIS = 'https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0';
export const DBNOMICS = 'https://api.db.nomics.world/v22/series';
export const UA = 'TERMINAL/0.1 (terminal personnel, lecture seule)';
const AREAS = 'USA+EA20+GBR+JPN+CHE+CAN+AUS+NZL';
const TIMEOUT_MS = 20_000;
const KEPT = ['date', 'content-type', 'cache-control', 'age', 'server', 'cf-cache-status', 'cf-ray', 'retry-after',
  'x-ratelimit-limit', 'x-ratelimit-remaining'];

export interface ProbeLine {
  label: string; url: string; status: number | null; ms_total: number | null; size: number | null;
  headers: Record<string, string>; extract: unknown; error?: string;
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

/** Dernière période par zone d'un CSV SDMX (colonnes REF_AREA, TIME_PERIOD, OBS_VALUE). */
export function lastByArea(body: string, areaCol = 'REF_AREA'): Record<string, string> {
  const [head, ...rows] = body.trim().split(/\r?\n/);
  const cols = csvFields(head);
  const ia = cols.indexOf(areaCol), it = cols.indexOf('TIME_PERIOD'), iv = cols.indexOf('OBS_VALUE');
  const out: Record<string, string> = {};
  if (ia < 0 || it < 0 || iv < 0) return out;
  for (const line of rows) {
    const f = csvFields(line);
    if (!f[iv]) continue;
    if (!out[f[ia]] || f[it] > out[f[ia]]) out[f[ia]] = f[it];
  }
  return out;
}

/** Dernière observation d'un CSV de FRED. */
export function fredLast(body: string): string | null {
  const rows = body.trim().split(/\r?\n/).slice(1).map((l) => l.split(',')).filter((r) => r.length === 2 && r[1] !== '' && r[1] !== '.');
  return rows.length ? rows[rows.length - 1][0] : null;
}

/** Dernière période d'une série DBnomics (observations=1). */
export function dbnomicsLast(body: string): { period: string | null; indexed_at: string | null } {
  const d = JSON.parse(body) as { series?: { docs?: { period?: string[]; indexed_at?: string }[] } };
  const s = d.series?.docs?.[0];
  return { period: s?.period?.at(-1) ?? null, indexed_at: s?.indexed_at ?? null };
}

async function probe(deps: ExploreDeps, label: string, url: string, read: (body: string) => unknown, accept = '*/*', post?: unknown): Promise<ProbeLine> {
  const t0 = deps.perf();
  try {
    const r = await deps.fetch(url, { method: post === undefined ? 'GET' : 'POST', body: post === undefined ? undefined : JSON.stringify(post),
      headers: { 'User-Agent': UA, Accept: accept, ...(post === undefined ? {} : { 'Content-Type': 'application/json' }) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await r.text();
    const headers: Record<string, string> = {};
    for (const k of KEPT) { const v = r.headers.get(k); if (v !== null) headers[k] = v.slice(0, 120); }
    let extract: unknown = null;
    if (r.status === 200) {
      try { extract = read(body); } catch (e) { extract = { error: `lecture : ${(e as Error).message}`.slice(0, 160) }; }
    } else extract = body.slice(0, 120);
    return { label, url, status: r.status, ms_total: Math.round(deps.perf() - t0), size: body.length, headers, extract };
  } catch (e) {
    return { label, url, status: null, ms_total: Math.round(deps.perf() - t0), size: null, headers: {}, extract: null,
      error: `${(e as Error).name} : ${(e as Error).message}`.slice(0, 200) };
  }
}

export async function explore(deps: ExploreDeps): Promise<Record<string, unknown>> {
  const started = deps.now();
  const lines: ProbeLine[] = [];
  const csv = 'dimensionAtObservation=AllDimensions&format=csvfilewithlabels';
  lines.push(await probe(deps, 'oecd-cpi-2018',
    `${OECD}/OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0/${AREAS}.M+Q.N.CPI.._T..GY?startPeriod=2026-06&${csv}`,
    (b) => lastByArea(b)));
  await deps.sleep(2000);   // OCDE : 2 s entre deux requêtes
  lines.push(await probe(deps, 'oecd-unemployment',
    `${OECD}/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/${AREAS}.UNE_LF_M...Y._T.Y_GE15..?startPeriod=2026-03&${csv}`,
    (b) => lastByArea(b)));
  // Variantes (24/11/2026 : 500 depuis Supabase, 200 depuis le Mac avec les mêmes en-têtes) :
  // CSV demandé par l'en-tête Accept, et requête de structure.
  await deps.sleep(2000);
  lines.push(await probe(deps, 'oecd-unemployment-accept',
    `${OECD}/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/USA.UNE_LF_M...Y._T.Y_GE15..?startPeriod=2026-06`,
    (b) => lastByArea(b), 'application/vnd.sdmx.data+csv; charset=utf-8; labels=both'));
  await deps.sleep(2000);
  lines.push(await probe(deps, 'oecd-structure', 'https://sdmx.oecd.org/public/rest/dataflow/OECD.SDD.TPS/DSD_LFS@DF_IALFS_UNE_M/1.0',
    (b) => ({ dataflow: b.includes('DF_IALFS_UNE_M') })));
  lines.push(await probe(deps, 'ecb-hicp', `${ECB}/HICP/M.U2.N.000000.4D0.ANR?format=csvdata&startPeriod=2026-01`,
    (b) => lastByArea(b)));
  lines.push(await probe(deps, 'fred-cpi', `${FRED}?id=CPIAUCSL`, (b) => ({ last: fredLast(b) })));
  lines.push(await probe(deps, 'bis-monthly', `${BIS}/M.US+XM+GB+JP+CH+CA+AU+NZ?lastNObservations=1&format=csv`,
    (b) => ({ lines: b.trim().split(/\r?\n/).length - 1 })));
  // Sources nationales (décision T-057 : l'OCDE refuse aussi Vercel, 24/11/2026).
  lines.push(await probe(deps, 'dbnomics-ons-cpi', `${DBNOMICS}/ONS/MM23/D7G7.M?observations=1`, (b) => dbnomicsLast(b)));
  lines.push(await probe(deps, 'statcan-wds', 'https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods',
    (b) => (JSON.parse(b) as { object?: { vectorId?: number; vectorDataPoint?: { refPer?: string }[] } }[])
      .map((x) => [x.object?.vectorId, x.object?.vectorDataPoint?.at(-1)?.refPer]), 'application/json',
    [{ vectorId: 41690973, latestN: 1 }, { vectorId: 2062815, latestN: 1 }]));
  lines.push(await probe(deps, 'snb-cpi', 'https://data.snb.ch/api/cube/plkopr/data/csv/en',
    (b) => ({ published: /"PublishingDate";"([^"]+)"/.exec(b)?.[1] ?? null, last: b.trim().split(/\r?\n/).at(-1)?.slice(0, 40) ?? null })));
  lines.push(await probe(deps, 'dbnomics-oecd-cpi-usa', `${DBNOMICS}/OECD/DSD_KEI@DF_KEI/USA.M.CP.GR._Z._Z.GY?observations=1`,
    (b) => dbnomicsLast(b)));
  return { job: 'explore', ok: lines.every((l) => l.status === 200 || l.label.startsWith('oecd-')), started_ms: started, ms: deps.now() - started,
    region: deps.env('SB_REGION') ?? null, lines };
}
