// Tâches de collecte de p4-jobs (plan P4, étape S1 ; sources T-059 et T-060) :
//
// - closes (chaque soir après la clôture américaine, et le matin pour FRED) : VIX de Cboe (FRED en
//   repli), écart haut rendement (FRED), SPY, TLT, CPER, GLD (Tiingo, historique ajusté relu en
//   entier : un appel par titre quelle que soit la période), AUD/JPY (Tiingo), BTC et ETH (OKX) ;
// - liquidity (chaque matin) : actif de la Fed, compte du Trésor, reverse repo (FRED) ;
// - cot (vendredi soir, repris le samedi) : rapport TFF de la CFTC, 3 ans au premier passage ;
// - crowding (toutes les 15 min) : ratios long/short de Binance, OKX et Bybit, financement.
//
// Rien n'est inventé : une source en échec garde ses lignes et porte l'erreur dans p4_state
// (« series » et « feed:<tâche> », lus par l'écran). Chaque ligne porte sa date à la source et
// son heure de réception.

import type { Json, Rest, Row } from '../p1-jobs/rest.ts';
import { CLOSES, COT_CATEGORIES, COT_MARKETS, CROWD_ASSETS, type DailySpec, HISTORY_START, LIQUIDITY } from './catalog.ts';
import { BINANCE_F, BYBIT, CBOE_VIX, CFTC_TFF, OKX, TIINGO } from './explore.ts';
import { publishCot, publishCrowding, publishLiquidity, publishRisk } from './publish.ts';
import { binanceRatio, bybitRatio, cboeCsv, type CrowdPoint, fredDaily, funding, okxDailyCandles, okxRatio, type Point,
  tffRows, tiingoDaily, tiingoFxDaily } from './parse.ts';

export type HttpFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) =>
  Promise<{ status: number; text(): Promise<string> }>;
export interface CollectDeps { fetch: HttpFetch; now: () => number; rest: Rest; env: (name: string) => string | undefined; sleep?: (ms: number) => Promise<void> }

export const FRED = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
const UA = 'TERMINAL/1.0 (terminal personnel, lecture seule)';
const TIMEOUT_MS = 30_000;
const DAY = 86_400_000;
const CROWD_KEEP_DAYS = 45;
const OKX_RUBIK_GAP_MS = 500;

const errText = (e: unknown, key?: string) => {
  const s = String((e as Error)?.message ?? e).slice(0, 160);
  return key && key.length >= 6 ? s.split(key).join('<clé>') : s;
};

