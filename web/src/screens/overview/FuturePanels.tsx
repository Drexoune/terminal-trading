// Panneaux des phases suivantes : à leur place dans la grille, sans aucun
// chiffre de maquette. Hauteurs reprises de la maquette Main pour que la
// disposition reste juste en attendant les données.

import { Link } from 'react-router-dom';
import { Panel } from '../../components/Panel';
import { Chip } from '../../components/ui';

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

export function UpcomingEventsPanel() {
  return (
    <Panel title="Prochains événements" controls="none"
      chips={<Link className="chip chip--hot" to="/calendrier">Calendrier</Link>}>
      <Placeholder phase="P1" height={326}
        text="Agenda et consensus (flux ForexFactory), chiffres captés à la source : table releases." />
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
      <Placeholder phase="P1" height={402} text="Titres à fort impact, traduits titre par titre : table news." />
    </Panel>
  );
}
