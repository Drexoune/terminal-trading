// Backtest du score (plan P3, étape M3 : la porte de P3). Module pur.
//
// Chaque fin de mois t : score à la date t (délais de publication respectés, thèmes qui ont un
// historique), puis rendement relatif de chaque devise de t à t+h (h = 1 et 3 mois) : log de la
// variation contre le dollar moins la moyenne des 8 (le dollar compte 0).
// Mesures : corrélation de rang (IC de Spearman) entre score et rendement, et entre variation du
// score sur un mois et rendement ; t de Newey-West (fenêtres qui se chevauchent pour h = 3) ;
// écart moyen top 3 − bottom 3 ; stabilité sur les deux moitiés de la période.
// Porte : le score n'est « démontré » que si l'IC du niveau est positif avec t ≥ 2 sur chacune des
// deux moitiés, pour h = 1 ou h = 3. Sinon l'écran dit « outil de contexte ».
// Biais connu, dit à l'écran : les sources donnent des chiffres révisés, pas ceux de l'époque.

import { ECONOMIES, type Economy } from './catalog.ts';
import { periodEnd, shiftPeriod, type Obs } from './parse.ts';
import { HISTORICAL_THEMES, scoreAt, type Panel } from './score.ts';

export type Fx = Partial<Record<Economy, Obs[]>>;   // dollars par unité, fin de mois ; États-Unis absents

/** Rangs moyens (ex aequo partagés). */
export function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const r = new Array<number>(xs.length);
  for (let k = 0; k < idx.length;) {
    let j = k;
    while (j + 1 < idx.length && idx[j + 1].x === idx[k].x) j++;
    for (let m = k; m <= j; m++) r[idx[m].i] = (k + j) / 2 + 1;
    k = j + 1;
  }
  return r;
}

export function pearson(a: number[], b: number[]): number | null {
  const n = a.length;
  if (n < 3) return null;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
}

export const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));

/** Moyenne et t de Newey-West (noyau de Bartlett, `lags` retards). */
export function neweyWest(xs: number[], lags: number): { mean: number; t: number | null; n: number } {
  const n = xs.length;
  if (n < 2) return { mean: n ? xs[0] : 0, t: null, n };
  const m = xs.reduce((s, x) => s + x, 0) / n;
  const e = xs.map((x) => x - m);
  let v = e.reduce((s, x) => s + x * x, 0) / n;
  for (let l = 1; l <= lags && l < n; l++) {
    let c = 0;
    for (let i = l; i < n; i++) c += e[i] * e[i - l];
    v += 2 * (1 - l / (lags + 1)) * (c / n);
  }
  const se = Math.sqrt(Math.max(v, 0) / n);
  return { mean: m, t: se > 0 ? m / se : null, n };
}

/** Rendement relatif de chaque économie de `from` à `to` (périodes AAAA-MM), ou null s'il manque un cours. */
export function relativeReturns(fx: Fx, from: string, to: string): Record<Economy, number> | null {
  const raw: number[] = [];
  for (const e of ECONOMIES) {
    if (e === 'US') { raw.push(0); continue; }
    const s = fx[e];
    const a = s?.find((o) => o.period === from), b = s?.find((o) => o.period === to);
    if (!a || !b || a.value <= 0 || b.value <= 0) return null;
    raw.push(Math.log(b.value / a.value));
  }
  const mean = raw.reduce((s, x) => s + x, 0) / raw.length;
  return Object.fromEntries(ECONOMIES.map((e, i) => [e, raw[i] - mean])) as Record<Economy, number>;
}

export interface Measure { horizon: number; signal: 'niveau' | 'variation'; ic: number; t: number | null; n: number;
  halves: { ic: number; t: number | null; n: number }[]; spread_bp: number | null }
export interface BacktestResult {
  from: string; to: string; months: number; themes: string[];
  measures: Measure[];
  proven: boolean;
  verdict: string;
  caveats: string[];
}

/** Backtest mensuel de `from` à `to` (AAAA-MM inclus, dates de score = fins de mois). */
export function runBacktest(panel: Panel, fx: Fx, from: string, to: string): BacktestResult {
  const months: string[] = [];
  for (let p = from; p <= to; p = shiftPeriod(p, 1)) months.push(p);
  const scores = new Map<string, Record<Economy, number>>();
  for (const p of months) {
    const s = scoreAt(panel, periodEnd(p), { themes: HISTORICAL_THEMES });
    if (!s.themes.length) continue;
    scores.set(p, Object.fromEntries(s.rows.map((r) => [r.economy, r.score])) as Record<Economy, number>);
  }
  const measures: Measure[] = [];
  for (const h of [1, 3]) {
    for (const signal of ['niveau', 'variation'] as const) {
      const ics: number[] = [], spreads: number[] = [];
      for (const p of months) {
        const s = scores.get(p);
        const prev = scores.get(shiftPeriod(p, -1));
        const ret = relativeReturns(fx, p, shiftPeriod(p, h));
        if (!s || !ret || (signal === 'variation' && !prev)) continue;
        const x = ECONOMIES.map((e) => (signal === 'niveau' ? s[e] : s[e] - prev![e]));
        const y = ECONOMIES.map((e) => ret[e]);
        const ic = spearman(x, y);
        if (ic === null) continue;
        ics.push(ic);
        const order = x.map((xi, i) => ({ x: xi, y: y[i] })).sort((a, b) => b.x - a.x);
        spreads.push((order.slice(0, 3).reduce((t, o) => t + o.y, 0) - order.slice(5).reduce((t, o) => t + o.y, 0)) / 3);
      }
      const all = neweyWest(ics, h);
      const half = Math.floor(ics.length / 2);
      const halves = [ics.slice(0, half), ics.slice(half)].map((xs) => { const r = neweyWest(xs, h); return { ic: round(r.mean), t: r.t === null ? null : round(r.t), n: r.n }; });
      measures.push({ horizon: h, signal, ic: round(all.mean), t: all.t === null ? null : round(all.t), n: all.n, halves,
        spread_bp: spreads.length ? Math.round((spreads.reduce((a, b) => a + b, 0) / spreads.length) * 1e5) / 10 : null });
    }
  }
  const proven = measures.some((m) => m.signal === 'niveau' && m.halves.every((h) => h.n >= 24 && h.ic > 0 && (h.t ?? 0) >= 2));
  return {
    from, to, months: scores.size, themes: [...HISTORICAL_THEMES], measures, proven,
    verdict: proven ? 'signal démontré sur l’historique (IC positif, t ≥ 2 sur les deux moitiés)'
      : 'outil de contexte, non démontré comme signal (IC du score non significatif sur les deux moitiés)',
    caveats: [
      'chiffres révisés d’aujourd’hui, pas ceux connus à l’époque : le backtest est optimiste',
      'thèmes sans historique (activité, surprises) exclus du backtest',
      'rendement de change seul, sans différentiel de taux (portage)',
    ],
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000;
