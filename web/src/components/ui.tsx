// Composants de base du design system (docs/design-system.md, planche DesignSystem).
// Aucune couleur en dur : tout passe par les classes de base.css et les tokens.

import type { ReactNode } from 'react';
import { Icon } from './Icon';

type ChipVariant = 'neutral' | 'hot' | 'live' | 'down' | 'new' | 'pending';

export function Chip({ variant = 'neutral', round, small, dot, children, title, href }: {
  variant?: ChipVariant; round?: boolean; small?: boolean; dot?: 'up' | 'gold' | 'down';
  children: ReactNode; title?: string; href?: string;
}) {
  const cls = ['chip', variant !== 'neutral' && `chip--${variant}`, round && 'chip--round',
    small && 'chip--s'].filter(Boolean).join(' ');
  const body = <>{dot && <span className={`dot dot--${dot}`} />}{children}</>;
  return href
    ? <a className={cls} href={href} title={title}>{body}</a>
    : <span className={cls} title={title}>{body}</span>;
}

export function Button({ variant = 'secondary', children, ...rest }: {
  variant?: 'primary' | 'secondary' | 'ghost';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ['btn', variant !== 'secondary' && `btn--${variant}`, rest.className]
    .filter(Boolean).join(' ');
  return <button type="button" {...rest} className={cls}>{children}</button>;
}

export function IconButton({ icon, label, boxed, onClick }: {
  icon: Parameters<typeof Icon>[0]['name']; label: string; boxed?: boolean; onClick?: () => void;
}) {
  return (
    <button type="button" className={`ib${boxed ? ' ib--boxed' : ''}`} aria-label={label}
      title={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

/** Groupe de bascules exclusives (période d'un graphique…). */
export function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex' }}>
      {options.map((o) => (
        <button key={o.value} type="button" className="seg" aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export type Bias = 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'RISK-OFF' | 'RISK-ON';

export function Pill({ bias }: { bias: Bias }) {
  const tone = bias === 'BULLISH' || bias === 'RISK-ON' ? 'bullish'
    : bias === 'NEUTRAL' ? 'neutral' : 'bearish';
  return <span className={`pill pill--${tone}`}>{bias}</span>;
}

export type CellLevel = 'up-2' | 'up-1' | 'neutral' | 'down-1' | 'down-2' | 'z-up';

export function Cell({ level, selected, children }: {
  level: CellLevel; selected?: boolean; children: ReactNode;
}) {
  return <span className={`cell cell--${level}${selected ? ' cell--selected' : ''}`}>{children}</span>;
}

/** Sparkline : 28 px, trait 1,4 px, cyan si la variation est positive, corail sinon. */
export function Sparkline({ values, width = 140, height = 28, strokeWidth = 1.4 }: {
  values: number[]; width?: number | string; height?: number; strokeWidth?: number;
}) {
  if (values.length < 2) {
    return <span className="missing num" style={{ width, display: 'inline-block' }}>—</span>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 26 - ((v - min) / span) * 24;
    return `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join('');
  const up = values[values.length - 1] >= values[0];
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"
      style={{ width, height, display: 'block', overflow: 'visible' }}>
      <path d={d} style={{
        fill: 'none', stroke: up ? 'var(--up)' : 'var(--down)', strokeWidth,
        strokeLinejoin: 'round', vectorEffect: 'non-scaling-stroke',
      }} />
    </svg>
  );
}

const ZONES: [number, number, string][] = [
  [0, 25, 'var(--gauge-1)'], [25, 45, 'var(--gauge-2)'], [45, 55, 'var(--gauge-3)'],
  [55, 75, 'var(--gauge-4)'], [75, 100, 'var(--gauge-5)'],
];

function polar(v: number, r = 80): [number, number] {
  const a = Math.PI * (1 - v / 100);
  return [100 + r * Math.cos(a), 100 - r * Math.sin(a)];
}

/** Jauge 0–100 en 5 zones, aiguille, repère pointillé de la valeur précédente. */
export function Gauge({ value, previous, width = 170 }: {
  value: number | null; previous?: number | null; width?: number;
}) {
  const gap = 1.5; // écart entre zones, en points de jauge
  return (
    <svg viewBox="0 0 200 110" aria-hidden="true"
      style={{ width, height: width * 0.553, display: 'block', flex: 'none', overflow: 'visible' }}>
      {ZONES.map(([a, b, color]) => {
        const [x1, y1] = polar(a === 0 ? 0 : a + gap);
        const [x2, y2] = polar(b === 100 ? 100 : b - gap);
        return <path key={a} d={`M${x1.toFixed(2)} ${y1.toFixed(2)}A80 80 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`}
          style={{ fill: 'none', stroke: color, strokeWidth: 14 }} />;
      })}
      {previous != null && (() => {
        const [x1, y1] = polar(previous, 70);
        const [x2, y2] = polar(previous, 90);
        return <path d={`M${x1} ${y1}L${x2} ${y2}`}
          style={{ stroke: 'var(--text-1)', strokeWidth: 1.5, strokeDasharray: '2 2' }} />;
      })()}
      {value != null && (() => {
        const [x, y] = polar(value, 62);
        return <path d={`M100 100L${x.toFixed(2)} ${y.toFixed(2)}`}
          style={{ fill: 'none', stroke: 'var(--text-1)', strokeWidth: 3, strokeLinecap: 'round' }} />;
      })()}
      <circle cx="100" cy="100" r="5" style={{ fill: 'var(--text-1)' }} />
    </svg>
  );
}

/** Barre de percentile : remplissage coloré par zone, repère central à 50. */
export function PercentileBar({ pct }: { pct: number }) {
  const color = pct < 25 ? 'var(--gauge-1)' : pct < 45 ? 'var(--gauge-2)'
    : pct < 55 ? 'var(--gauge-3)' : pct < 75 ? 'var(--gauge-4)' : 'var(--gauge-5)';
  return (
    <div style={{ position: 'relative', height: 8, background: 'var(--bg-panel-2)', border: '1px solid var(--line)' }}>
      <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${pct}%`, background: color }} />
      <div style={{ position: 'absolute', top: -3, bottom: -3, left: '50%', width: 1, background: 'var(--line-strong)' }} />
    </div>
  );
}

/** Statut d'un flux : point + nom, jamais la couleur seule. */
export function FeedDot({ state, children, title }: {
  state: 'live' | 'late' | 'stale' | 'down'; children: ReactNode; title?: string;
}) {
  const dot = state === 'live' ? 'up' : state === 'late' ? 'gold' : 'down';
  return (
    <span className="num feed-dot" title={title}>
      <span className={`dot dot--${dot}`} />{children}
    </span>
  );
}

/** Valeur absente : « — » et sa raison (jamais une valeur inventée). */
export function Missing({ reason }: { reason: string }) {
  return <span className="missing" title={reason} aria-label={`Indisponible : ${reason}`}>—</span>;
}
