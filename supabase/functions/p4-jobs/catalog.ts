// Catalogue des sources de P4 (décisions T-059 et T-060, relevé S0 du 24/11/2026,
// docs/exploration-p4.md). Aucun identifiant deviné : chacun a été lu dans une réponse réelle.

/** Première date gardée : 252 séances de percentile + 125 de moyenne mobile + marge, et un an de graphique. */
export const HISTORY_START = '2023-01-01';

/** Séries quotidiennes ou hebdomadaires de sentiment_series : identifiant, source, code, libellé, unité. */
export interface DailySpec { id: string; source: 'cboe' | 'tiingo' | 'tiingo-fx' | 'okx' | 'fred'; code: string; label: string; unit: string }

export const CLOSES: DailySpec[] = [
  { id: 'VIX', source: 'cboe', code: 'VIX_History.csv', label: 'VIX (Cboe)', unit: 'pts' },
  { id: 'VIX_FRED', source: 'fred', code: 'VIXCLS', label: 'VIX (FRED, repli)', unit: 'pts' },
  { id: 'HY_OAS', source: 'fred', code: 'BAMLH0A0HYM2', label: 'Écart haut rendement (ICE BofA, FRED)', unit: '%' },
  { id: 'SPY', source: 'tiingo', code: 'SPY', label: 'SPY (Tiingo)', unit: 'USD' },
  { id: 'TLT', source: 'tiingo', code: 'TLT', label: 'TLT (Tiingo)', unit: 'USD' },
  { id: 'CPER', source: 'tiingo', code: 'CPER', label: 'CPER (Tiingo)', unit: 'USD' },
  { id: 'GLD', source: 'tiingo', code: 'GLD', label: 'GLD (Tiingo)', unit: 'USD' },
  { id: 'AUDJPY', source: 'tiingo-fx', code: 'audjpy', label: 'AUD/JPY (Tiingo)', unit: 'JPY' },
  { id: 'VXN', source: 'fred', code: 'VXNCLS', label: 'VXN, volatilité implicite du Nasdaq 100 (Cboe, FRED)', unit: 'pts' },
  { id: 'BTC', source: 'okx', code: 'BTC-USDT', label: 'BTC/USDT (OKX)', unit: 'USDT' },
  { id: 'ETH', source: 'okx', code: 'ETH-USDT', label: 'ETH/USDT (OKX)', unit: 'USDT' },
];

/** Liquidité nette de la Fed (T-060) : WALCL − WDTGAL − RRPONTSYD × 1 000, en millions de dollars. */
export const LIQUIDITY: DailySpec[] = [
  { id: 'WALCL', source: 'fred', code: 'WALCL', label: 'Actif total de la Fed (mercredi)', unit: 'M USD' },
  { id: 'WDTGAL', source: 'fred', code: 'WDTGAL', label: 'Compte du Trésor (mercredi)', unit: 'M USD' },
  { id: 'RRP', source: 'fred', code: 'RRPONTSYD', label: 'Reverse repo (quotidien)', unit: 'Md USD' },
];

/** Marchés du COT (rapport TFF, futures seuls, jeu gpe5-46if) : code CFTC stable -> libellé court. */
export const COT_MARKETS: Record<string, { label: string; group: 'fx' | 'index' | 'crypto' }> = {
  '099741': { label: 'EUR', group: 'fx' },
  '097741': { label: 'JPY', group: 'fx' },
  '096742': { label: 'GBP', group: 'fx' },
  '092741': { label: 'CHF', group: 'fx' },
  '090741': { label: 'CAD', group: 'fx' },
  '232741': { label: 'AUD', group: 'fx' },
  '112741': { label: 'NZD', group: 'fx' },
  '098662': { label: 'Indice dollar (ICE)', group: 'fx' },
  '13874A': { label: 'E-mini S&P 500', group: 'index' },
  '209742': { label: 'E-mini Nasdaq 100', group: 'index' },
  '133741': { label: 'Bitcoin (CME)', group: 'crypto' },
};

/** Catégories du rapport TFF : préfixe des colonnes Socrata. « dealer » sert aux positions des banques (T-060). */
export const COT_CATEGORIES = {
  dealer: ['dealer_positions_long_all', 'dealer_positions_short_all', 'dealer_positions_spread_all'],
  asset_mgr: ['asset_mgr_positions_long', 'asset_mgr_positions_short', 'asset_mgr_positions_spread'],
  lev_money: ['lev_money_positions_long', 'lev_money_positions_short', 'lev_money_positions_spread'],
  other_rept: ['other_rept_positions_long', 'other_rept_positions_short', 'other_rept_positions_spread'],
  nonrept: ['nonrept_positions_long_all', 'nonrept_positions_short_all', null],
} as const;

/** Instruments suivis pour le sentiment retail. */
export const CROWD_ASSETS = ['BTC', 'ETH'] as const;

/** Bank Participation Report (T-060) : marchés suivis, libellé de la CFTC -> libellé court. */
export const BPR_MARKETS: Record<string, { label: string; group: 'fx' | 'index' | 'crypto' }> = {
  'CME EURO FX': { label: 'EUR', group: 'fx' },
  'CME JAPANESE YEN': { label: 'JPY', group: 'fx' },
  'CME BRITISH POUND': { label: 'GBP', group: 'fx' },
  'CME SWISS FRANC': { label: 'CHF', group: 'fx' },
  'CME CANADIAN DOLLAR': { label: 'CAD', group: 'fx' },
  'CME AUSTRALIAN DOLLAR': { label: 'AUD', group: 'fx' },
  'CME NZ DOLLAR': { label: 'NZD', group: 'fx' },
  'CME E-MINI S&P 500': { label: 'E-mini S&P 500', group: 'index' },
  'CME NASDAQ MINI': { label: 'E-mini Nasdaq 100', group: 'index' },
  'CME BITCOIN': { label: 'Bitcoin (CME)', group: 'crypto' },
};

/** Adresse publique du terminal (Vercel), qui relit le Bank Participation Report pour p4-jobs. */
export const TERMINAL_WEB_DEFAULT = 'https://terminal-trading-steel.vercel.app';
