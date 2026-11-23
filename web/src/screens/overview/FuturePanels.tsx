// Panneaux des phases suivantes : à leur place dans la grille, sans aucun
// chiffre de maquette. Hauteurs reprises de la maquette Main pour que la
// disposition reste juste en attendant les données.

import { Link } from 'react-router-dom';
import { Panel } from '../../components/Panel';
import { Icon } from '../../components/Icon';
import { ruleChip, sortRules, type AlertRule } from '../../alerts/alerts';
import { daysUntil, parisDay, shortDay, timeLabel, type CalendarNext } from '../../calendar/calendar';
import { Flag } from '../../calendar/Flag';
import { useSettings } from '../../config/settings';
import { ALERTS_STATUS_KEY, type AlertsOnlineStatus } from '../../data/online/alerts';
import { useKeys, useValue } from '../../data/store';
import { CATEGORY_LABEL, itemTime, urgentNews } from '../../news/news';
import { Highlighted } from '../../news/Highlighted';
import { useHighlights } from '../../news/highlight';
import '../news/news.css';
import { OFFLINE_REASON, useNews } from '../news/News';
import { fmtHm } from '../../lib/time';
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
          text={mode === 'online' ? 'Agenda en ligne : aucun événement d’impact fort ou moyen à venir, ou agenda pas encore relevé (Edge Function p1-jobs).'
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

/**
 * Alertes actives (E4) : règles du service « alert » de la passerelle (clés alert:rule:…),
 * déclenchées d'abord, avec leur état (Armée / Déclenchée hh:mm). Gestion : écran /alertes.
 */
export function AlertsPanel() {
  const { mode } = useSettings();
  const online = useValue<AlertsOnlineStatus>(ALERTS_STATUS_KEY);
  const now = useNow();
  const rules = sortRules(useKeys<AlertRule>('alert:rule:').map(([, r]) => r).filter((r) => r.state !== 'désactivée'));
  return (
    <Panel title="Alertes actives" controls="compact" chips={<Link className="chip" to="/alertes" title="Gérer les règles">{rules.length}</Link>}>
      {rules.length === 0 ? (
        <Placeholder phase="P1" height={267}
          text={mode === 'online'
            ? (online && !online.ok ? `Alertes en ligne : ${online.reason}.` : 'Aucune règle active : en créer une dans /alertes.')
            : 'Aucune règle reçue : activer le service alert de la passerelle (GATEWAY_SERVICES), puis créer une règle dans /alertes.'} />
      ) : (
        <ul className="alert-rows" style={{ minHeight: 267 - 42 }}>
          {rules.slice(0, 4).map((r) => {
            const chip = ruleChip(r, now);
            return (
              <li key={r.id}>
                <Link to="/alertes" className="alert-rows__row">
                  <Icon name="bell" />
                  <span className="alert-rows__text">
                    <span className="alert-rows__title">{r.label}</span>
                    <span className="lbl lbl--s">{r.category}</span>
                  </span>
                  <span className={`chip chip--s${chip.variant === 'fired' ? ' chip--hot' : ''}`} data-testid="alert-state">{chip.text}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** Titres urgents (E6/O6) : quatre derniers titres à fort impact, arriérés exclus ; lien vers /actus. */
export function HeadlinesPanel() {
  const { mode } = useSettings();
  const items = urgentNews(useNews());
  const hl = useHighlights();
  return (
    <Panel title="Titres urgents" controls="none"
      chips={<Link className="chip chip--hot" to="/actus">Fil d’actus</Link>}>
      {/* 421 px : hauteur de la capture de référence Main.png (et de la maquette HTML rendue sous Linux). */}
      {items.length === 0 ? (
        <Placeholder phase="P1" height={421}
          text={mode !== 'online' ? `— · ${OFFLINE_REASON}.` : 'Aucun titre urgent récent (décision de banque centrale, chiffre majeur).'} />
      ) : (
        <ul className="news-urgent" style={{ minHeight: 421 - 42 }}>
          {items.map((i) => (
            <li key={i.id}>
              <Link to="/actus">
                <span className="news-row__time">{fmtHm(itemTime(i), 'Europe/Paris')}</span>
                <span className="news-row__body">
                  <span className="news-row__chips"><span className="chip chip--s">{CATEGORY_LABEL[i.category]}</span></span>
                  <span className="news-row__title" lang={i.lang}><Highlighted text={i.title} words={hl.words} /></span>
                  <span className="lbl lbl--s" title="Langue d’origine (T-019)">{`${i.source} · VO`}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
