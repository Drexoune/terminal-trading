// Calculs du graphique de prix, purs et testés : grille temporelle continue,
// VWAP ancré sur la journée UTC, fusion des bougies reçues en direct.

import type { Candle } from '../data/protocol';

const DAY = 86_400_000;

export interface Point { t: number; v: number }

/**
 * VWAP ancré à 00:00 UTC, remis à zéro chaque jour.
 * Pour une bougie OKX, vol_quote / vol_base est le prix moyen exact de ses
 * trades : le VWAP cumulé est donc Σ vol_quote / Σ vol_base, sans approximation
 * par le « prix typique ».
 */
export function dailyVwap(candles: Candle[]): Point[] {
  const out: Point[] = [];
  let day = -1;
  let q = 0;
  let b = 0;
  for (const c of candles) {
    const d = Math.floor(c.t / DAY);
    if (d !== day) { day = d; q = 0; b = 0; }
    q += c.vol_quote;
    b += c.vol_base;
    if (b > 0) out.push({ t: c.t, v: q / b });
  }
  return out;
}

/** Remplace ou ajoute une bougie (même ouverture = mise à jour), en gardant l'ordre. */
export function upsertCandle(candles: Candle[], c: Candle): Candle[] {
  const last = candles[candles.length - 1];
  if (!last || c.t > last.t) return [...candles, c];
  if (c.t === last.t) return [...candles.slice(0, -1), c];
  const i = candles.findIndex((x) => x.t === c.t);
  if (i < 0) return [...candles, c].sort((a, b) => a.t - b.t);
  const copy = candles.slice();
  copy[i] = c;
  return copy;
}

/** Instants de la grille [from, to[ au pas `step` (pour étendre l'axe à 24:00). */
export function timeGrid(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let t = from; t < to; t += step) out.push(t);
  return out;
}

/** Position logique d'un instant sur une grille continue démarrant à `from`. */
export function logicalIndex(t: number, from: number, step: number): number {
  return (t - from) / step;
}

/** Points de clôture pour une sparkline : au plus `max` points, régulièrement espacés. */
export function downsample(values: number[], max = 120): number[] {
  if (values.length <= max) return values;
  const out: number[] = [];
  const stepf = (values.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(values[Math.round(i * stepf)]);
  return out;
}
