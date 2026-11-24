// Écran Taux en Mode Online (plan P2, R3) : /api/rates/state relu toutes les 30 s (la tâche rates
// tourne chaque minute), sous la clé « rates:state » ; les flux Polymarket, Kalshi et BIS passent
// dans la barre de flux (clés feed:…). L'évolution d'une réunion est lue à la demande de l'écran.

import { historyKey, RATES_KEY, type HistoryReply, type RatesReply } from '../../rates/rates';
import { fetchJson } from '../gateway';
import { setValue } from '../store';

export const RATES_EVERY_MS = 30_000;
export const RATES_STATUS_KEY = '$rates-online';

export async function loadRates(now: () => number = Date.now): Promise<void> {
  try {
    const r = await fetchJson<RatesReply>('/api/rates/state', { timeoutMs: 10_000 });
    setValue(RATES_KEY, r);
    for (const f of r.feeds ?? []) setValue(`feed:${f.name}`, f);
    setValue(RATES_STATUS_KEY, { ok: true, reason: null, received_ms: now() });
  } catch (e) {
    setValue(RATES_STATUS_KEY, { ok: false, reason: `écran Taux injoignable : ${(e as Error).message}`, received_ms: now() });
  }
}

/** Évolution des probabilités d'une réunion (60 jours), sous « rates:history:<BANQUE>:<date> ». */
export async function loadRatesHistory(bank: string, meeting: string): Promise<void> {
  const r = await fetchJson<HistoryReply>(`/api/rates/history?bank=${encodeURIComponent(bank)}&meeting=${encodeURIComponent(meeting)}&days=60`,
    { timeoutMs: 15_000 });
  setValue(historyKey(bank, meeting), r);
}

export function startRatesOnline(setTimer = setInterval, clearTimer = clearInterval): () => void {
  void loadRates();
  const id = setTimer(() => void loadRates(), RATES_EVERY_MS);
  return () => clearTimer(id);
}
