// Adresses des statistiques publiques d'OKX (www.okx.com, T-067, T-068, T-069), sans aucun import :
// lues par le relais Vercel (okx-stats.ts), par le front (web/src/micro/backfill.ts) et par la
// machine Oracle (server/micro). EEA les renvoie vides ; elles ne portent pas d'en-tête CORS.

export type OkxStat = 'taker-perp' | 'taker-spot' | 'oi-hist';

export const OKX_STAT_URLS: Record<OkxStat, string> = {
  'taker-perp': 'https://www.okx.com/api/v5/rubik/stat/taker-volume-contract?instId=BTC-USDT-SWAP&period=5m&unit=0&limit=100',
  'taker-spot': 'https://www.okx.com/api/v5/rubik/stat/taker-volume?ccy=BTC&instType=SPOT&period=5m',
  'oi-hist': 'https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=1H&limit=30',
};
