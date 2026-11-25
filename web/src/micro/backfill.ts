// Historique REST de la microstructure (P5, T-065, T-067) : adresses et lecture des réponses,
// relevées le 24 et le 25/11/2026 (docs/exploration-p5.md § 4). Aucune clé ; toutes ces adresses
// acceptent le navigateur (CORS). OKX : `www.okx.com` pour l'historique public (T-067), EEA le
// renvoie vide.

import { CT_VAL } from './venues/okx';
import type { OkxStat } from '../../../api/_lib/okx-stat-urls';
import type { Fill } from './cvd';
import type { OiPoint } from './funding';
import type { Level } from './book';
import type { Liquidation } from './types';

export const OKX_WWW = 'https://www.okx.com/api/v5';

// --- CVD : volume preneur ---------------------------------------------------------------------

/** Bougies 1 min de Binance (perp ou spot) entre deux minutes, bornes incluses. */
export const binanceKlinesUrl = (market: 'perp' | 'spot', from: number, to: number) =>
  `${market === 'perp' ? 'https://fapi.binance.com/fapi/v1' : 'https://api.binance.com/api/v3'}/klines?symbol=BTCUSDT&interval=1m&startTime=${from}&endTime=${to}&limit=1000`;

/** Bougie : [ouverture, o, h, l, c, volume, clôture, volume coté, trades, volume preneur acheteur, …]. Seules les bougies closes comptent. */
export function parseBinanceKlines(rows: unknown, now: number): Fill[] {
  if (!Array.isArray(rows)) throw new Error('réponse Binance inattendue');
  return (rows as (string | number)[][]).filter((r) => Number(r[6]) < now).map((r) => {
    const vol = Number(r[5]), buy = Number(r[9]);
    return { unit: Number(r[0]), buy, sell: Math.max(0, vol - buy) };
  });
}

/** Volume preneur du perpétuel OKX, 5 min, en BTC (unit=0). */
export { OKX_STAT_URLS, type OkxStat } from '../../../api/_lib/okx-stat-urls';
/** Volume preneur spot d'OKX, 5 min, en BTC, tous marchés spot BTC confondus. */

/** Lignes [ts, volume vendeur, volume acheteur] ; la tranche en cours (pas finie) est écartée. */
export function parseOkxTaker(body: unknown, now: number, unitMs = 300_000): Fill[] {
  const b = body as { code?: string; msg?: string; data?: string[][] };
  if (b?.code !== '0' || !Array.isArray(b.data)) throw new Error(`OKX : ${b?.code ?? '?'} ${b?.msg ?? ''}`.trim());
  return b.data.filter((r) => Number(r[0]) + unitMs <= now).map((r) => ({ unit: Number(r[0]), sell: Number(r[1]), buy: Number(r[2]) }));
}

// --- Open interest ---------------------------------------------------------------------------

export const BINANCE_OI = 'https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT';
export const BINANCE_OI_HIST = 'https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=30';
export const BYBIT_OI_HIST = 'https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=1h&limit=30';
/** Relais des statistiques (T-068) : fonction Vercel de l'heure OKX, même origine que la page.
 *  La machine Oracle lit OKX_STAT_URLS directement (T-069, pas de CORS côté serveur). */
export const relayStatUrl = (stat: OkxStat) => `/api/okx-time?stat=${stat}`;
/** Relais des statistiques (T-068) : fonction Vercel de l'heure OKX, même origine que la page. */
export const OKX_STATS_NO_CORS = 'OKX ne sert pas ses statistiques au navigateur (aucun en-tête CORS)';

export function parseBinanceOi(body: unknown): { ts: number; oi_btc: number } {
  const b = body as { openInterest?: string; time?: number };
  if (b?.openInterest === undefined) throw new Error('réponse Binance inattendue');
  return { ts: Number(b.time), oi_btc: Number(b.openInterest) };
}

export function parseBinanceOiHist(body: unknown): OiPoint[] {
  if (!Array.isArray(body)) throw new Error('réponse Binance inattendue');
  return (body as { sumOpenInterest: string; timestamp: number }[]).map((r) => ({ ts: Number(r.timestamp), oi_btc: Number(r.sumOpenInterest) }));
}

export function parseBybitOiHist(body: unknown): OiPoint[] {
  const b = body as { retCode?: number; retMsg?: string; result?: { list?: { openInterest: string; timestamp: string }[] } };
  if (b?.retCode !== 0 || !b.result?.list) throw new Error(`Bybit : ${b?.retCode ?? '?'} ${b?.retMsg ?? ''}`.trim());
  return b.result.list.map((r) => ({ ts: Number(r.timestamp), oi_btc: Number(r.openInterest) }));
}

/** Lignes [ts, OI en contrats, OI en BTC, OI en dollars]. */
export function parseOkxOiHist(body: unknown): OiPoint[] {
  const b = body as { code?: string; msg?: string; data?: string[][] };
  if (b?.code !== '0' || !Array.isArray(b.data)) throw new Error(`OKX : ${b?.code ?? '?'} ${b?.msg ?? ''}`.trim());
  return b.data.map((r) => ({ ts: Number(r[0]), oi_btc: Number(r[2]) }));
}

// --- Liquidations d'OKX (dernière heure) -------------------------------------------------------

export const OKX_LIQ_HIST = `${OKX_WWW}/public/liquidation-orders?instType=SWAP&instFamily=BTC-USDT&state=filled&limit=100`;

export function parseOkxLiqHist(body: unknown, recv: number): Liquidation[] {
  const b = body as { code?: string; msg?: string; data?: { instId?: string; details?: Record<string, string>[] }[] };
  if (b?.code !== '0' || !Array.isArray(b.data)) throw new Error(`OKX : ${b?.code ?? '?'} ${b?.msg ?? ''}`.trim());
  const out: Liquidation[] = [];
  for (const d of b.data) {
    if (d.instId !== 'BTC-USDT-SWAP') continue;
    for (const x of d.details ?? []) {
      const sz = Number(x.sz) * CT_VAL, px = Number(x.bkPx);
      const long = x.posSide === 'long' || (x.posSide === 'net' && x.side === 'sell');
      out.push({ venue: 'okx', ts: Number(x.ts), recv, side: long ? 'long' : 'short', px, sz, usd: sz * px, floor: true });
    }
  }
  return out;
}

// --- Carnet profond d'OKX (±1,4 %) pour la carte de profondeur -----------------------------------

export const OKX_BOOKS_FULL = `${OKX_WWW}/market/books-full?instId=BTC-USDT-SWAP&sz=5000`;

export function parseOkxBooksFull(body: unknown): { ts: number; bids: Level[]; asks: Level[] } {
  const b = body as { code?: string; msg?: string; data?: { ts: string; bids: string[][]; asks: string[][] }[] };
  if (b?.code !== '0' || !b.data?.[0]) throw new Error(`OKX : ${b?.code ?? '?'} ${b?.msg ?? ''}`.trim());
  const d = b.data[0];
  const lv = (rows: string[][]): Level[] => rows.map((r) => [Number(r[0]), Number(r[1])]);
  return { ts: Number(d.ts), bids: lv(d.bids), asks: lv(d.asks) };
}
