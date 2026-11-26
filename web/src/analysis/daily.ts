// Clôtures quotidiennes d'un actif (/api/p1/daily) : comparaison d'actifs, onglets Nasdaq.
import { useEffect, useState } from 'react';
import type { DailyPoint } from './compare';

export const DAILY_IDS = ['BTC', 'ETH', 'QQQ', 'SPY', 'GLD', 'TLT', 'CPER', 'AUDJPY', 'VIX', 'VXN'] as const;
export type DailyId = typeof DAILY_IDS[number];
export const DAILY_LABEL: Record<DailyId, string> = {
  BTC: 'Bitcoin (BTC)', ETH: 'Ether (ETH)', QQQ: 'Nasdaq 100 (QQQ)', SPY: 'S&P 500 (SPY)', GLD: 'Or (GLD)', TLT: 'Obligations US 20 ans+ (TLT)',
  CPER: 'Cuivre (CPER)', AUDJPY: 'AUD/JPY', VIX: 'VIX (volatilité S&P 500)', VXN: 'VXN (volatilité Nasdaq 100)',
};
export interface DailyReply { configured: boolean; reason?: string; asset: string; label?: string; source?: string; unit?: string; points: DailyPoint[]; computed_ms: number }

export function useDaily(asset: string, days = 400): { reply: DailyReply | null; error: string | null } {
  const [reply, setReply] = useState<DailyReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setReply(null); setError(null);
    fetch(`/api/p1/daily?asset=${encodeURIComponent(asset)}&days=${days}`, { credentials: 'same-origin' })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<DailyReply>; })
      .then((d) => { if (live) setReply(d); }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [asset, days]);
  return { reply, error };
}

/** Raison d'absence d'une série (jamais une valeur inventée). */
export const dailyReason = (r: DailyReply | null, e: string | null) => e ? `série injoignable : ${e}` : !r ? 'chargement…'
  : !r.configured ? `non configuré : ${r.reason ?? ''}` : !r.points.length ? 'aucune clôture enregistrée' : null;
