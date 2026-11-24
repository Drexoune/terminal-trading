// /api/backtest/* — section Backtest (T-061, T-062) : bougies servies au moteur (qui tourne dans le
// navigateur), lues dans bt_candles avec la clé secrète, côté serveur. Données publiques seulement.
//
//   GET  /api/backtest/candles?asset=&tf=  BTC, ETH : 1D, 4H, 1H ; QQQ, SPY : 1D. Une série en
//                                          colonnes, avec sa source et l'état de sa collecte.
//   GET  /api/backtest/ai                  état de l'assistant (clé, appels du jour, plafond)
//   POST /api/backtest/ai-generate|ai-repair|ai-explain   assistant IA (S3, T-063) : session
//                                          exigée, Gemini en offre gratuite (backtest-ai.ts).
//   GET  /api/backtest/loops, /api/backtest/loop?id=   recherche autonome (S4, T-064) : session
//   POST /api/backtest/loop-create, loop-stop           exigée ; calcul dans bt-jobs (backtest-loop.ts).

import { aiStatus, handleAi } from './backtest-ai.js';
import { handleLoop } from './backtest-loop.js';
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
    const m = /^\/api\/backtest\/([a-z-]+)\/?$/.exec(new URL(request.url).pathname);
    const q = readQuery(request, ['path', 'asset', 'tf', 'id']);
    const path = m ? m[1] : q.get('path') ?? '';
    const now = ctx.deps.now();
    const cfg = supabaseConfig(ctx.env);
    if (request.method === 'POST' && path.startsWith('ai-')) {
      if (!cfg.ok) throw new HttpError(503, `assistant non configuré : ${cfg.reason}`);
      return handleAi(request, ctx.env, ctx.deps.fetch, cfg.config, now, path.slice(3));
    }
    if ((request.method === 'POST' && (path === 'loop-create' || path === 'loop-stop')) || (request.method === 'GET' && (path === 'loops' || path === 'loop'))) {
      if (!cfg.ok) throw new HttpError(503, `recherche autonome non configurée : ${cfg.reason}`);
      return handleLoop(request, ctx.env, ctx.deps.fetch, cfg.config, now, path);
    }
    if (request.method !== 'GET') throw new HttpError(405, 'méthode non autorisée : GET attendu (POST pour ai-generate, ai-repair, ai-explain, loop-create, loop-stop)');
    if (path === 'ai') {
      if (!cfg.ok) return json({ configured: false, reason: cfg.reason }, NO_STORE);
      return json(await aiStatus(ctx.env, ctx.deps.fetch, cfg.config, now), NO_STORE);
    }
    if (path !== 'candles') throw new HttpError(404, 'route inconnue (attendues : /api/backtest/candles?asset=&tf=, /api/backtest/ai, /api/backtest/loops)');
    const asset = (q.get('asset') ?? '').toUpperCase(), tf = (q.get('tf') ?? '').toUpperCase();
    const a = ASSETS[asset];
    if (!a) throw new HttpError(400, `asset attendu parmi ${Object.keys(ASSETS).join(', ')}`);
    if (!a.tfs.includes(tf)) throw new HttpError(400, `tf attendu pour ${asset} : ${a.tfs.join(', ')}`);
    if (!cfg.ok) return json({ configured: false, reason: cfg.reason, asset, tf, n: 0, computed_ms: now }, NO_STORE);
    return json(await candles(cfg.config, ctx.deps.fetch, now, asset, tf), CACHE_CANDLES);
  });
}
