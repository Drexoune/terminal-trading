// Barre du haut (E4) : bouton « Activer voix et son » et cloche des alertes.
// La cloche porte la pastille or de la maquette Main quand une alerte attend d'être
// acquittée ; son panneau liste les dernières, avec « Tout acquitter » et le lien /alertes.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ackAlerts, sortEvents, telegramText, unacked, type AlertEvent, type AlertSummary } from '../alerts/alerts';
import { useKeys, useValue } from '../data/store';
import { fmtHm } from '../lib/time';
import { squawk, useSquawk } from '../squawk/engine';
import { useNow } from './useNow';

export const ALERTS_PATH = '/alertes';

export function VoiceButton() {
  const s = useSquawk();
  const label = !s.supported.speech && !s.supported.audio ? 'Voix et son indisponibles dans ce navigateur'
    : s.enabled ? (s.leader ? 'Voix et son activés (cliquer pour couper)' : 'Voix active dans un autre onglet')
      : 'Activer voix et son';
  return (
    <button type="button" className={`ib ib--boxed voice-btn${s.enabled ? ' voice-btn--on' : ''}`}
      aria-label={label} title={label} aria-pressed={s.enabled} data-testid="voice-button"
      onClick={() => { if (s.enabled) squawk.disable(); else void squawk.enable(); }}>
      <Icon name="squawk" />
    </button>
  );
}

export function Bell() {
  const now = useNow();
  const summary = useValue<AlertSummary>('alert:summary');
  const events = sortEvents(useKeys<AlertEvent>('alert:fired:').map(([, e]) => e));
  const open = unacked(events, now);
  const [shown, setShown] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!shown) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setShown(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [shown]);

  const count = summary?.unacked ?? open.length;
  const label = summary === undefined ? 'Alertes : service alert non reçu'
    : count ? `Alertes : ${count} à acquitter` : 'Alertes : aucune à acquitter';
  return (
    <span className="bell" ref={ref}>
      <button type="button" className="ib ib--boxed" aria-label={label} title={label} aria-expanded={shown}
        data-testid="bell" onClick={() => setShown((v) => !v)}>
        <Icon name="bell" />
      </button>
      {count > 0 && <span className="bell__badge" data-testid="bell-badge" aria-hidden="true" />}
      {shown && (
        <div className="bell-pop" role="dialog" aria-label="Dernières alertes">
          <div className="bell-pop__head">
            <span className="lbl gold">Alertes{count ? ` · ${count} à acquitter` : ''}</span>
            {open.length > 0 && (
              <button type="button" className="btn btn--ghost bell-pop__ack"
                onClick={() => ackAlerts().then(() => setErr(null), (e: Error) => setErr(e.message))}>Tout acquitter</button>
            )}
          </div>
          {err && <p className="bell-pop__err">Acquittement refusé : {err}</p>}
          {events.length === 0 ? (
            <p className="bell-pop__empty">{summary === undefined
              ? 'Service alert non reçu : l’ajouter à GATEWAY_SERVICES sur la passerelle (Mode Local ou Tour).'
              : 'Aucune alerte déclenchée.'}</p>
          ) : (
            <ul className="bell-pop__list">
              {events.slice(0, 8).map((e) => (
                <li key={e.id} className={e.acked_ms ? 'is-acked' : undefined}>
                  <span className="num bell-pop__time">{fmtHm(e.fired_ms, 'Europe/Paris')}</span>
                  <span className="bell-pop__text">
                    <span className="bell-pop__title">{e.title}</span>
                    <span className="lbl lbl--s">{[e.category, e.source, telegramText(e)].filter(Boolean).join(' · ')}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link className="bell-pop__all" to={ALERTS_PATH} onClick={() => setShown(false)}>Toutes les alertes et les règles</Link>
        </div>
      )}
    </span>
  );
}
