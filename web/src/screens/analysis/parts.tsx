// Briques communes des écrans de P7 : puce de fraîcheur (source, heure, « périmé »), état vide
// motivé, graphique de lignes SVG léger (axes min/max, ligne zéro, repère vertical).

import type { ReactNode } from 'react';
import type { AnalysisState } from '../../analysis/client';
import { Chip, Missing } from '../../components/ui';
import { fmtHm } from '../../lib/time';

export const PARIS = 'Europe/Paris';
const day = (ms: number) => new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, day: '2-digit', month: '2-digit' }).format(ms);
export const fmtDayHm = (ms: number) => `${day(ms)} ${fmtHm(ms, PARIS)}`;

export function FreshChip({ s, source }: { s: AnalysisState<unknown>; source: string }) {
  if (!s.updated) return <Chip small title={source}>{source}</Chip>;
  return <Chip small variant={s.stale ? 'down' : 'neutral'} title={`${source} · écrit le ${fmtDayHm(s.updated)} (Paris)`}>
    {s.stale ? `Périmé · ${fmtDayHm(s.updated)}` : `MAJ ${fmtDayHm(s.updated)}`}
  </Chip>;
}

export function Empty({ reason, children }: { reason: string; children?: ReactNode }) {
  return <div className="an-empty"><Missing reason={reason} /><span>{children ?? reason}</span></div>;
}

export interface Series { points: [number, number][]; cls: string; label: string }

/** Lignes sur une même échelle ; x et y quelconques (temps, strike, jours). */
export function LineChart({ series, height = 180, xFmt, yFmt, zero = false, markX, label }: {
  series: Series[]; height?: number; xFmt: (x: number) => string; yFmt: (y: number) => string; zero?: boolean; markX?: number | null; label: string;
}) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return <Empty reason="pas assez de points" />;
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]).concat(zero ? [0] : []);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = 1000, H = 200, pad = (y1 - y0) * 0.06 || 1;
  const X = (x: number) => ((x - x0) / (x1 - x0 || 1)) * W, Y = (y: number) => H - ((y - (y0 - pad)) / (y1 - y0 + 2 * pad)) * H;
  return (
    <figure className="an-chart" style={{ height }} aria-label={label} role="img">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {zero && y0 < 0 && y1 > 0 && <path className="an-zero" d={`M0 ${Y(0).toFixed(1)}H${W}`} />}
        {markX != null && markX >= x0 && markX <= x1 && <path className="an-mark" d={`M${X(markX).toFixed(1)} 0V${H}`} />}
        {series.map((s) => <path key={s.label} className={`an-line ${s.cls}`}
          d={s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('')} />)}
      </svg>
      <span className="an-ax an-ax--ymax num">{yFmt(y1)}</span>
      <span className="an-ax an-ax--ymin num">{yFmt(y0)}</span>
      <span className="an-ax an-ax--xmin num">{xFmt(x0)}</span>
      <span className="an-ax an-ax--xmax num">{xFmt(x1)}</span>
      <figcaption className="an-legend">{series.map((s) => <span key={s.label}><i className={`an-key ${s.cls}`} />{s.label}</span>)}</figcaption>
    </figure>
  );
}
