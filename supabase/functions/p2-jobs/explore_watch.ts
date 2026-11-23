// Exploration de la source de la watchlist hors crypto (décision T-005, module Markets Watch),
// lancée DEPUIS Supabase : tâche « explore-watch » de p2-jobs. Lecture seule, rien n'est écrit.
//
// Actifs : Nasdaq 100 et S&P 500 (indice et future), DXY, rendement US 10 ans, or, EUR/USD,
// USD/JPY, ETF PEA Nasdaq 100 (PUST, Paris) et S&P 500 (ESE, Paris).
// Sources comparées : Stooq et FRED (sans clé), Tiingo, Massive, Alpha Vantage (clés des
// secrets Supabase, déjà utilisées par le module Bourse). Alpha Vantage : 2 requêtes seulement
// (quota de 25 par jour partagé avec les clôtures européennes de Bourse).
//
// Une seconde entre deux requêtes vers un même service. Les clés n'apparaissent jamais dans le
// rapport (remplacées par « <clé> »). Pour chaque requête : statut, délai, extrait de la réponse.

import type { ExploreDeps, ProbeFetch } from './explore.ts';
import { UA } from './explore.ts';

const TIMEOUT_MS = 10_000;
const EXCERPT = 420;

export interface WatchProbe { source: string; asset: string; status: number | null; ms: number | null; excerpt: string; error?: string }

interface Spec { source: string; asset: string; url: string; headers?: Record<string, string>; skip?: string }

export function specs(env: ExploreDeps['env']): Spec[] {
  const tiingo = env('TIINGO_API_KEY');
  const massive = env('MASSIVE_API_KEY');
  const alpha = env('ALPHA_VANTAGE_API_KEY');
  const stooq = (asset: string, s: string): Spec => ({ source: 'stooq', asset, url: `https://stooq.com/q/l/?s=${encodeURIComponent(s)}&f=sd2t2ohlcv&h&e=csv` });
  const fred = (asset: string, id: string): Spec => ({ source: 'fred', asset, url: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}` });
  const tg = (asset: string, path: string): Spec => ({ source: 'tiingo', asset, url: `https://api.tiingo.com${path}`,
    headers: tiingo ? { Authorization: `Token ${tiingo}` } : undefined, skip: tiingo ? undefined : 'TIINGO_API_KEY absente' });
  const ms = (asset: string, path: string): Spec => ({ source: 'massive', asset, url: `https://api.massive.com${path}`,
    headers: massive ? { Authorization: `Bearer ${massive}` } : undefined, skip: massive ? undefined : 'MASSIVE_API_KEY absente' });
  const av = (asset: string, q: string): Spec => ({ source: 'alphavantage', asset, url: `https://www.alphavantage.co/query?${q}&apikey=${alpha ?? ''}`,
    skip: alpha ? undefined : 'ALPHA_VANTAGE_API_KEY absente' });
  return [
    stooq('Nasdaq 100 (indice)', '^ndx'), stooq('S&P 500 (indice)', '^spx'), stooq('Nasdaq 100 (future)', 'nq.f'),
    stooq('S&P 500 (future)', 'es.f'), stooq('DXY (future)', 'dx.f'), stooq('US 10 ans', '10usy.b'), stooq('Or', 'xauusd'),
    stooq('EUR/USD', 'eurusd'), stooq('USD/JPY', 'usdjpy'), stooq('ETF PEA Nasdaq 100', 'pust.fr'), stooq('ETF PEA S&P 500', 'ese.fr'),
    fred('US 10 ans', 'DGS10'), fred('Dollar (indice large)', 'DTWEXBGS'), fred('EUR/USD', 'DEXUSEU'),
    tg('EUR/USD, USD/JPY, or', '/tiingo/fx/top?tickers=eurusd,usdjpy,xauusd'), tg('QQQ, SPY (IEX)', '/iex/?tickers=qqq,spy'),
    ms('Nasdaq 100, S&P 500 (indices)', '/v3/snapshot/indices?ticker.any_of=I:NDX,I:SPX'),
    ms('EUR/USD (dernier cours)', '/v1/last_quote/currencies/EUR/USD'), ms('Or (veille)', '/v2/aggs/ticker/C:XAUUSD/prev'),
    ms('QQQ (instantané)', '/v2/snapshot/locale/us/markets/stocks/tickers/QQQ'),
    av('ETF PEA Nasdaq 100', 'function=GLOBAL_QUOTE&symbol=PUST.PAR'), av('EUR/USD', 'function=CURRENCY_EXCHANGE_RATE&from_currency=EUR&to_currency=USD'),
  ];
}

/** Retire toute clé d'un texte (URL, corps d'erreur). */
export function scrub(text: string, env: ExploreDeps['env']): string {
  let out = text;
  for (const k of ['TIINGO_API_KEY', 'MASSIVE_API_KEY', 'ALPHA_VANTAGE_API_KEY']) {
    const v = env(k);
    if (v && v.length >= 6) out = out.split(v).join('<clé>');
  }
  return out.replace(/(apikey|token)=[^&\s"]+/gi, '$1=<clé>');
}

export async function exploreWatch(deps: ExploreDeps): Promise<Record<string, unknown>> {
  const started = deps.now();
  const last = new Map<string, number>();
  const lines: WatchProbe[] = [];
  for (const s of specs(deps.env)) {
    if (s.skip) { lines.push({ source: s.source, asset: s.asset, status: null, ms: null, excerpt: '', error: s.skip }); continue; }
    const wait = (last.get(s.source) ?? 0) + 1000 - deps.perf();
    if (wait > 0) await deps.sleep(wait);
    last.set(s.source, deps.perf());
    const t0 = deps.perf();
    try {
      const r = await (deps.fetch as ProbeFetch)(s.url, { headers: { 'User-Agent': UA, Accept: '*/*', ...s.headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = await r.text();
      lines.push({ source: s.source, asset: s.asset, status: r.status, ms: Math.round(deps.perf() - t0),
        excerpt: scrub(body.replace(/\s+/g, ' ').trim().slice(-EXCERPT), deps.env) });
    } catch (e) {
      lines.push({ source: s.source, asset: s.asset, status: null, ms: Math.round(deps.perf() - t0), excerpt: '',
        error: scrub(`${(e as Error).name} : ${(e as Error).message}`, deps.env).slice(0, 200) });
    }
  }
  return { job: 'explore-watch', ok: true, started_ms: started, ms: deps.now() - started, lines };
}
