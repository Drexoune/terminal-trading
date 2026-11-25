// Statistiques publiques d'OKX pour la microstructure (P5, T-068) : `www.okx.com` sert ces
// historiques (EEA les renvoie vides, T-067) mais sans en-tête CORS : le navigateur ne peut pas
// les lire. La fonction les relaie telles quelles, sur une liste blanche fixe, sans paramètre libre.
// Mise en cache au CDN : la statistique change toutes les 5 min (volume preneur) ou toutes les
// heures (OI) ; tous les onglets partagent donc les mêmes appels à OKX.

import { HttpError } from './http.js';
import { OKX_TIMEOUT_MS, OkxError, type OkxDeps } from './okx.js';

export const OKX_WWW_V5 = 'https://www.okx.com/api/v5';

export const OKX_STATS = {
  'taker-perp': { url: `${OKX_WWW_V5}/rubik/stat/taker-volume-contract?instId=BTC-USDT-SWAP&period=5m&unit=0&limit=100`, cache: 'public, max-age=0, s-maxage=60' },
  'taker-spot': { url: `${OKX_WWW_V5}/rubik/stat/taker-volume?ccy=BTC&instType=SPOT&period=5m`, cache: 'public, max-age=0, s-maxage=60' },
  'oi-hist': { url: `${OKX_WWW_V5}/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=1H&limit=30`, cache: 'public, max-age=0, s-maxage=300' },
} as const;
export type OkxStat = keyof typeof OKX_STATS;

export function okxStatName(raw: string): OkxStat {
  if (!(raw in OKX_STATS)) throw new HttpError(404, `statistique inconnue : ${raw.slice(0, 40)} (attendues : ${Object.keys(OKX_STATS).join(', ')})`);
  return raw as OkxStat;
}

/** Réponse d'OKX inchangée ({ code: "0", data, msg }) ; tout autre code est une erreur amont. */
export async function fetchOkxStat(deps: OkxDeps, stat: OkxStat): Promise<unknown> {
  let res: Response;
  try {
    res = await deps.fetch(OKX_STATS[stat].url, { signal: AbortSignal.timeout(OKX_TIMEOUT_MS) });
  } catch (e) {
    throw new OkxError('statistique injoignable', (e as Error).message);
  }
  if (!res.ok) throw new OkxError(`statistique en erreur HTTP ${res.status}`);
  const body = await res.json().catch(() => null) as { code?: string; msg?: string; data?: unknown } | null;
  if (!body || body.code !== '0' || !Array.isArray(body.data)) throw new OkxError('statistique refusée', `${body?.code ?? '?'} ${body?.msg ?? ''}`.trim());
  return body;
}
