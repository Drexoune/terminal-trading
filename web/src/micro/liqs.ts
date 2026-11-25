// Liquidations de la dernière heure (P5, docs/ecrans.md § 7, T-067). Flux observés uniquement :
// jamais de niveaux de liquidation estimés. Binance et OKX sont des planchers (au plus une
// liquidation diffusée par seconde), Bybit se dit complet, Hyperliquid n'a aucun flux public.
// OKX est rattrapé sur l'heure écoulée par `www.okx.com` (100 dernières) ; les doublons entre le
// rattrapage et le direct sont écartés (même plateforme, heure, prix et taille).

import { PERP_VENUES, type Liquidation, type Venue } from './types';

export const LIQ_WINDOW_MS = 3_600_000;
export const LIQ_BIG_USD = 10_000_000;
export const LIQ_ROWS = 60;

export const NO_LIQ_FEED: Partial<Record<Venue, string>> = { hyperliquid: 'aucun flux public de liquidations' };
export const FLOOR_NOTE = 'Binance et OKX ne diffusent qu’une liquidation par seconde au plus : leurs totaux sont des minimums. Hyperliquid : aucun flux public.';

export interface LiqRow extends Liquidation { big: boolean }
export interface LiqState {
  rows: LiqRow[];                                   // plus récentes d'abord, LIQ_ROWS au plus
  count: number;
  long_usd: number; short_usd: number;
  by_venue: { venue: Venue; long_usd: number; short_usd: number; floor: boolean; since: number | null; reason: string | null }[];
  floor: boolean;                                   // un total contient un plancher
  window_ms: number;
}

const key = (l: Liquidation) => `${l.venue}|${l.ts}|${l.px}|${l.sz}`;

export class Liquidations {
  private list: Liquidation[] = [];
  private seen = new Set<string>();
  private since = new Map<Venue, number>();       // début de l'observation de chaque plateforme

  /** Début de l'observation d'une plateforme (connexion, ou rattrapage pour OKX). */
  observe(venue: Venue, from: number): void {
    const cur = this.since.get(venue);
    if (cur === undefined || from < cur) this.since.set(venue, from);
  }

  add(l: Liquidation): boolean {
    const k = key(l);
    if (this.seen.has(k)) return false;
    this.seen.add(k);
    this.list.push(l);
    return true;
  }

  prune(now: number): void {
    const cut = now - LIQ_WINDOW_MS;
    if (!this.list.some((l) => l.ts < cut)) return;
    this.list = this.list.filter((l) => l.ts >= cut);
    this.seen = new Set(this.list.map(key));
  }

  state(now: number): LiqState {
    this.prune(now);
    const sorted = [...this.list].sort((a, b) => b.ts - a.ts);
    const sum = (v: Venue | null, side: 'long' | 'short') => this.list.filter((l) => (v === null || l.venue === v) && l.side === side).reduce((s, l) => s + l.usd, 0);
    return {
      rows: sorted.slice(0, LIQ_ROWS).map((l) => ({ ...l, big: l.usd >= LIQ_BIG_USD })),
      count: this.list.length,
      long_usd: sum(null, 'long'), short_usd: sum(null, 'short'),
      by_venue: PERP_VENUES.map((v) => ({
        venue: v, long_usd: sum(v, 'long'), short_usd: sum(v, 'short'), floor: v === 'binance' || v === 'okx',
        since: this.since.get(v) ?? null, reason: NO_LIQ_FEED[v] ?? null,
      })),
      floor: this.list.some((l) => l.floor),
      window_ms: LIQ_WINDOW_MS,
    };
  }
}
