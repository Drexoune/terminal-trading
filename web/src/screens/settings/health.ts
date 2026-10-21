// Contrôles de santé des modes : bouton « Tester » de l'écran Paramètres et
// état du collecteur Supabase dans la barre de flux. Les fonctions de mise en
// forme sont pures (testées) ; les sondes passent par fetchJson (délai 5 s).

import type { Mode } from '../../config/modes';
import { fmtNumber, NBSP } from '../../lib/format';
import type { Freshness } from '../../data/latency';
import {
  describeFetchError, fetchCollectorHealth, fetchJson, PROBE_TIMEOUT_MS,
  type CollectorHealth, type HealthReply,
} from '../../data/gateway';

/** Le collecteur passe chaque minute : au-delà de 3 min sans passage, il est périmé. */
export const COLLECTOR_STALE_MS = 3 * 60_000;
/** Fréquence d'interrogation de GET /api/collector-health par la barre de flux. */
export const COLLECTOR_POLL_MS = 30_000;

/** Âge court : « 42 s », « 3 min », « 2 h ». */
export function fmtAge(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${Math.round(s)}${NBSP}s`;
  if (s < 3600) return `${Math.round(s / 60)}${NBSP}min`;
  return `${fmtNumber(s / 3600, s < 36_000 ? 1 : 0)}${NBSP}h`;
}

/** Hôte affiché d'une adresse (« 127.0.0.1:8710 », « tour.tailnet.ts.net »). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export interface CollectorStatus { state: Freshness; label: string }

/**
 * État du collecteur Supabase pour la barre de flux.
 * `elapsedMs` = temps écoulé depuis la réponse, pour que l'âge avance entre deux interrogations.
 */
export function collectorStatus(h: CollectorHealth | null, error: string | null, elapsedMs = 0): CollectorStatus {
  if (error) return { state: 'down', label: `injoignable : ${error}` };
  if (!h) return { state: 'down', label: 'en attente de la première interrogation' };
  if (!h.configured) return { state: 'down', label: `collecteur non configuré${h.reason ? ` : ${h.reason}` : ''}` };
  if (!h.last_run || h.age_ms == null) return { state: 'down', label: 'aucun passage enregistré' };
  const age = h.age_ms + Math.max(0, elapsedMs);
  if (age > COLLECTOR_STALE_MS) return { state: 'stale', label: `périmé · dernier passage il y a ${fmtAge(age)}` };
  if (!h.last_run.ok) {
    return { state: 'late', label: `dernier passage en échec${h.last_run.error ? ` : ${h.last_run.error}` : ''}` };
  }
  return { state: 'live', label: `à jour · dernier passage il y a ${fmtAge(age)}` };
}

// --- Bouton « Tester » ------------------------------------------------------

export interface ProbeResult {
  ok: boolean;
  /** Ligne principale : « Joignable · 45 ms · 127.0.0.1:8710 » ou « Injoignable : raison ». */
  text: string;
  /** Ligne complémentaire (Mode Online : état du collecteur Supabase). */
  detail?: string;
}

export function reachable(ms: number, host: string): string {
  return `Joignable · ${fmtNumber(ms, 0)}${NBSP}ms · ${host}`;
}

export function unreachable(reason: string): string {
  return `Injoignable : ${reason}`;
}

/** Mode Online : ligne du collecteur après GET /api/collector-health. */
export function collectorLine(h: CollectorHealth | null, error: string | null): string {
  if (error) return `Collecteur Supabase : injoignable (${error})`;
  if (!h) return 'Collecteur Supabase : collecteur non configuré';
  if (!h.configured) return `Collecteur Supabase : collecteur non configuré${h.reason ? ` (${h.reason})` : ''}`;
  if (!h.last_run || h.age_ms == null) return 'Collecteur Supabase : aucun passage enregistré';
  const when = `dernier passage il y a ${fmtAge(h.age_ms)}`;
  const failed = h.last_run.ok ? '' : ` · en échec${h.last_run.error ? ` : ${h.last_run.error}` : ''}`;
  const day = `${fmtNumber(h.runs_24h ?? 0, 0)} passages sur 24${NBSP}h, ${fmtNumber(h.failures_24h ?? 0, 0)} en échec, `
    + `${fmtNumber(h.gaps_24h ?? 0, 0)} minutes manquantes`;
  return `Collecteur Supabase : ${when}${failed} · ${day}`;
}

/** Avertit quand l'adresse testée sert la passerelle de l'autre mode (Mac testé en Mode Tour…). */
export function modeHintWarning(mode: Mode, hint: HealthReply['mode_hint']): string | undefined {
  if (!hint || hint === mode || mode === 'online') return undefined;
  const served = hint === 'local' ? 'la passerelle du Mac (Mode Local)' : 'la passerelle de la tour (Mode Tour)';
  return `Attention : cette adresse sert ${served}.`;
}

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await run();
  return { value, ms: performance.now() - t0 };
}

/**
 * Sonde un mode : passerelle (GET <url>/api/health), ou fonctions Vercel de la
 * même origine (GET /api/health puis /api/collector-health) en Mode Online.
 */
export async function probe(mode: Mode, url: string, signal?: AbortSignal): Promise<ProbeResult> {
  const base = mode === 'online' ? '' : url;
  let health: { value: HealthReply; ms: number };
  try {
    health = await timed(() => fetchJson<HealthReply>('/api/health', { base, signal, timeoutMs: PROBE_TIMEOUT_MS }));
  } catch (e) {
    return { ok: false, text: unreachable((e as Error).message || describeFetchError(e)) };
  }
  const reply = health.value;
  const host = mode === 'online'
    // « vercel · eea · cdg1 » : plateforme, domaine OKX, région d'exécution de la fonction.
    ? (reply.host ? [reply.host, reply.region, reply.fn_region].filter(Boolean).join(' · ') : location.host)
    // Nom de la machine (Mac ou tour) quand la passerelle le donne : il distingue
    // deux passerelles derrière des adresses semblables.
    : `${hostOf(url)}${reply.host ? ` · ${reply.host}` : ''}`;
  const text = reachable(health.ms, host);
  if (mode !== 'online') return { ok: true, text, detail: modeHintWarning(mode, reply.mode_hint) };
  try {
    const h = await fetchCollectorHealth(signal);
    return { ok: true, text, detail: collectorLine(h, null) };
  } catch (e) {
    return { ok: true, text, detail: collectorLine(null, (e as Error).message) };
  }
}
