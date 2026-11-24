// Modèle de score de la heatmap (plan P3, étape M2). Module pur : le même code sert au score du
// jour et au backtest (M3), à n'importe quelle date passée, en respectant les délais de publication.
//
// 1. Signal brut x par économie et par thème (plus haut = plus favorable à la devise).
// 2. z = (x − moyenne des économies) / σ (σ de population) : relatif aux 7 autres, jamais absolu.
// 3. S = 100 × Σ w·z / (Σ w × √7) : avec 8 économies et σ de population, |z| ≤ √(8 − 1) = 2,646
//    (atteint quand une seule économie s'écarte des 7 autres), donc S ∈ [−100, +100]
//    et Σ S = 0 quand chaque thème est connu partout.
// 4. Biais relatif : 3 premières BULLISH, 3 dernières BEARISH, 2 du milieu NEUTRAL.
//
// Valeur manquante : un thème connu pour moins de 6 économies est retiré pour toutes ; sinon la
// valeur manquante compte 0 (neutre) et s'affiche « — » avec sa raison. Valeur périmée (plus vieille
// que deux publications après son délai) : traitée comme manquante, montrée avec sa date.

import { ECONOMIES, INFLATION_TARGET, type Economy, type Indicator } from './catalog.ts';
import { periodEnd, shiftPeriod, type Obs } from './parse.ts';

export const THEMES = ['rates', 'inflation', 'growth', 'employment', 'activity', 'sentiment', 'surprises'] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_LABEL: Record<Theme, string> = {
  rates: 'Taux', inflation: 'Inflation', growth: 'Croissance', employment: 'Emploi', activity: 'Activité', sentiment: 'Sentiment', surprises: 'Surprises',
};
/** Thèmes qui ont un historique (backtest) ; activité (PMI) et surprises ne vivent que depuis le 23/11/2026. */
export const HISTORICAL_THEMES: Theme[] = ['rates', 'inflation', 'growth', 'employment', 'sentiment'];
export const Z_MAX = Math.sqrt(7);   // |z| maximal sur 8 valeurs, σ de population
export const MIN_ECONOMIES = 6;

/** Délai de publication (mois après la fin de la période) et fréquence attendue, par indicateur. */
export const LAG_MONTHS: Record<Indicator, { M: number; Q: number }> = {
  policy: { M: 0, Q: 0 }, cpi: { M: 1, Q: 1 }, cpi_core: { M: 1, Q: 1 }, gdp: { M: 2, Q: 2 },
  unemployment: { M: 1, Q: 2 }, confidence: { M: 1, Q: 1 }, retail: { M: 2, Q: 2 },
};

export interface Series { freq: 'M' | 'Q'; obs: Obs[] }
export type Panel = Partial<Record<Economy, Partial<Record<Indicator, Series>>>>;

/** Fin du mois (AAAA-MM-JJ) n mois après la fin de la période. */
function availableFrom(period: string, lagMonths: number): string {
  const end = periodEnd(period);
  return periodEnd(shiftPeriod(end.slice(0, 7), lagMonths));
}

/** Dernière observation publiée au jour `date` (AAAA-MM-JJ), délai de publication compris. */
export function asOf(s: Series | undefined, indicator: Indicator, date: string): { obs: Obs; index: number } | null {
  if (!s?.obs.length) return null;
  const lag = LAG_MONTHS[indicator][s.freq];
  for (let i = s.obs.length - 1; i >= 0; i--) {
    if (availableFrom(s.obs[i].period, lag) <= date) return { obs: s.obs[i], index: i };
  }
  return null;
}

/** Périmée : la période suivante attendue est publiée depuis plus d'une période. */
export function isStale(s: Series, indicator: Indicator, obs: Obs, date: string): boolean {
  const lag = LAG_MONTHS[indicator][s.freq];
  const twoLater = shiftPeriod(obs.period, 2);
  return availableFrom(twoLater, lag) < date;
}

