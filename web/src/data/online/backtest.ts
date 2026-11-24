// Bougies du backtest (T-061) : /api/backtest/candles, en colonnes, converties en barres pour le
// moteur ; gardées en mémoire par actif et unité de temps (relues après 15 min).
import type { Candle } from '../../backtest/metrics';
import { fetchJson } from '../gateway';

export interface FeedLike { name: string; label?: string; status: string; last_message_ms: number | null; last_error: string | null; late_after_ms: number; stale_after_ms: number }
export interface CandlesReply {
  configured: boolean; reason?: string; asset: string; tf: string; label?: string; source?: string; aggregated?: string | null;
  n: number; t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[];
  series?: { first: string | null; last: string | null; complete: boolean; error: string | null } | null; feed?: FeedLike | null; computed_ms: number;
}
export interface LoadedCandles { reply: CandlesReply; candles: Candle[]; at: number }

const cache = new Map<string, LoadedCandles>();
const TTL_MS = 15 * 60_000;

export function toCandles(r: CandlesReply): Candle[] {
  const n = Math.min(r.t?.length ?? 0, r.o?.length ?? 0, r.h?.length ?? 0, r.l?.length ?? 0, r.c?.length ?? 0);
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) out.push({ t: r.t![i], o: r.o![i], h: r.h![i], l: r.l![i], c: r.c![i] });
  return out;
}

export async function loadCandles(asset: string, tf: string, now: () => number = Date.now, fetcher: typeof fetchJson = fetchJson): Promise<LoadedCandles> {
  const key = `${asset}:${tf}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < TTL_MS) return hit;
  const reply = await fetcher<CandlesReply>(`/api/backtest/candles?asset=${encodeURIComponent(asset)}&tf=${encodeURIComponent(tf)}`, { timeoutMs: 30_000 });
  const v = { reply, candles: toCandles(reply), at: now() };
  cache.set(key, v);
  return v;
}

export function clearCandleCache(): void { cache.clear(); }
