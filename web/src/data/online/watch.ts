// Markets Watch en Mode Online (T-051) : /api/p1/watch relu toutes les 60 s (les cours changent
// toutes les 3 min au plus), sous la clé « watch:state » du store.

import { WATCH_KEY } from '../../watch/watch';
import { fetchJson } from '../gateway';
import { setValue } from '../store';

export const WATCH_EVERY_MS = 60_000;
export const WATCH_STATUS_KEY = '$watch-online';

export async function loadWatch(now: () => number = Date.now): Promise<void> {
  try {
    const r = await fetchJson<unknown>('/api/p1/watch', { timeoutMs: 10_000 });
    setValue(WATCH_KEY, r);
    setValue(WATCH_STATUS_KEY, { ok: true, reason: null, received_ms: now() });
  } catch (e) {
    setValue(WATCH_STATUS_KEY, { ok: false, reason: `watchlist injoignable : ${(e as Error).message}`, received_ms: now() });
  }
}

export function startWatchOnline(setTimer = setInterval, clearTimer = clearInterval): () => void {
  void loadWatch();
  const id = setTimer(() => void loadWatch(), WATCH_EVERY_MS);
  return () => clearTimer(id);
}
