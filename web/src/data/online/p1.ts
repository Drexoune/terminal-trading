// P1 en Mode Online (plan « Tout en ligne », O2) : l'état publié par l'Edge Function p1-jobs
// (table p1_state) est relu par /api/p1/state et rangé dans le store sous les mêmes clés que
// le bus de la passerelle (calendar:week:…, calendar:official, feed:calendar…) : les écrans
// n'ont pas à savoir d'où viennent les données. Relecture toutes les 5 minutes (l'agenda est
// horaire) ; à l'étape O5, Supabase Realtime poussera les changements.
//
// calendar:next (cinq prochains événements Fort ou Moyen) est recalculé ici toutes les 30 s,
// comme la passerelle le fait de son côté.

import { nextEvents, type CalendarWeek } from '../../calendar/calendar';
import { fetchJson } from '../gateway';
import { keysWithPrefix, setValue } from '../store';

export const P1_STATUS_KEY = '$p1-online';
export const STATE_EVERY_MS = 5 * 60_000;
export const NEXT_EVERY_MS = 30_000;

export interface P1Status { configured: boolean | null; reason: string | null; received_ms: number | null }

interface StateReply { configured: boolean; reason?: string; items: [string, unknown][]; computed_ms: number }

export function refreshNext(now: number): void {
  const weeks = keysWithPrefix<CalendarWeek>('calendar:week:');
  if (!weeks.length) return;
  setValue('calendar:next', nextEvents(weeks[weeks.length - 1][1], now));
}

export async function loadState(now: () => number = Date.now): Promise<void> {
  try {
    const r = await fetchJson<StateReply>('/api/p1/state', { timeoutMs: 10_000 });
    for (const [k, v] of r.items) setValue(k, v);
    setValue(P1_STATUS_KEY, { configured: r.configured, reason: r.configured ? null : r.reason ?? 'non configuré', received_ms: now() } satisfies P1Status);
    refreshNext(now());
  } catch (e) {
    setValue(P1_STATUS_KEY, { configured: null, reason: `agenda en ligne injoignable : ${(e as Error).message}`, received_ms: now() } satisfies P1Status);
  }
}

/** Démarre la relecture ; renvoie de quoi l'arrêter (changement de mode). */
export function startP1Online(): () => void {
  void loadState();
  const a = setInterval(() => void loadState(), STATE_EVERY_MS);
  const b = setInterval(() => refreshNext(Date.now()), NEXT_EVERY_MS);
  return () => { clearInterval(a); clearInterval(b); };
}
