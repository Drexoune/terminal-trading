// Annonces (E4) : chaque alerte et chaque chiffre capté qui ARRIVENT pendant que la page est
// ouverte déclenchent son, notification et voix. Rien n'est rejoué au chargement : seul ce
// qui a moins d'une minute (horloge de la passerelle) est annoncé, une fois.

import { useEffect } from 'react';
import type { AlertEvent } from '../alerts/alerts';
import type { ReleaseFigure, ReleaseLast } from '../calendar/releases';
import { gatewayNow, getValue, keysWithPrefix, subscribeKey, subscribePrefix } from '../data/store';
import { squawk } from './engine';
import { alertPhrase, releasePhrase } from './speech';

export const FRESH_MS = 60_000;

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
      if (!fresh(last.bus_ms)) return;
      const figs = last.keys.map((k) => getValue<ReleaseFigure>(k)).filter((f): f is ReleaseFigure => !!f);
      squawk.beep('chiffre');
      if (squawk.get().prefs.figures && figs.length) {
        squawk.say({ id: `chiffre:${id}`, kind: 'chiffre', text: releasePhrase(last, figs), lang: 'fr', created_ms: Date.now() });
      }
    };

    const offA = subscribePrefix('alert:fired:', onAlerts);
    const offR = subscribeKey('release:last', onRelease);
    onAlerts();
    onRelease();
    return () => { offA(); offR(); };
  }, []);
}
