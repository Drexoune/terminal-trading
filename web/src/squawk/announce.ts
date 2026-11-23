// Annonces (E4, E6) : chaque alerte, chaque chiffre capté et chaque titre urgent qui ARRIVENT pendant que la page est
// ouverte déclenchent son, notification et voix. Rien n'est rejoué au chargement : seul ce
// qui a moins d'une minute (horloge de la passerelle) est annoncé, une fois.

import { useEffect } from 'react';
import type { AlertEvent } from '../alerts/alerts';
import type { ReleaseFigure, ReleaseLast } from '../calendar/releases';
import type { NewsItem } from '../news/news';
import { gatewayNow, getValue, keysWithPrefix, subscribeKey, subscribePrefix } from '../data/store';
import { squawk } from './engine';
import { alertPhrase, releasePhrase } from './speech';

export const FRESH_MS = 60_000;
/** Publication de plus de 2 h (rattrapage d'un arriéré) : ni son ni voix, comme la passerelle. */
export const PUBLICATION_MAX_AGE_MS = 2 * 3_600_000;

export function useAnnouncements(): void {
  useEffect(() => {
    const seen = new Set<string>();
    const fresh = (t: number | null | undefined) => typeof t === 'number' && gatewayNow() - t < FRESH_MS;

    const onAlerts = () => {
      for (const [, ev] of keysWithPrefix<AlertEvent>('alert:fired:')) {
        if (!ev || seen.has(ev.id)) continue;
        seen.add(ev.id);
        if (!fresh(ev.fired_ms) || ev.acked_ms) continue;
        squawk.notify(ev.title, ev.body ?? '', `alerte-${ev.id}`);
        // Un chiffre publié a sa propre annonce, plus complète (ci-dessous).
        if (ev.kind === 'release') continue;
        squawk.beep('alerte');
        if (ev.voice && squawk.get().prefs.alerts) {
          squawk.say({ id: `alerte:${ev.id}`, kind: 'alerte', text: alertPhrase(ev), lang: 'fr', created_ms: Date.now() });
        }
      }
    };

    const onRelease = () => {
      const last = getValue<ReleaseLast & { nature?: string }>('release:last');
      if (!last) return;
      const id = `${last.release}|${last.ny_date}|${last.period}|${last.edition ?? ''}`;
      if (seen.has(id)) return;
      seen.add(id);
      if (!fresh(last.bus_ms) || gatewayNow() - last.scheduled_ms > PUBLICATION_MAX_AGE_MS) return;
      const figs = last.keys.map((k) => getValue<ReleaseFigure>(k)).filter((f): f is ReleaseFigure => !!f);
      squawk.beep('chiffre');
      if (squawk.get().prefs.figures && figs.length) {
        squawk.say({ id: `chiffre:${id}`, kind: 'chiffre', text: releasePhrase(last, figs), lang: 'fr', created_ms: Date.now() });
      }
    };

    // Titres urgents (E6/O6) : dans leur langue d'origine, une seule fois, jamais un arriéré.
    const onNews = () => {
      for (const [, it] of keysWithPrefix<NewsItem>('news:item:')) {
        if (!it || seen.has(`titre:${it.id}`)) continue;
        seen.add(`titre:${it.id}`);
        if (!it.urgent || it.backfill || !fresh(it.received_ms)) continue;
        squawk.notify(it.title, `${it.source} · VO`, `titre-${it.id}`);
        if (squawk.get().prefs.headlines) {
          squawk.say({ id: `titre:${it.id}`, kind: 'titre', text: it.title, lang: it.lang === 'fr' ? 'fr' : 'en', created_ms: Date.now() });
        }
      }
    };

    const offA = subscribePrefix('alert:fired:', onAlerts);
    const offR = subscribeKey('release:last', onRelease);
    const offN = subscribePrefix('news:item:', onNews);
    onAlerts();
    onRelease();
    onNews();
    return () => { offA(); offR(); offN(); };
  }, []);
}
