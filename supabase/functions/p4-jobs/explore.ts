// Étape S0 du plan P4 (sentiment et liquidité) : sonde des sources DEPUIS Supabase, c'est-à-dire
// depuis les adresses IP qui feront la collecte. Rien n'est écrit en base. Une requête par source,
// sur une fenêtre courte (statut, délai, taille, extrait lu) :
//   - FRED : VIX et reverse repo (dernière date) ; Cboe : historique officiel du VIX (CSV), un jour
//     d'avance sur FRED au relevé du Mac (24/11/2026) ;
//   - Tiingo (clé TIINGO_API_KEY des secrets, décision T-051) : clôtures SPY, TLT, CPER, GLD et
//     historique quotidien AUD/JPY. 5 requêtes, dans le budget de 50 par heure partagé avec la
//     watchlist (40 au plus) ;
//   - OKX : bougies quotidiennes BTC, ratio long/short, financement ;
//   - CFTC : Traders in Financial Futures (Socrata, gpe5-46if) et page du Bank Participation Report ;
//   - Binance et Bybit : ratios long/short et financement, pour vérifier le blocage géographique.
// Les clés n'apparaissent jamais dans le rapport. Module pur : réseau et horloges injectés.

import { type ExploreDeps, FRED, fredLast, UA } from '../p3-jobs/explore.ts';

export type { ExploreDeps };

const TIMEOUT_MS = 20_000;
const KEPT = ['date', 'content-type', 'server', 'cf-ray', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining',
  'x-mbx-used-weight-1m', 'x-bapi-limit-status'];

export const TIINGO = 'https://api.tiingo.com';
export const OKX = 'https://www.okx.com';
export const CFTC_TFF = 'https://publicreporting.cftc.gov/resource/gpe5-46if.json';
export const BPR_INDEX = 'https://www.cftc.gov/MarketReports/BankParticipationReports/index.htm';
export const CBOE_VIX = 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv';
export const BINANCE_F = 'https://fapi.binance.com';
export const BYBIT = 'https://api.bybit.com';

export interface ProbeLine {
  label: string; url: string; status: number | null; ms_total: number | null; size: number | null;
  headers: Record<string, string>; extract: unknown; error?: string;
}