async function get(deps: CollectDeps, url: string, headers: Record<string, string> = {}): Promise<string> {
  const r = await deps.fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, text/csv, */*', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await r.text();
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return body;
}

/** Calcul et publication après la collecte : un échec s'ajoute aux problèmes sans perdre la collecte. */
async function publishStep(fn: () => Promise<unknown>, problems: string[]): Promise<unknown> {
  try { return await fn(); } catch (e) { problems.push(`publication : ${errText(e)}`); return null; }
}

async function upsertChunks(rest: Rest, table: string, rows: Row[], onConflict: string): Promise<void> {
  for (let i = 0; i < rows.length; i += 1000) await rest.upsert(table, rows.slice(i, i + 1000), onConflict);
}

/** État d'un flux, même forme que feed:macro de P3 (lu par la barre de fraîcheur). */
function feedRow(name: string, label: string, now: number, ok: number, problems: string[], lateH: number, staleH: number): Row {
  return { key: `feed:${name}`, updated_ms: now, value: {
    name, label, late_after_ms: lateH * 3_600_000, stale_after_ms: staleH * 3_600_000,
    status: problems.length && !ok ? 'reconnecting' : 'connected', connected_since_ms: null,
    last_message_ms: ok ? now : null, reconnects: 0, outages: [], last_error: problems.join(' ; ').slice(0, 500) || null,
  } as unknown as Json };
}

// ---------------------------------------------------------------------------------------------
// Séries quotidiennes (closes, liquidity)

async function fetchDaily(deps: CollectDeps, s: DailySpec, okxPages: number): Promise<Point[]> {
  if (s.source === 'cboe') return cboeCsv(await get(deps, CBOE_VIX), HISTORY_START);
  if (s.source === 'fred') return fredDaily(await get(deps, `${FRED}?id=${s.code}`), HISTORY_START);
  if (s.source === 'tiingo' || s.source === 'tiingo-fx') {
    const key = deps.env('TIINGO_API_KEY');
    if (!key) throw new Error('TIINGO_API_KEY absente des secrets');
    const auth = { Authorization: `Token ${key}` };
    try {
      if (s.source === 'tiingo') return tiingoDaily(await get(deps, `${TIINGO}/tiingo/daily/${s.code}/prices?startDate=${HISTORY_START}`, auth));
      return tiingoFxDaily(await get(deps, `${TIINGO}/tiingo/fx/${s.code}/prices?startDate=${HISTORY_START}&resampleFreq=1day`, auth));
    } finally { await deps.sleep?.(1000); }   // Tiingo : une seconde entre deux requêtes
  }
  // OKX : 100 bougies par page, la plus récente en tête ; « after » donne les plus anciennes.
  const out = new Map<string, number>();
  let after = '';
  for (let page = 0; page < okxPages; page++) {
    const body = await get(deps, `${OKX}/api/v5/market/history-candles?instId=${s.code}&bar=1Dutc&limit=100${after ? `&after=${after}` : ''}`);
    const raw = (JSON.parse(body) as { data?: string[][] }).data ?? [];
    for (const p of okxDailyCandles(body)) out.set(p.date, p.value);
    if (raw.length < 100) break;
    after = raw[raw.length - 1][0];
    if (new Date(Number(after)).toISOString().slice(0, 10) < HISTORY_START) break;
  }
  return [...out.entries()].filter(([d]) => d >= HISTORY_START).sort().map(([date, value]) => ({ date, value }));
}

async function runDaily(deps: CollectDeps, job: 'closes' | 'liquidity', specs: DailySpec[], label: string): Promise<Record<string, unknown>> {
  const { rest } = deps;
  const now = deps.now();
  const recv = new Date(now).toISOString();
  const problems: string[] = [];
  const done: Record<string, string> = {};
  const status: Record<string, Json> = {};
  for (const s of specs) {
    try {
      // OKX : historique complet (12 pages) au premier passage, une page ensuite.
      const known = s.source === 'okx' && (await rest.select('sentiment_series', { select: 'date', series_id: `eq.${s.id}`, limit: '1' })).length > 0;
      const pts = await fetchDaily(deps, s, known ? 1 : 12);
      if (!pts.length) throw new Error('aucune observation');
      await upsertChunks(rest, 'sentiment_series', pts.map((p) => ({ series_id: s.id, date: p.date, value: p.value, adj: p.adj ?? null,
        source: s.source, ts_recv: recv })), 'series_id,date');
      const last = pts[pts.length - 1].date;
      done[s.id] = last;
      status[s.id] = { label: s.label, unit: s.unit, source: s.source, code: s.code, last_date: last, last_ok_ms: now, error: null };
    } catch (e) {
      const msg = errText(e, deps.env('TIINGO_API_KEY'));
      problems.push(`${s.id} : ${msg}`);
      status[s.id] = { label: s.label, unit: s.unit, source: s.source, code: s.code, error: msg };
    }
  }
  // État par série : fusion avec l'état connu (une erreur ne fait pas oublier la dernière date reçue).
  const prev = (await rest.select<{ value: Record<string, Record<string, Json>> }>('p4_state', { select: 'value', key: 'eq.series' }))[0]?.value ?? {};
  const merged: Record<string, Json> = { ...prev };
  for (const [id, st] of Object.entries(status)) merged[id] = { ...(prev[id] ?? {}), ...(st as Record<string, Json>) };
  await rest.upsert('p4_state', [{ key: 'series', updated_ms: now, value: merged },
    feedRow(job, label, now, Object.keys(done).length, problems, 30, 54)], 'key');
  const published = await publishStep(() => (job === 'closes' ? publishRisk(rest, now) : publishLiquidity(rest, now)), problems);
  return { job, ok: problems.length === 0, done, published, problems };
}

export const runCloses = (deps: CollectDeps) => runDaily(deps, 'closes', CLOSES, 'Clôtures (Cboe, Tiingo, OKX, FRED)');
export const runLiquidity = (deps: CollectDeps) => runDaily(deps, 'liquidity', LIQUIDITY, 'Liquidité de la Fed (FRED)');

// ---------------------------------------------------------------------------------------------
// COT (rapport TFF)

export async function runCot(deps: CollectDeps): Promise<Record<string, unknown>> {
  const { rest } = deps;
  const now = deps.now();
  const recv = new Date(now).toISOString();
  const latest = (await rest.select<{ date: string }>('cot_positions', { select: 'date', order: 'date.desc', limit: '1' }))[0]?.date;
  // Premier passage : 3 ans et 2 mois (percentile sur 3 ans) ; ensuite 5 semaines (révisions).
  const from = latest ? new Date(Date.parse(`${latest}T00:00:00Z`) - 35 * DAY).toISOString().slice(0, 10)
    : new Date(now - (3 * 365 + 60) * DAY).toISOString().slice(0, 10);
  const codes = Object.keys(COT_MARKETS).map((c) => `'${c}'`).join(',');
  const where = `cftc_contract_market_code in(${codes}) AND report_date_as_yyyy_mm_dd >= '${from}T00:00:00.000'`;
  const url = `${CFTC_TFF}?$where=${encodeURIComponent(where)}&$order=report_date_as_yyyy_mm_dd&$limit=10000`;
  const problems: string[] = [];
  let rows: ReturnType<typeof tffRows> = [];
  try {
    rows = tffRows(await get(deps, url), COT_MARKETS, COT_CATEGORIES);
    if (!rows.length) throw new Error('aucune ligne pour les marchés suivis');
    await upsertChunks(rest, 'cot_positions', rows.map((r) => ({ report: 'tff', ...r, ts_recv: recv }) as unknown as Row),
      'report,market_code,date,category');
  } catch (e) { problems.push(`TFF : ${errText(e)}`); }
  const last = rows.reduce((m, r) => (r.date > m ? r.date : m), '');
  const missing = last ? Object.keys(COT_MARKETS).filter((c) => !rows.some((r) => r.market_code === c && r.date === last)) : [];
  if (missing.length) problems.push(`absents du rapport du ${last} : ${missing.join(', ')}`);
  await rest.upsert('p4_state', [feedRow('cot', 'COT (CFTC, rapport TFF)', now, rows.length, problems, 8 * 24, 15 * 24)], 'key');
  const published = await publishStep(() => publishCot(rest, now), problems);
  return { job: 'cot', ok: problems.length === 0, from, rows: rows.length, last_report: last || null, published, problems };
}

// ---------------------------------------------------------------------------------------------
// Sentiment retail : ratios long/short et financement

/**
 * Une mesure d'une plateforme. url(asset, backfill, end) : « end » (OKX seulement) est l'horodatage
 * exclu à partir duquel lire la page suivante, plus ancienne. pages : nombre de pages au rattrapage.
 */
interface CrowdSpec {
  exchange: 'binance' | 'okx' | 'bybit'; metric: string; pages: number;
  url: (asset: string, backfill: boolean, end: number | null) => string; read: (b: string) => CrowdPoint[];
}

const RUBIK = '/api/v5/rubik/stat/contracts';

export const CROWD_SPECS: CrowdSpec[] = [
  ...([['account', 'globalLongShortAccountRatio'], ['top_account', 'topLongShortAccountRatio'], ['top_position', 'topLongShortPositionRatio']] as const)
    .map(([metric, path]): CrowdSpec => ({ exchange: 'binance', metric, pages: 1, read: binanceRatio,
      url: (a, b) => `${BINANCE_F}/futures/data/${path}?symbol=${a}USDT&period=1h&limit=${b ? 500 : 4}` })),
  // OKX : 100 points par page ; 8 pages (33 jours) au rattrapage.
  ...([['account', 'long-short-account-ratio-contract'], ['top_account', 'long-short-account-ratio-contract-top-trader'],
    ['top_position', 'long-short-position-ratio-contract-top-trader']] as const)
    .map(([metric, path]): CrowdSpec => ({ exchange: 'okx', metric, pages: 8, read: okxRatio,
      url: (a, b, end) => `${OKX}${RUBIK}/${path}?instId=${a}-USDT-SWAP&period=1H&limit=${b ? 100 : 4}${end ? `&end=${end}` : ''}` })),
  { exchange: 'bybit', metric: 'account', pages: 1, read: bybitRatio,
    url: (a, b) => `${BYBIT}/v5/market/account-ratio?category=linear&symbol=${a}USDT&period=1h&limit=${b ? 500 : 4}` },
  { exchange: 'binance', metric: 'funding', pages: 1, read: (b) => [funding('binance', b)], url: (a) => `${BINANCE_F}/fapi/v1/premiumIndex?symbol=${a}USDT` },
  { exchange: 'okx', metric: 'funding', pages: 1, read: (b) => [funding('okx', b)], url: (a) => `${OKX}/api/v5/public/funding-rate?instId=${a}-USDT-SWAP` },
  { exchange: 'bybit', metric: 'funding', pages: 1, read: (b) => [funding('bybit', b)], url: (a) => `${BYBIT}/v5/market/tickers?category=linear&symbol=${a}USDT` },
];

/** Points d'une mesure : une page, ou au rattrapage des pages de plus en plus anciennes. */
async function crowdPoints(deps: CollectDeps, s: CrowdSpec, asset: string, backfill: boolean): Promise<CrowdPoint[]> {
  const pts: CrowdPoint[] = [];
  let end: number | null = null;
  for (let i = 0; i < (backfill ? s.pages : 1); i++) {
    // OKX « rubik » : 5 requêtes par 2 s au plus (HTTP 429 au premier rattrapage du 24/11/2026).
    if (s.exchange === 'okx' && s.metric !== 'funding') await deps.sleep?.(OKX_RUBIK_GAP_MS);
    const got = s.read(await get(deps, s.url(asset, backfill, end)));
    pts.push(...got);
    if (got.length < 100) break;
    end = Math.min(...got.map((p) => p.ts_ms));
  }
  return pts;
}

export async function runCrowding(deps: CollectDeps): Promise<Record<string, unknown>> {
  const { rest } = deps;
  const now = deps.now();
  const recv = new Date(now).toISOString();
  const problems: string[] = [];
  let saved = 0;
  // Dernier point connu par plateforme, actif et mesure : rattrapage de 30 jours s'il date de plus de 3 h.
  const recent = await rest.select<{ exchange: string; symbol: string; metric: string }>('crowding',
    { select: 'exchange,symbol,metric', ts: `gte.${new Date(now - 3 * 3_600_000).toISOString()}`, limit: '5000' });
  const fresh = new Set(recent.map((r) => `${r.exchange}|${r.symbol}|${r.metric}`));
  for (const asset of CROWD_ASSETS) {
    for (const s of CROWD_SPECS) {
      const backfill = s.metric !== 'funding' && !fresh.has(`${s.exchange}|${asset}|${s.metric}`);
      try {
        const pts = await crowdPoints(deps, s, asset, backfill);
        if (!pts.length) throw new Error('aucun point');
        const rows = [...new Map(pts.map((p) => [p.ts_ms, p])).values()].map((p) => ({ exchange: s.exchange, symbol: asset, metric: s.metric,
          ts: new Date(p.ts_ms).toISOString(), value: p.value, long_share: p.long_share, ts_recv: recv }));
        await upsertChunks(rest, 'crowding', rows, 'exchange,symbol,metric,ts');
        saved += rows.length;
      } catch (e) { problems.push(`${s.exchange} ${asset} ${s.metric} : ${errText(e)}`); }
    }
  }
  await rest.remove('crowding', { ts: `lt.${new Date(now - CROWD_KEEP_DAYS * DAY).toISOString()}` });
  await rest.upsert('p4_state', [feedRow('crowding', 'Ratios long/short (Binance, OKX, Bybit)', now, saved, problems, 0.75, 2)], 'key');
  const published = await publishStep(() => publishCrowding(rest, now), problems);
  return { job: 'crowding', ok: problems.length === 0, saved, published, problems };
}
