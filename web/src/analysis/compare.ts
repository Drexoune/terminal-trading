// Comparaison de deux actifs sur un an : calculs du code sur les clôtures quotidiennes servies par
// /api/p1/daily. Dates communes seulement (les cryptos cotent le week-end, les fonds non) : chaque
// rendement est pris entre deux dates communes consécutives, pour comparer la même période.

export interface DailyPoint { d: string; c: number; o?: number; h?: number; l?: number }
export interface SideStats { first: number; last: number; ret: number; vol: number | null; maxDD: number; best: { d: string; r: number } | null; worst: { d: string; r: number } | null }
export interface Comparison {
  from: string; to: string; days: number;
  dates: string[]; normA: number[]; normB: number[]; ratio: number[];
  a: SideStats; b: SideStats;
  corr: number | null; beta: number | null; rolling: { d: string; corr: number }[];
  diff: number;                                     // écart de performance, en points de pourcentage
}

export const YEAR_DAYS = 365;
export const ROLL = 30;

/** Clôtures communes aux deux séries sur la fenêtre [fin − jours, fin]. */
export function align(a: DailyPoint[], b: DailyPoint[], days = YEAR_DAYS): { d: string; a: number; b: number }[] {
  const mb = new Map(b.map((p) => [p.d, p.c]));
  const both = a.filter((p) => mb.has(p.d)).map((p) => ({ d: p.d, a: p.c, b: mb.get(p.d)! })).sort((x, y) => x.d.localeCompare(y.d));
  if (!both.length) return [];
  const end = Date.parse(`${both[both.length - 1].d}T00:00:00Z`);
  const start = new Date(end - days * 86_400_000).toISOString().slice(0, 10);
  return both.filter((p) => p.d >= start);
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
export function correlation(x: number[], y: number[]): number | null {
  if (x.length < 3 || x.length !== y.length) return null;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Baisse maximale depuis un plus haut, en fraction (négative ou nulle). */
export function maxDrawdown(xs: number[]): number {
  let peak = -Infinity, dd = 0;
  for (const x of xs) { peak = Math.max(peak, x); dd = Math.min(dd, x / peak - 1); }
  return dd;
}

function side(closes: number[], rets: number[], dates: string[], perYear: number): SideStats {
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((s, r) => s + (r - mean(rets)) ** 2, 0) / (rets.length - 1)) : null;
  let best: SideStats['best'] = null, worst: SideStats['worst'] = null;
  rets.forEach((r, i) => { if (!best || r > best.r) best = { d: dates[i + 1], r }; if (!worst || r < worst.r) worst = { d: dates[i + 1], r }; });
  return { first: closes[0], last: closes[closes.length - 1], ret: closes[closes.length - 1] / closes[0] - 1, vol: sd === null ? null : sd * Math.sqrt(perYear), maxDD: maxDrawdown(closes), best, worst };
}

export function compare(a: DailyPoint[], b: DailyPoint[], days = YEAR_DAYS): Comparison | null {
  const rows = align(a, b, days);
  if (rows.length < 20) return null;
  const dates = rows.map((r) => r.d), ca = rows.map((r) => r.a), cb = rows.map((r) => r.b);
  const ra = ca.slice(1).map((c, i) => c / ca[i] - 1), rb = cb.slice(1).map((c, i) => c / cb[i] - 1);
  const perYear = rows.length / (days / 365);       // observations par an (≈ 252 en séances, 365 en cryptos seules)
  const corr = correlation(ra, rb);
  const vb = rb.length > 1 ? rb.reduce((s, r) => s + (r - mean(rb)) ** 2, 0) : 0;
  const cov = ra.reduce((s, r, i) => s + (r - mean(ra)) * (rb[i] - mean(rb)), 0);
  const rolling: Comparison['rolling'] = [];
  for (let i = ROLL; i <= ra.length; i++) { const c = correlation(ra.slice(i - ROLL, i), rb.slice(i - ROLL, i)); if (c !== null) rolling.push({ d: dates[i], corr: c }); }
  const A = side(ca, ra, dates, perYear), B = side(cb, rb, dates, perYear);
  return {
    from: dates[0], to: dates[dates.length - 1], days: rows.length, dates,
    normA: ca.map((c) => (c / ca[0]) * 100), normB: cb.map((c) => (c / cb[0]) * 100),
    ratio: ca.map((c, i) => (c / cb[i]) / (ca[0] / cb[0]) * 100),
    a: A, b: B, corr, beta: vb > 0 ? cov / vb : null, rolling, diff: (A.ret - B.ret) * 100,
  };
}
