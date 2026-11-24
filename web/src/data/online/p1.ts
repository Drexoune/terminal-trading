// P1 en Mode Online (plan « Tout en ligne », O2 et O5) : l'état publié par l'Edge Function p1-jobs
// (table p1_state) arrive dans le store sous les mêmes clés que le bus de la passerelle
// (calendar:week:…, release:…, reaction:…, release:state…) : les écrans n'ont pas à savoir
// d'où viennent les données.
//
// - Supabase Realtime (canal public « p1-public », T-043) pousse chaque changement : un chiffre
//   capté arrive en quelques centaines de millisecondes.
// - /api/p1/state est relu au démarrage, puis toutes les 5 minutes (filet de sécurité), et
//   toutes les 15 secondes quand Realtime est coupé ou non configuré.
// - calendar:next (cinq prochains événements Fort ou Moyen) est recalculé toutes les 30 s.
// - L'heure d'affichage d'un chiffre capté repart vers /api/p1/displayed (mesure de la porte).
// - Les alertes (O4, données personnelles) sont relues à part : ./alerts.ts.

import { nextEvents, type CalendarWeek } from '../../calendar/calendar';
import { fetchJson } from '../gateway';
import { keysWithPrefix, setValue } from '../store';
import { startAlertsOnline } from './alerts';
import { startWatchOnline } from './watch';
import { startRatesOnline } from './rates';
import { startMacroOnline } from './macro';
import { startSentimentOnline } from './sentiment';
import { connectRealtime, realtimeConfig, type RealtimeStatus, type StateMessage } from './realtime';

export const P1_STATUS_KEY = '$p1-online';
export const STATE_EVERY_MS = 5 * 60_000;
export const STATE_EVERY_DEGRADED_MS = 15_000;
export const NEXT_EVERY_MS = 30_000;

export interface P1Status {
  configured: boolean | null;
  reason: string | null;
  received_ms: number | null;
  realtime?: RealtimeStatus;
  realtime_reason?: string | null;
  last_push_ms?: number | null;
}

interface StateReply { configured: boolean; reason?: string; items: [string, unknown][]; computed_ms: number }

let status: P1Status = { configured: null, reason: null, received_ms: null, realtime: 'connexion', realtime_reason: null, last_push_ms: null };

function setStatus(patch: Partial<P1Status>): void {
  status = { ...status, ...patch };
  setValue(P1_STATUS_KEY, status);
}

export function refreshNext(now: number): void {
  const weeks = keysWithPrefix<CalendarWeek>('calendar:week:');
  if (!weeks.length) return;
  setValue('calendar:next', nextEvents(weeks[weeks.length - 1][1], now));
}

export async function loadState(now: () => number = Date.now): Promise<void> {
  try {
    const r = await fetchJson<StateReply>('/api/p1/state', { timeoutMs: 10_000 });
    for (const [k, v] of r.items) setValue(k, v);
    setStatus({ configured: r.configured, reason: r.configured ? null : r.reason ?? 'non configuré', received_ms: now() });
    refreshNext(now());
  } catch (e) {
    setStatus({ configured: null, reason: `agenda en ligne injoignable : ${(e as Error).message}`, received_ms: now() });
  }
}

/** Message Realtime : même effet qu'une valeur reçue de la passerelle. */
export function applyPush(m: StateMessage, now: number): void {
  setValue(m.key, m.value);
  if (m.key.startsWith('calendar:week:')) refreshNext(now);
  setStatus({ last_push_ms: now });
}

/** Heure d'affichage d'un chiffre capté (horloge OKX du navigateur), pour la porte P1. */
export async function reportDisplayed(key: string, displayMs: number): Promise<void> {
  try {
    await fetchJson('/api/p1/displayed', { method: 'POST', json: { key, display_ms: displayMs }, timeoutMs: 8_000 });
  } catch (e) {
    console.warn(`heure d’affichage de ${key} non transmise : ${(e as Error).message}`);
  }
}

export interface OnlineDeps {
  connect?: typeof connectRealtime;
  load?: () => Promise<void>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  /** Alertes en ligne (O4), relues derrière le mot de passe ; remplaçable en test. */
  startAlerts?: () => () => void;
  /** Markets Watch (T-051), relu toutes les 60 s ; remplaçable en test. */
  startWatch?: () => () => void;
  /** Écran Taux (P2), relu toutes les 30 s ; remplaçable en test. */
  startRates?: () => () => void;
  /** Écrans Heatmap et Macro (P3), relus toutes les 5 min ; remplaçable en test. */
  startMacro?: () => () => void;
  startSentiment?: () => () => void;
}

/** Démarre Realtime et la relecture ; renvoie de quoi tout arrêter (changement de mode). */
export function startP1Online(deps: OnlineDeps = {}): () => void {
  const connect = deps.connect ?? connectRealtime;
  const load = deps.load ?? (() => loadState());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let live = false;
  let stopped = false;
  let timer: unknown = null;
  const schedule = () => {
    if (stopped) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { void load().finally(schedule); }, live ? STATE_EVERY_MS : STATE_EVERY_DEGRADED_MS);
  };
  void load().finally(schedule);
  const disconnect = connect(realtimeConfig(), (m) => applyPush(m, Date.now()), (s, why) => {
    const wasLive = live;
    live = s === 'connecté';
    setStatus({ realtime: s, realtime_reason: why ?? null });
    // Reconnecté : on relit tout, un message a pu passer pendant la coupure.
    if (live && !wasLive) void load();
    if (live !== wasLive) schedule();
  });
  const next = setInterval(() => refreshNext(Date.now()), NEXT_EVERY_MS);
  const stopAlerts = (deps.startAlerts ?? startAlertsOnline)();
  const stopWatch = (deps.startWatch ?? startWatchOnline)();
  const stopRates = (deps.startRates ?? startRatesOnline)();
  const stopMacro = (deps.startMacro ?? startMacroOnline)();
  const stopSentiment = (deps.startSentiment ?? startSentimentOnline)();
  return () => {
    stopped = true;
    stopAlerts();
    stopWatch();
    stopRates();
    stopMacro();
    stopSentiment();
    if (timer !== null) clearTimer(timer);
    clearInterval(next);
    disconnect();
  };
}
