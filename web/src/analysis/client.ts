// Lecture des analyses de P7 (T-075) écrites par la machine Oracle : /api/p1/analysis?key=…
// Rafraîchies à intervalle fixe ; « périmé » au-delà du seuil de chaque clé (fraîcheur, CLAUDE.md § 3).

import { useEffect, useState } from 'react';

export type AnalysisKey = 'season:BTC' | 'season:ETH' | 'season:QQQ' | 'season:SPY' | 'tech' | 'options' | 'options-history' | 'research';

/** Rafraîchissement et seuil de péremption par clé (ms). */
export const FRESH: Record<string, { refresh: number; stale: number; label: string }> = {
  season: { refresh: 30 * 60_000, stale: 26 * 3_600_000, label: 'calcul de nuit (machine Oracle)' },
  tech: { refresh: 5 * 60_000, stale: 2 * 3_600_000, label: 'calcul horaire (machine Oracle)' },
  options: { refresh: 60_000, stale: 15 * 60_000, label: 'relevé toutes les 5 min (machine Oracle)' },
  'options-history': { refresh: 10 * 60_000, stale: 2 * 3_600_000, label: 'historique horaire (machine Oracle)' },
  research: { refresh: 5 * 60_000, stale: 60 * 60_000, label: 'flux lu toutes les 15 min (machine Oracle)' },
};
export const freshOf = (key: AnalysisKey) => FRESH[key.split(':')[0]];

export interface AnalysisReply<T> { configured: boolean; reason?: string; value: T | null; updated_ms: number | null; computed_ms: number }
export interface AnalysisState<T> { value: T | null; updated: number | null; stale: boolean; reason: string | null; loading: boolean }

/** État d'une analyse : valeur, heure d'écriture, périmée ou non, raison d'absence (jamais une valeur inventée). */
export function analysisState<T>(reply: AnalysisReply<T> | null, error: string | null, now: number, staleMs: number): AnalysisState<T> {
  if (error) return { value: null, updated: null, stale: false, reason: `analyses injoignables : ${error}`, loading: false };
  if (!reply) return { value: null, updated: null, stale: false, reason: 'chargement…', loading: true };
  if (!reply.configured) return { value: null, updated: null, stale: false, reason: `non configuré : ${reply.reason ?? ''}`, loading: false };
  if (reply.value === null) return { value: null, updated: null, stale: false, reason: 'pas encore calculé par la machine Oracle', loading: false };
  return { value: reply.value, updated: reply.updated_ms, stale: reply.updated_ms !== null && now - reply.updated_ms > staleMs, reason: null, loading: false };
}

export function useAnalysis<T>(key: AnalysisKey): AnalysisState<T> {
  const [reply, setReply] = useState<AnalysisReply<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const f = freshOf(key);
  useEffect(() => {
    let live = true;
    setReply(null);
    const load = () => fetch(`/api/p1/analysis?key=${encodeURIComponent(key)}`, { credentials: 'same-origin' })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<AnalysisReply<T>>; })
      .then((d) => { if (live) { setReply(d); setError(null); setNow(Date.now()); } })
      .catch((e: unknown) => { if (live) setError((e as Error).message); });
    void load();
    const id = setInterval(load, f.refresh);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => { live = false; clearInterval(id); clearInterval(tick); };
  }, [key, f.refresh]);
  return analysisState(reply, error, now, f.stale);
}
