// Alertes en Mode Online (plan « Tout en ligne », O4) : l'état publié par le moteur de
// l'Edge Function p1-jobs (alert:rule:<id>, alert:fired:<id>, alert:summary) arrive dans le
// store sous les mêmes clés que le bus de la passerelle ; l'écran /alertes, la cloche et le
// squawk n'ont pas à savoir d'où il vient.
//
// Données personnelles : jamais sur le canal Realtime public. Relu par /api/alerts/state
// (session du mot de passe d'application, T-031) toutes les 20 s, et juste après chaque
// écriture. Une clé absente de la réponse (règle supprimée) est retirée du store.

import { fetchJson } from '../gateway';
import { keysWithPrefix, setValue } from '../store';

export const ALERTS_STATUS_KEY = '$alerts-online';
export const ALERTS_EVERY_MS = 20_000;
const PREFIXES = ['alert:rule:', 'alert:fired:'];

export interface AlertsOnlineStatus { ok: boolean; reason: string | null; received_ms: number }

interface StateReply { items: [string, unknown][]; computed_ms: number }

/** Message lisible pour l'écran ; « session requise » renvoie vers le module Bourse. */
export function alertsProblem(message: string): string {
  const m = /^HTTP (\d{3})\s*(.*)$/s.exec(message);
  if (!m) return `injoignable : ${message}`;
  let detail = m[2];
  try { detail = String((JSON.parse(m[2]) as { detail?: unknown }).detail ?? m[2]); } catch { /* corps non JSON ou tronqué */ }
  if (m[1] === '401') return 'session requise : saisir le mot de passe d’application dans Bourse, puis revenir ici';
  return `${m[1] === '503' ? 'indisponible' : `HTTP ${m[1]}`} : ${detail}`;
}

export function applyAlertState(items: [string, unknown][]): void {
  const fresh = new Set(items.map(([k]) => k));
  for (const p of PREFIXES) for (const [k] of keysWithPrefix(p)) if (!fresh.has(k)) setValue(k, null);
  for (const [k, v] of items) setValue(k, v);
}

let inflight: Promise<void> | null = null;

export function loadAlerts(now: () => number = Date.now): Promise<void> {
  inflight ??= (async () => {
    try {
      const r = await fetchJson<StateReply>('/api/alerts/state', { timeoutMs: 10_000 });
      applyAlertState(r.items);
      setValue(ALERTS_STATUS_KEY, { ok: true, reason: null, received_ms: now() } satisfies AlertsOnlineStatus);
    } catch (e) {
      setValue(ALERTS_STATUS_KEY, { ok: false, reason: alertsProblem((e as Error).message), received_ms: now() } satisfies AlertsOnlineStatus);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

let active = false;

/** Relecture après une écriture de l'écran /alertes (sans effet hors Mode Online). */
export function refreshAlertsAfterWrite(): void {
  if (active) void loadAlerts();
}

export function startAlertsOnline(setTimer = setInterval, clearTimer = clearInterval): () => void {
  active = true;
  void loadAlerts();
  const id = setTimer(() => void loadAlerts(), ALERTS_EVERY_MS);
  return () => {
    active = false;
    clearTimer(id);
  };
}