export interface Cell {
  theme: Theme;
  x: number | null;            // signal brut
  value: number | null;        // chiffre affiché dans la case
  unit: '%' | 'pts' | '';
  period: string | null;
  indicator: Indicator | null;
  reason: string | null;       // raison du « — » ou de l'exclusion
  stale: boolean;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function lookup(panel: Panel, e: Economy, ind: Indicator, date: string) {
  const s = panel[e]?.[ind];
  const a = asOf(s, ind, date);
  if (!s || !a) return { s, a: null, reason: s ? 'aucune valeur publiée à cette date' : 'série absente' };
  if (isStale(s, ind, a.obs, date)) return { s, a, reason: `valeur périmée (${a.obs.period})` };
  return { s, a, reason: null };
}

/** Valeur n périodes plus tôt dans la même série (même fréquence). */
function back(s: Series, index: number, n: number): Obs | null {
  const want = shiftPeriod(s.obs[index].period, -n);
  for (let i = index; i >= 0; i--) if (s.obs[i].period === want) return s.obs[i];
  return null;
}

/** Signal d'un thème pour une économie à une date. */
export function cell(panel: Panel, e: Economy, theme: Theme, date: string): Cell {
  const empty = (reason: string, partial: Partial<Cell> = {}): Cell =>
    ({ theme, x: null, value: null, unit: '', period: null, indicator: null, reason, stale: false, ...partial });
  if (theme === 'activity') return empty('PMI relevés depuis le 23/11/2026 : comptent au score après 3 mois (T-056)');
  if (theme === 'surprises') return empty('surprises relevées depuis le 23/11/2026 : comptent au score après 3 mois (T-054)');
  const ind: Indicator = theme === 'rates' ? 'policy' : theme === 'inflation' ? 'cpi' : theme === 'growth' ? 'gdp'
    : theme === 'employment' ? 'unemployment' : 'confidence';
  const { s, a, reason } = lookup(panel, e, ind, date);
  const unit: Cell['unit'] = ind === 'confidence' ? 'pts' : '%';
  if (!s || !a) return empty(reason ?? 'série absente', { indicator: ind, unit });
  const base = { theme, unit, period: a.obs.period, indicator: ind, value: r2(a.obs.value) };
  if (reason) return { ...base, x: null, reason, stale: true };
  const v = a.obs.value;
  if (theme === 'rates') {
    const prev = back(s, a.index, 6);
    return { ...base, x: prev ? v + (v - prev.value) : v, reason: null, stale: false };
  }
  if (theme === 'inflation') return { ...base, x: v - INFLATION_TARGET[e].mid, reason: null, stale: false };
  if (theme === 'growth') {
    const hist = s.obs.slice(0, a.index).slice(-20);   // 5 ans de trimestres avant la valeur
    if (hist.length < 12) return { ...base, x: null, reason: 'moins de 3 ans d’historique pour la moyenne', stale: false };
    return { ...base, x: v - hist.reduce((t, o) => t + o.value, 0) / hist.length, reason: null, stale: false };
  }
  if (theme === 'employment') {
    const prev = back(s, a.index, s.freq === 'M' ? 3 : 1);
    if (!prev) return { ...base, x: null, reason: 'valeur d’il y a 3 mois absente', stale: false };
    return { ...base, x: -(v - prev.value), reason: null, stale: false };
  }
  // Sentiment : variation sur 3 mois rapportée à l'écart-type des variations du pays sur 5 ans (échelles différentes).
  const n = s.freq === 'M' ? 3 : 1;
  const prev = back(s, a.index, n);
  if (!prev) return { ...base, x: null, reason: 'valeur d’il y a 3 mois absente', stale: false };
  const changes: number[] = [];
  for (let i = Math.max(n, a.index - (s.freq === 'M' ? 60 : 20)); i <= a.index; i++) {
    const p = back(s, i, n);
    if (p) changes.push(s.obs[i].value - p.value);
  }
  const sd = std(changes);
  if (changes.length < 8 || sd === 0) return { ...base, x: null, reason: 'historique trop court pour comparer les échelles', stale: false };
  return { ...base, value: r2(v - prev.value), x: (v - prev.value) / sd, reason: null, stale: false };
}

export function std(xs: number[]): number {
  if (!xs.length) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

export type Bias = 'BULLISH' | 'NEUTRAL' | 'BEARISH';
export interface Scored {
  date: string;
  themes: Theme[];                                   // thèmes comptés
  excluded: { theme: Theme; reason: string }[];
  rows: { economy: Economy; score: number; rank: number; bias: Bias; cells: (Cell & { z: number | null; level: number | null })[] }[];
}

/** Niveau de couleur (−2 à +2) d'un z : seuils −1, −0,33, +0,33, +1. */
export function level(z: number): number {
  return z <= -1 ? -2 : z < -0.33 ? -1 : z <= 0.33 ? 0 : z < 1 ? 1 : 2;
}

export function scoreAt(panel: Panel, date: string, opts: { themes?: Theme[]; weights?: Partial<Record<Theme, number>> } = {}): Scored {
  const themes = opts.themes ?? [...THEMES];
  const grid = ECONOMIES.map((e) => themes.map((t) => cell(panel, e, t, date)));
  const zs: (number | null)[][] = ECONOMIES.map(() => themes.map(() => null));
  const counted: Theme[] = [];
  const excluded: { theme: Theme; reason: string }[] = [];
  themes.forEach((t, j) => {
    const xs = grid.map((row) => row[j].x).filter((x): x is number => x !== null);
    if (xs.length < MIN_ECONOMIES) {
      excluded.push({ theme: t, reason: xs.length ? `${xs.length} économies sur 8 seulement` : grid[0][j].reason ?? 'aucune donnée' });
      return;
    }
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = std(xs);
    counted.push(t);
    grid.forEach((row, i) => { zs[i][j] = row[j].x === null ? null : sd > 0 ? (row[j].x! - m) / sd : 0; });
  });
  const w = (t: Theme) => opts.weights?.[t] ?? 1;
  const wsum = counted.reduce((a, t) => a + w(t), 0);
  const raw = ECONOMIES.map((_, i) => wsum ? (100 * themes.reduce((a, t, j) => a + (counted.includes(t) ? w(t) * (zs[i][j] ?? 0) : 0), 0)) / (wsum * Z_MAX) : 0);
  const order = ECONOMIES.map((e, i) => ({ e, i, s: raw[i] })).sort((a, b) => b.s - a.s || a.e.localeCompare(b.e));
  const rows = order.map((o, k) => ({
    economy: o.e, score: Math.round(Math.max(-100, Math.min(100, o.s))), rank: k + 1,
    bias: (k < 3 ? 'BULLISH' : k >= 5 ? 'BEARISH' : 'NEUTRAL') as Bias,
    cells: grid[o.i].map((c, j) => ({ ...c, z: zs[o.i][j] === null ? null : Math.round(zs[o.i][j]! * 100) / 100,
      level: zs[o.i][j] === null ? null : level(zs[o.i][j]!) })),
  }));
  return { date, themes: counted, excluded, rows };
}
