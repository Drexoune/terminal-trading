// /api/backtest/* — section Backtest (T-061, T-062) : bougies servies au moteur (qui tourne dans le
// navigateur), lues dans bt_candles avec la clé secrète, côté serveur. Données publiques seulement.
//
//   GET /api/backtest/candles?asset=&tf=   BTC, ETH : 1D, 4H, 1H ; QQQ, SPY : 1D. Une série en
//                                          colonnes, avec sa source et l'état de sa collecte.
// Les routes de l'assistant (S3) et de la recherche autonome (S4) s'ajouteront ici.

import { HttpError, json, NO_STORE, readQuery, respond } from './http.js';
import type { FetchFn } from './okx.js';
import type { Context } from './routes.js';
import { rest, supabaseConfig, type SupabaseConfig } from './supabase.js';

export const ASSETS: Record<string, { label: string; tfs: string[]; source: string }> = {
  BTC: { label: 'BTC/USDT', tfs: ['1D', '4H', '1H'], source: 'OKX' },
  ETH: { label: 'ETH/USDT', tfs: ['1D', '4H', '1H'], source: 'OKX' },
  QQQ: { label: 'QQQ · substitut du Nasdaq 100', tfs: ['1D'], source: 'Tiingo, cours ajustés' },
  SPY: { label: 'SPY · substitut du S&P 500', tfs: ['1D'], source: 'Tiingo, cours ajustés' },
};
/** Les bougies changent au plus tous les quarts d'heure : cache de 5 min sur le réseau de Vercel. */
export const CACHE_CANDLES = 'public, max-age=0, s-maxage=300, stale-while-revalidate=600';

interface Cols { t: number[] | null; o: number[] | null; h: number[] | null; l: number[] | null; c: number[] | null; v: (number | null)[] | null; n: number; source: string | null }

export async function candles(cfg: SupabaseConfig, fetchFn: FetchFn, now: number, asset: string, tf: string) {
  const q = (table: string, params: Record<string, string>) => rest(cfg, fetchFn, 'GET', table, params, false).then((r) => r.rows);
  const [cols, state] = await Promise.all([
    q('rpc/bt_candles_cols', { p_asset: asset, p_tf: tf, p_from: '1990-01-01T00:00:00Z' }),
    q('bt_state', { select: 'key,value', key: 'in.("series","feed:candles")' }),
  ]);
  const c = (cols[0] ?? { t: null, n: 0 }) as Cols;
  const by = new Map((state as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  const series = (by.get('series') as Record<string, unknown> | undefined)?.[`${asset}:${tf === '4H' ? '1H' : tf}`] ?? null;
  return {
    configured: true, asset, tf, label: ASSETS[asset].label, source: ASSETS[asset].source,
    aggregated: tf === '4H' ? 'agrégé depuis le 1 h, tranches UTC' : null,
    n: c.n ?? 0, t: c.t ?? [], o: c.o ?? [], h: c.h ?? [], l: c.l ?? [], c: c.c ?? [], v: c.v ?? [],
    series, feed: by.get('feed:candles') ?? null, computed_ms: now,
  };
}

export function handleBacktest(request: Request, ctx: Context): Promise<Response> {
  return respond(ctx.env, '/api/backtest', async () => {
    if (request.method !== 'GET') throw new HttpError(405, 'méthode non autorisée : GET attendu');
    const q = readQuery(request, ['path', 'asset', 'tf']);
    const m = /^\/api\/backtest\/([a-z]+)\/?$/.exec(new URL(request.url).pathname);
    const path = m ? m[1] : q.get('path') ?? '';
    if (path !== 'candles') throw new HttpError(404, 'route inconnue (attendue : /api/backtest/candles?asset=&tf=)');
    const asset = (q.get('asset') ?? '').toUpperCase(), tf = (q.get('tf') ?? '').toUpperCase();
    const a = ASSETS[asset];
    if (!a) throw new HttpError(400, `asset attendu parmi ${Object.keys(ASSETS).join(', ')}`);
    if (!a.tfs.includes(tf)) throw new HttpError(400, `tf attendu pour ${asset} : ${a.tfs.join(', ')}`);
    const cfg = supabaseConfig(ctx.env);
    const now = ctx.deps.now();
    if (!cfg.ok) return json({ configured: false, reason: cfg.reason, asset, tf, n: 0, computed_ms: now }, NO_STORE);
    return json(await candles(cfg.config, ctx.deps.fetch, now, asset, tf), CACHE_CANDLES);
  });
}
