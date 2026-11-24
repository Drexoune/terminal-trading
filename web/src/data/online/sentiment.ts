// Écrans de P4 en Mode Online (sentiment et liquidité) : les 5 routes de /api/sentiment relues
// toutes les 5 min (ratios publiés tous les quarts d'heure, le reste au plus une fois par jour),
// sous les clés sentiment:<route> ; chaque flux passe dans la barre de flux (feed:<nom>).

import { ROUTES, sentimentKey, type BanksReply, type Reply, type Route } from '../../sentiment/sentiment';
import { fetchJson } from '../gateway';
import { setValue } from '../store';

export const SENTIMENT_EVERY_MS = 5 * 60_000;
export const SENTIMENT_STATUS_KEY = '$sentiment-online';

export async function loadSentiment(now: () => number = Date.now, fetcher: typeof fetchJson = fetchJson): Promise<void> {
  const errors: string[] = [];
  await Promise.all(ROUTES.map(async (r: Route) => {
    try {
      const reply = await fetcher<Reply<unknown>>(`/api/sentiment/${r}`, { timeoutMs: 10_000 });
      setValue(sentimentKey(r), reply);
      if (reply.feed) setValue(`feed:${reply.feed.name}`, reply.feed);
      const b = reply as BanksReply;
      if (r === 'banks' && b.bpr_feed) setValue(`feed:${b.bpr_feed.name}`, b.bpr_feed);
    } catch (e) { errors.push(`${r} : ${(e as Error).message}`); }
  }));
  setValue(SENTIMENT_STATUS_KEY, { ok: errors.length === 0, reason: errors.length ? `données de sentiment injoignables (${errors.join(' ; ')})` : null, received_ms: now() });
}

export function startSentimentOnline(setTimer = setInterval, clearTimer = clearInterval): () => void {
  void loadSentiment();
  const id = setTimer(() => void loadSentiment(), SENTIMENT_EVERY_MS);
  return () => clearTimer(id);
}
