// Routes REST du mode actif : la passerelle (Modes Local et Tour) ou les
// fonctions Vercel servies par la même origine que le front (Mode Online).
// Aucune adresse n'est figée au build : elle vient des réglages de l'appareil
// (config/settings.ts), et aucune réponse ne contient de secret.

import { restBase } from '../config/modes';
import { getSettings } from '../config/settings';
import type { ChartData } from './protocol';

export const NOT_CONFIGURED = 'Mode Tour : adresse de la tour non configurée';

/** Délai maximal d'une requête de contrôle (bouton « Tester », santé du collecteur). */
export const PROBE_TIMEOUT_MS = 5_000;

export interface FetchOptions {
  signal?: AbortSignal;
  /** Base explicite (adresse en cours de saisie) ; par défaut, celle du mode actif. */
  base?: string | null;
  timeoutMs?: number;
}

/** Raison lisible d'un échec réseau, pour « Injoignable : … ». */
export function describeFetchError(e: unknown, timedOut = false): string {
  if (timedOut) return 'délai dépassé';
  const err = e as Error;
  if (err?.name === 'AbortError') return 'requête annulée';
  // fetch ne distingue pas réseau coupé, CORS refusé et certificat invalide.
  if (err instanceof TypeError) return 'aucune réponse (réseau, origine refusée ou certificat)';
  return String(err?.message ?? e);
}

/** GET JSON sur la base du mode actif (ou `base`), avec délai maximal optionnel. */
export async function fetchJson<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const base = opts.base === undefined ? restBase(getSettings()) : opts.base;
  if (base === null) throw new Error(NOT_CONFIGURED);
  const ctl = new AbortController();
  const forward = () => ctl.abort();
  opts.signal?.addEventListener('abort', forward);
  if (opts.signal?.aborted) ctl.abort();
  let timedOut = false;
  const timer = opts.timeoutMs
    ? setTimeout(() => { timedOut = true; ctl.abort(); }, opts.timeoutMs) : undefined;
  try {
    let r: Response;
    try {
      r = await fetch(`${base}${path}`, { signal: ctl.signal, headers: { accept: 'application/json' } });
    } catch (e) {
      throw new Error(describeFetchError(e, timedOut));
    }
    if (!r.ok) {
      const body = (await r.text().catch(() => '')).slice(0, 160);
      throw new Error(`HTTP ${r.status}${body ? ` ${body}` : ''}`);
    }
    try {
      return (await r.json()) as T;
    } catch {
      throw new Error(timedOut ? 'délai dépassé' : 'réponse illisible (pas du JSON)');
    }
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener('abort', forward);
  }
}

/** Délai maximal d'un chargement de graphique : au-delà, « — » avec la raison plutôt qu'un chargement sans fin. */
export const CHART_TIMEOUT_MS = 15_000;

export async function fetchChart(inst: string, range: ChartData['range'],
  signal?: AbortSignal): Promise<ChartData> {
  return fetchJson<ChartData>(`/api/chart?inst=${encodeURIComponent(inst)}&range=${range}`,
    { signal, timeoutMs: CHART_TIMEOUT_MS });
}

// --- Santé (bouton « Tester », barre de flux) ----------------------------------

/** Réponse de GET /api/health : passerelle Python ou fonction Vercel (champs utiles seulement). */
export interface HealthReply {
  app?: string; version?: string; mode?: string; host?: string; region?: string; ts?: number;
  mode_hint?: 'local' | 'tour' | null;   // passerelle : mode annoncé par GATEWAY_MODE
  fn_region?: string | null;             // fonction Vercel : région d'exécution
}

/** Réponse de GET /api/collector-health (fonction Vercel du Mode Online). */
export interface CollectorHealth {
  configured: boolean;
  last_run: { started_at: string; finished_at: string | null; ok: boolean; error: string | null; rows: number | null } | null;
  age_ms: number | null;
  // null quand configured vaut false
  runs_24h: number | null; failures_24h: number | null; gaps_24h: number | null;
  reason?: string;   // pourquoi le collecteur n'est pas configuré (variable absente, mauvaise clé…)
  source: string;
}

export const fetchCollectorHealth = (signal?: AbortSignal) =>
  fetchJson<CollectorHealth>('/api/collector-health', { signal, base: '', timeoutMs: PROBE_TIMEOUT_MS });
