// Panneau « Réaction BTC · 30 min » de l'écran Calendrier (E3, maquette Calendrier) :
// prix du perpétuel BTC-USDT d'OKX de T−5 à T+30 min autour de la dernière publication
// de l'indicateur choisi, variation à T+30 min. Données : clés reaction:… de la passerelle.
// Sans réaction enregistrée : « — » et la raison, jamais une courbe de maquette.

import { Panel } from '../../components/Panel';
import { Missing } from '../../components/ui';
import type { CalendarEvent } from '../../calendar/calendar';
import {
  changeTone, fmtChangePct, pickReaction, reactionCaption, reactionPoints, type Reaction,
} from '../../calendar/releases';
import { fmtHm } from '../../lib/time';

const W = 100;
const H = 100;
const X0 = -5;
const X1 = 30;
const TICKS: { at: number; label: string }[] = [
  { at: -5, label: '−5 min' }, { at: 0, label: '0' }, { at: 10, label: '+10' }, { at: 20, label: '+20' }, { at: 30, label: '+30 min' },
];

const xOf = (m: number) => ((m - X0) / (X1 - X0)) * W;

export function ReactionPanel({ ev, all }: { ev: CalendarEvent | null; all: Reaction[] }) {
  const { reaction: r, reason } = pickReaction(ev, all);
  const tone = r ? changeTone(r.change_pct) : null;
  return (
    <Panel title="Réaction BTC · 30 min" label="Réaction du BTC" controls="none" testId="cal-btc"
      chips={r ? (r.change_pct !== null
        ? <span className={`num cal-btc__change${tone ? ` tone-${tone}` : ''}`} data-testid="cal-btc-change">{fmtChangePct(r.change_pct)}</span>
        : <Missing reason={r.reason ?? 'variation indisponible'} />) : undefined}>
      {!r ? (
        <div className="placeholder cal-btc">
          <span className="placeholder__dash" aria-hidden="true">—</span>
          <span>{reason}</span>
        </div>
      ) : <ReactionChart r={r} tone={tone} />}
    </Panel>
  );
}

function ReactionChart({ r, tone }: { r: Reaction; tone: 'up' | 'down' | null }) {
  const pts = [{ x: 0, y: r.ref_price !== null ? Number(r.ref_price) : NaN }, ...reactionPoints(r)]
    .filter((p) => Number.isFinite(p.y) && p.x >= X0 && p.x <= X1)
    .sort((a, b) => a.x - b.x);
  const ys = pts.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const pad = (hi - lo) * 0.12 || Math.max(1, hi * 0.0005);
  const yOf = (v: number) => H - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * H;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.x).toFixed(2)} ${yOf(p.y).toFixed(2)}`).join('');
  const ref = r.ref_price !== null ? yOf(Number(r.ref_price)) : null;
  const stroke = tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : 'var(--text-2)';
  const title = `BTC de ${r.ref_price ?? '—'} à ${r.end_price ?? '—'} USDT`;
  return (
    <div className="cal-btc cal-btc--chart">
      <div className="cal-btc__plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={title}>
          {ref !== null && <line x1="0" x2={W} y1={ref} y2={ref} className="cal-btc__ref" vectorEffect="non-scaling-stroke" />}
          <line x1={xOf(0)} x2={xOf(0)} y1="0" y2={H} className="cal-btc__t" vectorEffect="non-scaling-stroke" />
          {pts.length > 1 && <path d={path} style={{ stroke }} className="cal-btc__line" vectorEffect="non-scaling-stroke" data-testid="cal-btc-line" />}
        </svg>
        <span className="lbl lbl--s cal-btc__pub" style={{ left: `${xOf(0)}%` }}>Publication</span>
      </div>
      <div className="cal-btc__axis num" aria-hidden="true">
        {TICKS.map((t) => <span key={t.at} style={{ left: `${xOf(t.at)}%` }}>{t.label}</span>)}
      </div>
      <p className="cal-btc__caption" data-testid="cal-btc-caption">
        {reactionCaption(r)}.
        {r.missing.length > 0 && ` ${r.missing.length} minute${r.missing.length > 1 ? 's' : ''} sans bougie.`}
        {` Enregistrée à ${fmtHm(r.received_ms, 'Europe/Paris')}.`}
      </p>
    </div>
  );
}
