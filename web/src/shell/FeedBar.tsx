import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FeedDot } from '../components/ui';
import { modeDef } from '../config/modes';
import { useSettings } from '../config/settings';
import { fetchCollectorHealth, type CollectorHealth } from '../data/gateway';
import { freshness, type Freshness } from '../data/latency';
import type { FeedState, GapsState } from '../data/protocol';
import { useConn, useValue } from '../data/store';
import { fmtDuration } from '../lib/format';
import { fmtHms } from '../lib/time';
import { SETTINGS_PATH } from '../modules';
import { COLLECTOR_POLL_MS, collectorStatus } from '../screens/settings/health';
import { useNow } from './useNow';

function feedFreshness(feed: FeedState | undefined, now: number, sourceUp: boolean): Freshness {
  if (!sourceUp || !feed || feed.status !== 'connected') return 'down';
  return freshness(feed.last_message_ms != null ? now - feed.last_message_ms : null, true);
}

const LABEL: Record<Freshness, string> = {
  live: 'connecté', late: 'retard > 2 s', stale: 'périmé', down: 'déconnecté',
};

/**
 * Détail d'un flux OKX pour l'infobulle : reconnexions, dernière coupure, dernière
 * erreur et, pour les trades, journal des trous de séquence (heures de Paris).
 * C'est le seul journal visible en Mode Online, où aucune passerelle n'écrit de fichier.
 */
export function feedDetail(state: string, feed: FeedState | undefined, gaps?: GapsState): string {
  const parts = [state];
  if (feed) {
    parts.push(`${feed.reconnects} reconnexion(s)`);
    const last = feed.outages?.[feed.outages.length - 1];
    if (last) {
      parts.push(`dernière coupure ${fmtHms(last.from_ms, 'Europe/Paris')}, ${fmtDuration(last.duration_ms)}`);
    }
    if (feed.last_error) parts.push(`erreur : ${feed.last_error}`);
    if (feed.rejected?.length) parts.push(`refusé(s) par OKX : ${feed.rejected.join(', ')}`);
  }
  if (gaps !== undefined) {
    parts.push(gaps.count
      ? `${gaps.count} trou(s) de séquence, dernier ${fmtHms(gaps.ts_recv, 'Europe/Paris')} : ${gaps.last}`
      : 'aucun trou de séquence');
  }
  return parts.join(' · ');
}

/** Santé du collecteur Supabase (Mode Online), interrogée toutes les 30 s. */
function useCollectorHealth(enabled: boolean) {
  const [state, setState] = useState<{ health: CollectorHealth | null; error: string | null; at: number }>(
    { health: null, error: null, at: 0 });
  useEffect(() => {
    if (!enabled) return;
    const ctl = new AbortController();
    const load = () => fetchCollectorHealth(ctl.signal)
      .then((health) => setState({ health, error: null, at: Date.now() }))
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setState((s) => ({ health: s.health, error: (e as Error).message, at: Date.now() }));
      });
    setState({ health: null, error: null, at: 0 });
    load();
    const id = setInterval(load, COLLECTOR_POLL_MS);
    return () => { ctl.abort(); clearInterval(id); };
  }, [enabled]);
  return state;
}

/** Barre de flux : mode actif, sources connectées et dernière synchro. */
export function FeedBar() {
  const now = useNow();
  const { mode } = useSettings();
  const conn = useConn();
  const up = conn?.status === 'open';
  const pub = useValue<FeedState>('feed:okx-public');
  const biz = useValue<FeedState>('feed:okx-business');
  const gaps = useValue<GapsState>('gaps:okx');
  const collector = useCollectorHealth(mode === 'online');
  const pubState = feedFreshness(pub, now, up);
  const bizState = feedFreshness(biz, now, up);
  const okx: [string, Freshness, string?][] = [
    // gaps:okx n'existe qu'après un premier trou : absent = aucun trou depuis le démarrage.
    ['OKX WS', pubState, feedDetail(LABEL[pubState], pub, gaps ?? { count: 0, last: '', ts_recv: 0 })],
    ['OKX bougies', bizState, feedDetail(LABEL[bizState], biz)],
  ];
  const feeds: [string, Freshness, string?][] = mode === 'online'
    ? [...okx, (() => {
        // L'âge avance entre deux interrogations : on ajoute le temps écoulé depuis la réponse.
        const c = collectorStatus(collector.health, collector.error, collector.at ? Date.now() - collector.at : 0);
        return ['Collecteur Supabase', c.state, c.label] as [string, Freshness, string];
      })()]
    : [['Passerelle', up ? freshness(conn?.lastMessage != null ? now - conn.lastMessage : null, true) : 'down',
        !up && conn?.reason ? `${LABEL.down} · ${conn.reason}` : undefined], ...okx];
  const def = modeDef(mode);
  return (
    <div className="feedbar">
      <Link className="lbl lbl--s feedbar__mode" to={SETTINGS_PATH}
        title={`${def.label} · moteur : ${def.where}. Changer de mode : Paramètres`}>
        <span className="dia" />{def.label}
      </Link>
      <span className="lbl lbl--s">Flux</span>
      {feeds.map(([name, state, detail]) => {
        const label = detail ?? LABEL[state];
        return (
          <FeedDot key={name} state={state} title={`${name} : ${label}`}>
            {name}<span className="sr"> : {label}</span>
          </FeedDot>
        );
      })}
      <span className="spacer" />
      <span className="num feedbar__sync">
        Dernière synchro {conn?.lastMessage ? `${fmtHms(conn.lastMessage, 'UTC')} UTC` : '—'}
      </span>
    </div>
  );
}
