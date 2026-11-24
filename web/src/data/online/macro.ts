// Écrans Heatmap et Macro en Mode Online (plan P3, M5) : /api/macro/state relu toutes les 5 min
// (les scores changent toutes les 10 min au plus, les séries une fois par jour), sous la clé
// « macro:state » ; le flux macro passe dans la barre de flux. Les séries se lisent à la demande.

import { MACRO_KEY, seriesKey, type MacroReply, type SeriesReply } from '../../macro/macro';
import { fetchJson } from '../gateway';
import { setValue } from '../store';

export const MACRO_EVERY_MS = 5 * 60_000;
export const MACRO_STATUS_KEY = '$macro-online';

export async function loadMacro(now: () => number = Date.now): Promise<void> {
  try {
    const r = await fetchJson<MacroReply>('/api/macro/state', { timeoutMs: 10_000 });
    setValue(MACRO_KEY, r);
    if (r.feed) setValue('feed:macro', r.feed);
    setValue(MACRO_STATUS_KEY, { ok: true, reason: null, received_ms: now() });
  } catch (e) {
    setValue(MACRO_STATUS_KEY, { ok: false, reason: `données macro injoignables : ${(e as Error).message}`, received_ms: now() });
  }
}

export async function loadMacroSeries(economy: string, indicator: string, years: number): Promise<void> {
  const r = await fetchJson<SeriesReply>(`/api/macro/series?economy=${encodeURIComponent(economy)}&indicator=${encodeURIComponent(indicator)}&years=${years}`,
    { timeoutMs: 15_000 });
  setValue(seriesKey(economy, indicator, years), r);
}

export function startMacroOnline(setTimer = setInterval, clearTimer = clearInterval): () => void {
  void loadMacro();
  const id = setTimer(() => void loadMacro(), MACRO_EVERY_MS);
  return () => clearTimer(id);
}
