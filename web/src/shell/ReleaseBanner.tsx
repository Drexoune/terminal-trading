// Bandeau de publication (étape E3, docs/plan-p1.md § 7.7) : la dernière publication
// captée sur bls.gov, sur tous les écrans, pendant 15 minutes. Une fois le chiffre
// peint, l'heure d'affichage (horloge de la passerelle, ou horloge OKX en Mode Online)
// repart vers la passerelle (op « displayed ») ou vers /api/p1/displayed en Mode Online :
// c'est la mesure de la porte P1.

import { useEffect } from 'react';
import { Missing } from '../components/ui';
import {
  bannerVisible, figures, fmtDelay, fmtFigure, surpriseText, type ReleaseFigure, type ReleaseLast,
} from '../calendar/releases';
import { fmtValue } from '../calendar/calendar';
import { getSettings } from '../config/settings';
import { reportDisplayed } from '../data/online/p1';
import { gatewayNow, sendToGateway, useKeys, useValue } from '../data/store';
import { useNow } from './useNow';

/** Une publication ne compte comme « affichée » qu'à l'arrivée, pas une heure plus tard. */
const ACK_WINDOW_MS = 60_000;
const acked = new Set<string>();

function ackDisplayed(keys: string[], busMs: number): void {
  const todo = keys.filter((k) => !acked.has(k));
  if (!todo.length) return;
  // Deux images : la première est peinte quand le rappel de la seconde s'exécute.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const t = Math.round(gatewayNow());
    if (t - busMs > ACK_WINDOW_MS) return;
    for (const key of todo) {
      acked.add(key);
      if (getSettings().mode === 'online') void reportDisplayed(key, t);
      else sendToGateway({ op: 'displayed', key, t_gateway_ms: t });
    }
  }));
}

export function ReleaseBanner() {
  const now = useNow();
  const last = useValue<ReleaseLast>('release:last');
  const all = figures(useKeys<unknown>('release:'));
  const byKey = new Map(all);
  const shown = last && bannerVisible(last, now)
    ? last.keys.map((k) => [k, byKey.get(k)] as const).filter((x): x is readonly [string, ReleaseFigure] => !!x[1])
    : [];
  const keyList = shown.map(([k]) => k).join(',');

  useEffect(() => {
    if (last && keyList) ackDisplayed(keyList.split(','), last.bus_ms);
  }, [keyList, last]);

  if (!last || !shown.length) return null;
  const head = shown[0][1];
  return (
    <section className="release-banner" role="status" aria-live="assertive" data-testid="release-banner">
      <span className="lbl lbl--s release-banner__src">
        BLS · {last.title}{last.edition === 'Revised' ? ' (révisé)' : ''} · {last.period}
        {last.timing !== 'attendue' && <span className="release-banner__warn"> · publié {last.timing}</span>}
      </span>
      <span className="release-banner__figs">
        {shown.map(([k, f]) => {
          const s = surpriseText(f);
          return (
            <span key={k} className="release-banner__fig" data-testid="release-figure">
              <span className="release-banner__label">{f.label_fr ?? f.indicator}</span>
              <span className="num release-banner__value">{f.value === null ? <Missing reason={f.reason ?? 'chiffre non lu'} /> : fmtFigure(f)}</span>
              {f.forecast !== null && <span className="num lbl--s">prév. {fmtValue(f.forecast, f.unit, f.forecast_raw)}</span>}
              {f.surprise !== null && <span className={`num lbl--s${s.tone ? ` tone-${s.tone}` : ''}`} title={s.reason ?? undefined}>{s.text}</span>}
            </span>
          );
        })}
      </span>
      <span className="num lbl--s release-banner__timing" title={head.clock_corrected ? 'délais sur l’horloge OKX' : 'délais sur l’horloge du Mac (OKX indisponible)'}>
        capté {fmtDelay(head.capture_delay_ms)} après {new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(head.scheduled_ms)}
        {typeof head.display_delay_ms === 'number' && <> · affiché {fmtDelay(head.display_delay_ms)}</>}
      </span>
    </section>
  );
}
