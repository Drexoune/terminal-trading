// Panneaux des phases suivantes : à leur place dans la grille, sans aucun
// chiffre de maquette. Hauteurs reprises de la maquette Main pour que la
// disposition reste juste en attendant les données.

import { Link } from 'react-router-dom';
import { Panel } from '../../components/Panel';
import { Chip } from '../../components/ui';
import { daysUntil, parisDay, shortDay, timeLabel, type CalendarNext } from '../../calendar/calendar';
import { Flag } from '../../calendar/Flag';
import { useSettings } from '../../config/settings';
import { useValue } from '../../data/store';
import { useNow } from '../../shell/useNow';
import { ImpactBars } from '../calendar/Calendar';

function Placeholder({ phase, text, height }: { phase: string; text: string; height: number }) {
  return (
    // Hauteur totale = 2 px de bordure + 40 px d'en-tête (filet compris) + corps.
    <div className="placeholder" style={{ minHeight: height - 42 }}>
      <span className="placeholder__dash" aria-hidden="true">—</span>
      <span>{text}</span>
      <span className="lbl lbl--s">Disponible en {phase}</span>
    </div>
  );
}

/**
 * Prochains événements (E2) : cinq publications à venir d'impact Fort ou Moyen,
 * clé calendar:next du service « calendar » de la passerelle (Mode Local et Tour).
 */
export function UpcomingEventsPanel() {
  const { mode } = useSettings();
  const next = useValue<CalendarNext>('calendar:next');
  const now = useNow();
  const events = next?.events ?? [];
  return (
    <Panel title="Prochains événements" controls="none"
      chips={<Link className="chip chip--hot" to="/calendrier">Calendrier</Link>}>
      {events.length === 0 ? (
        <Placeholder phase="P1" height={326}
          text={mode === 'online' ? 'Agenda en Mode Online : Edge Function ff-calendar à l’étape E7.'
            : next ? 'Aucune publication d’impact fort ou moyen d’ici la fin de la semaine.'
              : 'Agenda non reçu : activer le service calendar de la passerelle.'} />
      ) : (
        <ul className="next-events" style={{ minHeight: 326 - 42 }}>
          {events.map((e) => (
            <li key={e.id}>
              <Link to="/calendrier" className="next-events__row">
                <Flag currency={e.currency} />
                <span className="next-events__text">
                  <span className="next-events__title">{e.title_fr ?? e.title}</span>
                  <span className="lbl lbl--s">{e.currency} · {shortDay(parisDay(e))} · {timeLabel(e)}</span>
                </span>
                <ImpactBars impact={e.impact} />
                <span className="chip chip--s chip--hot">{daysUntil(parisDay(e), now)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function RiskPanel() {
  return (
    <Panel title="Sentiment de risque" controls="none"
      chips={<Link className="chip chip--hot" to="/risque">Détail</Link>}>
      <Placeholder phase="P4" height={168} text="Jauge 0–100 : percentiles sur 252 séances de 7 composantes." />
    </Panel>
  );
}

export function AlertsPanel() {
  return (
    <Panel title="Alertes actives" controls="compact" chips={<Chip>0</Chip>}>
      <Placeholder phase="P1" height={267} text="Alertes sur prix, chiffres publiés, mots-clés et liquidations : table alerts." />
    </Panel>
  );
}

export function HeadlinesPanel() {
  return (
    <Panel title="Titres urgents" controls="none"
      chips={<Link className="chip chip--hot" to="/actus">Fil d’actus</Link>}>
      {/* 421 px : hauteur de la capture de référence Main.png (et de la maquette HTML rendue sous Linux). */}
      <Placeholder phase="P1" height={421} text="Titres à fort impact, traduits titre par titre : table news." />
    </Panel>
  );
}
