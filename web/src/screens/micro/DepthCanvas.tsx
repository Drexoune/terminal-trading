// Carte de profondeur en canvas (P5, S3) : 60 min × prix, liquidité au repos en 4 niveaux d'or,
// prix en blanc, bulles d'achats et de ventes agressifs (aire ∝ volume), murs retirés marqués.
// Le canvas est redessiné à chaque état publié (une fois par seconde au plus) ; textes et
// étiquettes en DOM par-dessus (polices du design system).

import { Tip } from '../../help/Tip';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DepthState } from '../../micro/depth';
import { depthLevel, priceTicks } from '../../micro/view';
import { fmtNumber } from '../../lib/format';
import { fmtHm } from '../../lib/time';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

export function DepthCanvas({ d, now, height }: { d: DepthState; now: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fenêtre : [t1 − 60 min, t1] ; prix : ±range autour du dernier milieu.
  const t1 = now, t0 = now - d.window_ms;
  const mid = d.price.length ? d.price[d.price.length - 1][1] : d.columns.length ? d.columns[d.columns.length - 1].mid : 0;
  const half = (mid * d.range_pct) / 100;
  const lo = mid - half, hi = mid + half;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * width;
  const y = (p: number) => ((hi - p) / (hi - lo)) * height;

  useEffect(() => {
    const c = ref.current;
    if (!c || !width || !mid) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr; c.height = height * dpr;
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const fills = ['', css('--depth-1'), css('--depth-2'), css('--depth-3'), css('--depth-4')];
    const ch = Math.max(1, (d.step / (hi - lo)) * height);
    for (let i = 0; i < d.columns.length; i++) {
      const col = d.columns[i];
      const xa = x(col.t), xb = i + 1 < d.columns.length ? x(d.columns[i + 1].t) : x(col.t + d.column_ms);
      for (let j = 0; j < col.px.length; j++) {
        const lv = depthLevel(col.sz[j], d.levels);
        if (!lv) continue;
        g.fillStyle = fills[lv];
        g.fillRect(xa, y(col.px[j] + d.step), Math.max(1, xb - xa), ch);
      }
    }
    // Prix
    if (d.price.length > 1) {
      g.strokeStyle = css('--text-1'); g.lineWidth = 1.5; g.lineJoin = 'round';
      g.beginPath();
      d.price.forEach(([t, p], i) => (i ? g.lineTo(x(t), y(p)) : g.moveTo(x(t), y(p))));
      g.stroke();
    }
    // Bulles : aire proportionnelle au volume.
    const maxB = Math.max(1, ...d.bubbles.map((b) => b.sz));
    for (const b of d.bubbles) {
      const r = 3 + 9 * Math.sqrt(b.sz / maxB);
      const col = b.side === 'buy' ? css('--up') : css('--down');
      g.beginPath(); g.arc(x(b.t), y(b.px), r, 0, Math.PI * 2);
      g.globalAlpha = 0.4; g.fillStyle = col; g.fill();
      g.globalAlpha = 1; g.strokeStyle = col; g.lineWidth = 1; g.stroke();
    }
    // Murs retirés : croix or.
    g.strokeStyle = css('--gold-hi'); g.lineWidth = 1.5;
    for (const w of d.walls) {
      const cx = x(w.t), cy = y(w.px + d.step / 2);
      g.beginPath(); g.moveTo(cx - 4, cy - 4); g.lineTo(cx + 4, cy + 4); g.moveTo(cx + 4, cy - 4); g.lineTo(cx - 4, cy + 4); g.stroke();
    }
  }, [d, width, height, mid, lo, hi, t0, t1]); // eslint-disable-line react-hooks/exhaustive-deps

  const ticks = useMemo(() => (mid ? priceTicks(lo, hi, 3) : []), [mid, lo, hi]);
  const wall = d.walls[d.walls.length - 1];
  const last = d.price.length ? d.price[d.price.length - 1][1] : null;
  const times = [0, 1, 2, 3, 4].map((i) => t0 + (i * (t1 - t0)) / 4);
  return (
    <>
      <div className="mc-map-row">
        <div className="mc-map" ref={box} style={{ height }}>
          <canvas ref={ref} style={{ width: '100%', height: '100%' }} aria-label="Carte de profondeur sur 60 minutes" role="img" />
          {wall && wall.t >= t0 && (
            <div className="mc-wall" style={{ left: Math.min(Math.max(x(wall.t) + 10, 0), Math.max(0, width - 190)), top: Math.min(Math.max(y(wall.px) - 52, 4), height - 52) }}
              data-testid="mc-wall">
              <div className="lbl lbl-tip">Mur retiré<Tip term="wallPulled" label="Mur retiré" /></div>
              <div className="num">{`${fmtNumber(wall.sz, 0)} BTC · ${fmtNumber(wall.px, 0)} · ${fmtHm(wall.t, 'Europe/Paris')}`}</div>
            </div>
          )}
          {last !== null && <span className="num mc-last" style={{ top: y(last) - 10 }}>{fmtNumber(last, 1)}</span>}
        </div>
        <div className="num mc-yaxis">
          {ticks.map((p) => <span key={p} style={{ top: `${((hi - p) / (hi - lo)) * 100}%` }}>{fmtNumber(p, 0)}</span>)}
        </div>
      </div>
      <div className="num mc-xaxis">{times.map((t, i) => <span key={i}>{fmtHm(t, 'Europe/Paris')}</span>)}</div>
    </>
  );
}
