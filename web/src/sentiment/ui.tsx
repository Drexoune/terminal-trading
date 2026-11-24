// Puces et lignes de fraîcheur communes aux écrans de P4 : chaque panneau affiche sa source et
// l'heure de sa dernière mise à jour (porte de P4), marquées data-fresh pour les tests.

import './sentiment.css';
import type { ReactNode } from 'react';
import { Missing } from '../components/ui';
import { useSettings } from '../config/settings';
import { SENTIMENT_STATUS_KEY } from '../data/online/sentiment';
import { useValue } from '../data/store';
import { dateTicks, feedFresh, freshText, type FeedState, type Reply } from './sentiment';

/** Puce de sous-en-tête : « Source · relevé 22:30 », rouge si périmé, grise si rien reçu. */
export function FreshChip({ source, feed, now }: { source: string; feed: FeedState | null | undefined; now: number }) {
  const f = feedFresh(feed, now);
  const variant = f === 'live' ? 'chip--live' : f === 'down' ? 'chip--pending' : 'chip--down';
  return <span className={`chip ${variant} sn-fresh-chip`} data-fresh title={feed?.last_error ?? feed?.label ?? undefined}>{freshText(source, feed, now)}</span>;
}

/** Ligne de source d'un panneau. */
export function Fresh({ children }: { children: ReactNode }) {
  return <div className="lbl lbl--s sn-fresh" data-fresh>{children}</div>;
}

export function Empty({ reason }: { reason: string }) {
  return <div className="sn-empty"><Missing reason={reason} /><span>{reason}</span></div>;
}

/** Courbes sur un axe commun : dates en abscisse, zéro en pointillé s'il est dans l'échelle. */
export function Lines({ dates, series, height = 180, legend }: {
  dates: string[]; series: { values: (number | null)[]; tone: 'gold' | 'up' | 'down' | 'text' }[]; height?: number;
  legend?: { label: string; tone: 'gold' | 'up' | 'down' | 'text' }[];
}) {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (dates.length < 2 || !all.length) return <Empty reason="historique insuffisant" />;
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
  lo -= pad; hi += pad;
  const x = (i: number) => ((i / (dates.length - 1)) * 1000).toFixed(1);
  const y = (v: number) => (((hi - v) / (hi - lo)) * height).toFixed(1);
  const path = (vals: (number | null)[]) => {
    let d = '', pen = false;
    vals.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i)} ${y(v)}`; pen = true; });
    return d;
  };
  return (
    <div className="sn-chart">
      {legend && <div className="sn-legend">{legend.map((l) => <span key={l.label} className="lbl lbl--s"><span className={`sn-ln sn-ln--${l.tone}`} />{l.label}</span>)}</div>}
      <div className="sn-plot" style={{ height }}>
        <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden="true">
          {lo < 0 && hi > 0 && <path className="sn-zero" d={`M0 ${y(0)}H1000`} />}
          {series.map((s, i) => <path key={i} className={`sn-line sn-line--${s.tone}`} d={path(s.values)} />)}
        </svg>
      </div>
      <div className="num sn-axis">{dateTicks(dates).map((t, i) => <span key={i}>{t}</span>)}</div>
    </div>
  );
}

/** Raison commune quand l'état n'est pas là. */
export function useSentimentReason(reply: Reply<unknown> | undefined): string {
  const { mode } = useSettings();
  const online = useValue<{ ok: boolean; reason: string | null }>(SENTIMENT_STATUS_KEY);
  if (reply) return reply.configured ? (reply.reason ?? 'aucune donnée') : `non configuré : ${reply.reason ?? ''}`;
  if (mode !== 'online') return 'écrans de sentiment en Mode Online seulement (tâches p4-jobs de Supabase)';
  return online && !online.ok ? online.reason ?? 'injoignable' : 'chargement…';
}

