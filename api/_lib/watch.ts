// GET /api/p1/watch — Markets Watch (T-051, T-052) : derniers cours de la watchlist hors crypto,
// référence de la variation et série pour la sparkline, lus dans Supabase avec la clé secrète.
//   - Tiingo (watch_quotes, toutes les 3 min) : EUR/USD, USD/JPY, or (variation sur 24 h),
//     QQQ et SPY (variation depuis la clôture de la veille donnée par la source) ;
//   - FRED (watch_quotes, quotidien) : US 10 ans, indice large du dollar de la Fed (variation
//     contre l'observation précédente) ;
//   - ETF du PEA : clôtures du module Bourse (public.prices), sans nouvelle requête.
// Aucune valeur calculée hors des différences affichées ; une série vide reste vide.

import type { FetchFn } from './okx.js';
import { rest, type SupabaseConfig } from './supabase.js';

export const TIINGO_ASSETS = ['eurusd', 'usdjpy', 'xauusd', 'qqq', 'spy'] as const;
export const DAILY_ASSETS = ['us10y', 'usd-broad'] as const;
export const PEA_LISTINGS: Record<string, string> = { pust: 'PUST.PAR', ese: 'ESE.PAR' };
const DAY = 86_400_000;
const SERIES_MAX = 120;

export interface WatchPoint { t: number; price: number }
export interface WatchAsset {
  asset: string;
  source: string | null;
  last: { price: number; bid: number | null; ask: number | null; ts_source: number; ts_recv: number } | null;
  ref: { price: number; ts: number; kind: '24h' | 'veille' } | null;
  series: WatchPoint[];
  currency?: string;
}

interface QuoteRow { ts_source: string; ts_recv: string; price: number | string; bid: number | string | null; ask: number | string | null;
  prev_close: number | string | null; source: string }

const n = (v: number | string | null | undefined): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

/** Réduit une série à `max` points en gardant le premier et le dernier (pas régulier). */
export function thin(points: WatchPoint[], max = SERIES_MAX): WatchPoint[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

export function tiingoAsset(asset: string, rows: QuoteRow[], now: number): WatchAsset {
  const pts = rows.map((r) => ({ t: Date.parse(r.ts_source), price: Number(r.price) })).filter((p) => Number.isFinite(p.t));
  const lastRow = rows[rows.length - 1];
  if (!lastRow) return { asset, source: null, last: null, ref: null, series: [] };
  const last = { price: Number(lastRow.price), bid: n(lastRow.bid), ask: n(lastRow.ask), ts_source: Date.parse(lastRow.ts_source),
    ts_recv: Date.parse(lastRow.ts_recv) };
  let ref: WatchAsset['ref'] = null;
  if (lastRow.source === 'tiingo-iex') {
    const pc = n(lastRow.prev_close);
    if (pc !== null) ref = { price: pc, ts: last.ts_source, kind: 'veille' };
  } else {
    // Change et or : premier cours d'il y a 24 h au plus (rien si la série est plus courte que 20 h).
    const first = pts.find((p) => p.t >= now - DAY);
    if (first && last.ts_source - first.t >= 20 * 3_600_000) ref = { price: first.price, ts: first.t, kind: '24h' };
  }
  return { asset, source: lastRow.source, last, ref, series: thin(pts.filter((p) => p.t >= now - DAY)) };
}

export function dailyAsset(asset: string, rows: { date: string; price: number; recv: string }[], source: string, currency?: string): WatchAsset {
  const pts = rows.map((r) => ({ t: Date.parse(`${r.date.slice(0, 10)}T00:00:00Z`), price: r.price })).sort((a, b) => a.t - b.t);
  const lastPt = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const recv = rows.find((r) => r.date.slice(0, 10) === new Date(lastPt?.t ?? 0).toISOString().slice(0, 10))?.recv;
  return { asset, source, currency,
    last: lastPt ? { price: lastPt.price, bid: null, ask: null, ts_source: lastPt.t, ts_recv: recv ? Date.parse(recv) : lastPt.t } : null,
    ref: prev ? { price: prev.price, ts: prev.t, kind: 'veille' } : null, series: pts };
}

export async function watchState(cfg: SupabaseConfig, fetchFn: FetchFn, now: number) {
  const q = (table: string, params: Record<string, string>) => rest(cfg, fetchFn, 'GET', table, params, false).then((r) => r.rows);
  const since = new Date(now - DAY - 3_600_000).toISOString();
  const [feedRows, listings, ...quotes] = await Promise.all([
    q('p1_state', { select: 'value', key: 'eq.feed:watch', limit: '1' }),
    q('instrument_listings', { select: 'id,source_symbol,currency', source_symbol: `in.(${Object.values(PEA_LISTINGS).map((s) => `"${s}"`).join(',')})` }),
    ...TIINGO_ASSETS.map((a) => q('watch_quotes', { select: 'ts_source,ts_recv,price,bid,ask,prev_close,source', asset: `eq.${a}`,
      ts_source: `gte.${since}`, order: 'ts_source.asc', limit: '1000' })),
    ...DAILY_ASSETS.map((a) => q('watch_quotes', { select: 'ts_source,ts_recv,price,bid,ask,prev_close,source', asset: `eq.${a}`,
      order: 'ts_source.desc', limit: '31' })),
  ]);
  const assets: WatchAsset[] = TIINGO_ASSETS.map((a, i) => tiingoAsset(a, quotes[i] as QuoteRow[], now));
  DAILY_ASSETS.forEach((a, i) => {
    const rows = (quotes[TIINGO_ASSETS.length + i] as QuoteRow[]).map((r) => ({ date: r.ts_source, price: Number(r.price), recv: r.ts_recv }));
    assets.push(dailyAsset(a, rows, 'fred'));
  });
  const ls = listings as { id: number; source_symbol: string; currency: string }[];
  const pea = await Promise.all(Object.entries(PEA_LISTINGS).map(async ([asset, sym]) => {
    const l = ls.find((x) => x.source_symbol === sym);
    if (!l) return { asset, source: null, last: null, ref: null, series: [] } as WatchAsset;
    const rows = await q('prices', { select: 'value_date,close,received_at,source', listing_id: `eq.${l.id}`, order: 'value_date.desc', limit: '31' }) as
      { value_date: string; close: number | string; received_at: string; source: string }[];
    return dailyAsset(asset, rows.map((r) => ({ date: r.value_date, price: Number(r.close), recv: r.received_at })), rows[0]?.source ?? 'bourse', l.currency);
  }));
  assets.push(...pea);
  return { configured: true, feed: (feedRows[0] as { value?: unknown } | undefined)?.value ?? null, assets, computed_ms: now };
}
