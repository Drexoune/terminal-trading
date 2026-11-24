// Microstructure BTC (P5, T-065, T-067) : événements normalisés produits par les adaptateurs de
// plateforme (micro/venues/*) et consommés par les agrégations (micro/*.ts). Tailles en BTC,
// prix en dollars (USDT ou USD), heures en ms UTC : ts = heure de la plateforme, recv = heure de
// réception dans le navigateur.

export type Venue = 'okx' | 'binance' | 'bybit' | 'hyperliquid' | 'coinbase';
export type Market = 'perp' | 'spot';

export const PERP_VENUES: Venue[] = ['okx', 'binance', 'bybit', 'hyperliquid'];
export const VENUE_LABEL: Record<Venue, string> = { okx: 'OKX', binance: 'Binance', bybit: 'Bybit', hyperliquid: 'Hyperliquid', coinbase: 'Coinbase' };

/** Trade : côté de l'agresseur (preneur). */
export interface MicroTrade { venue: Venue; market: Market; ts: number; recv: number; px: number; sz: number; side: 'buy' | 'sell' }

/** Liquidation observée : côté de la position liquidée ; `floor` : flux plafonné (Binance, OKX). */
export interface Liquidation { venue: Venue; ts: number; recv: number; side: 'long' | 'short'; px: number; sz: number; usd: number; floor: boolean }

/** Niveaux d'un carnet : [prix, taille en BTC], triés du meilleur au plus éloigné. */
export interface BookSide { px: number[]; sz: number[] }
export interface BookView { venue: Venue; ts: number; recv: number; bids: BookSide; asks: BookSide; synced: boolean }

export interface FundingView { venue: Venue; ts: number; rate: number; interval_h: number; next_ms: number | null }
export interface OiView { venue: Venue; ts: number; oi_btc: number; oi_usd: number | null }
export interface PremiumView { venue: Venue; ts: number; mark: number; index: number }

export type MicroEvent =
  | { kind: 'trade'; t: MicroTrade }
  | { kind: 'liq'; l: Liquidation }
  | { kind: 'funding'; f: FundingView }
  | { kind: 'oi'; o: OiView }
  | { kind: 'premium'; p: PremiumView };