/** Retire la clé Tiingo de tout texte (URL, corps d'erreur, en-tête recopié). */
export function scrub(text: string, env: ExploreDeps['env']): string {
  const k = env('TIINGO_API_KEY');
  const out = k && k.length >= 6 ? text.split(k).join('<clé>') : text;
  return out.replace(/(token=|Token )[^&\s"]+/gi, '$1<clé>');
}

/** Liste JSON (Tiingo, Binance) : nombre de points, premier et dernier. */
export function listSpan(body: string): { count: number; first: unknown; last: unknown } {
  const d = JSON.parse(body) as unknown[];
  if (!Array.isArray(d)) throw new Error('liste attendue');
  return { count: d.length, first: d[0] ?? null, last: d.at(-1) ?? null };
}

/** Réponse OKX ({code, data}) : nombre de lignes et ligne la plus récente. */
export function okxSpan(body: string): { code: string; count: number; newest: unknown } {
  const d = JSON.parse(body) as { code?: string; msg?: string; data?: unknown[] };
  return { code: d.code ?? '?', count: d.data?.length ?? 0, newest: d.data?.[0] ?? d.msg ?? null };
}

/** Dates de rapport des liens du Bank Participation Report (« deanov26f » -> 2026-11, futures). */
export function bprMonths(html: string): string[] {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const out = new Set<string>();
  for (const m of html.matchAll(/BankParticipation\/dea([a-z]{3})(\d{2})f\b/g)) {
    const i = months.indexOf(m[1]);
    if (i >= 0) out.add(`20${m[2]}-${String(i + 1).padStart(2, '0')}`);
  }
  return [...out].sort();
}

async function probe(deps: ExploreDeps, label: string, url: string, read: (body: string) => unknown,
  headers: Record<string, string> = {}): Promise<ProbeLine> {
  const t0 = deps.perf();
  try {
    const r = await deps.fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await r.text();
    const kept: Record<string, string> = {};
    for (const k of KEPT) { const v = r.headers.get(k); if (v !== null) kept[k] = scrub(v.slice(0, 120), deps.env); }
    let extract: unknown;
    if (r.status === 200) {
      try { extract = read(body); } catch (e) { extract = { error: `lecture : ${(e as Error).message}`.slice(0, 160) }; }
    } else extract = scrub(body.slice(0, 160), deps.env);
    return { label, url: scrub(url, deps.env), status: r.status, ms_total: Math.round(deps.perf() - t0), size: body.length, headers: kept, extract };
  } catch (e) {
    return { label, url: scrub(url, deps.env), status: null, ms_total: Math.round(deps.perf() - t0), size: null, headers: {}, extract: null,
      error: scrub(`${(e as Error).name} : ${(e as Error).message}`, deps.env).slice(0, 200) };
  }
}

export async function explore(deps: ExploreDeps): Promise<Record<string, unknown>> {
  const started = deps.now();
  const lines: ProbeLine[] = [];
  const start = new Date(started - 10 * 86_400_000).toISOString().slice(0, 10);
  lines.push(await probe(deps, 'fred-vix', `${FRED}?id=VIXCLS`, (b) => ({ last: fredLast(b) })));
  lines.push(await probe(deps, 'fred-rrp', `${FRED}?id=RRPONTSYD`, (b) => ({ last: fredLast(b) })));
  lines.push(await probe(deps, 'cboe-vix', CBOE_VIX, (b) => ({ last: b.trim().split(/\r?\n/).at(-1) ?? null })));
  const key = deps.env('TIINGO_API_KEY');
  const tiingo = [
    ...['SPY', 'TLT', 'CPER', 'GLD'].map((t) => [`tiingo-eod-${t.toLowerCase()}`, `${TIINGO}/tiingo/daily/${t}/prices?startDate=${start}`]),
    ['tiingo-fx-audjpy', `${TIINGO}/tiingo/fx/audjpy/prices?startDate=${start}&resampleFreq=1day`],
  ];
  for (const [label, url] of tiingo) {
    if (!key) { lines.push({ label, url, status: null, ms_total: null, size: null, headers: {}, extract: null, error: 'TIINGO_API_KEY absente des secrets' }); continue; }
    lines.push(await probe(deps, label, url, listSpan, { Authorization: `Token ${key}` }));
    await deps.sleep(1000);   // Tiingo : une seconde entre deux requêtes
  }
  lines.push(await probe(deps, 'okx-candles-btc', `${OKX}/api/v5/market/history-candles?instId=BTC-USDT&bar=1Dutc&limit=5`, okxSpan));
  lines.push(await probe(deps, 'okx-ratio-btc', `${OKX}/api/v5/rubik/stat/contracts/long-short-account-ratio-contract?instId=BTC-USDT-SWAP&period=1H&limit=5`, okxSpan));
  lines.push(await probe(deps, 'okx-funding-btc', `${OKX}/api/v5/public/funding-rate?instId=BTC-USDT-SWAP`, okxSpan));
  lines.push(await probe(deps, 'cftc-tff', `${CFTC_TFF}?$select=market_and_exchange_names,report_date_as_yyyy_mm_dd&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=1`,
    (b) => listSpan(b).last));
  lines.push(await probe(deps, 'cftc-bpr', BPR_INDEX, (b) => ({ last_months: bprMonths(b).slice(-2) })));
  lines.push(await probe(deps, 'binance-ratio-btc', `${BINANCE_F}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=5`, listSpan));
  lines.push(await probe(deps, 'binance-funding-btc', `${BINANCE_F}/fapi/v1/premiumIndex?symbol=BTCUSDT`,
    (b) => { const d = JSON.parse(b) as { lastFundingRate?: string; time?: number }; return { lastFundingRate: d.lastFundingRate, time: d.time }; }));
  lines.push(await probe(deps, 'bybit-ratio-btc', `${BYBIT}/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=5`,
    (b) => { const d = JSON.parse(b) as { retCode?: number; retMsg?: string; result?: { list?: unknown[] } }; return { retCode: d.retCode, retMsg: d.retMsg, newest: d.result?.list?.[0] ?? null }; }));
  return {
    job: 'explore', ok: lines.every((l) => l.status === 200), started_ms: started, ms: deps.now() - started,
    region: deps.env('SB_REGION') ?? null, lines,
  };
}
