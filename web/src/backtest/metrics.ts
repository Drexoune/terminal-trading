// Mesures du backtest (section Backtest, T-061, T-062), fonctions pures testées par Vitest et
// recoupées par un script Python indépendant (scripts/bt_reference.py). Définitions :
//
// - Transactions : celles closes par l'émulateur de PineTS (PnL net des commissions). Une position
//   encore ouverte à la fin compte dans la courbe de capital, pas dans les statistiques par trade.
// - Rendement d'un trade : PnL / (|taille| × prix d'entrée), sur le notionnel de la position.
// - Courbe de capital, à chaque clôture de barre : capital initial + PnL des trades clos jusque-là
//   + PnL latent des positions ouvertes (taille × (clôture − prix d'entrée), sans commission).
// - Rendements par barre : variation relative du capital d'une barre à l'autre.
// - Taux de réussite : part des trades à PnL > 0. RR : gain moyen / |perte moyenne|.
// - E[X] : PnL moyen par trade (devise) et rendement moyen par trade (%).
// - Drawdown maximal : plus grande baisse du capital depuis son plus haut, en % et en devise.
// - Sharpe : moyenne / écart type (n − 1) des rendements par barre, × √(barres par an), taux sans
//   risque nul.
// - t-stat : rendement moyen par trade / (écart type (n − 1) / √n).
// - Sharpe déflaté (Bailey et López de Prado, 2014) : probabilité que le vrai Sharpe dépasse le
//   plus haut Sharpe attendu par chance parmi N essais, compte tenu de l'asymétrie et de
//   l'aplatissement (non centré) des rendements par barre. N = 1 : seuil nul (Sharpe probabiliste).

export interface Candle { t: number; o: number; h: number; l: number; c: number }
export interface Trade {
  side: 'long' | 'short'; entry_bar: number; entry_time: number; entry_price: number;
  exit_bar: number; exit_time: number; exit_price: number; size: number; pnl: number; commission: number;
  entry_id: string; exit_id: string | null;
}
export interface OpenTrade { side: 'long' | 'short'; entry_bar: number; entry_price: number; size: number }
export interface Trials { n: number; srVariance: number }

export interface Metrics {
  trades: number; wins: number; losses: number;
  winrate: number | null;
  total_pnl: number; total_pnl_pct: number;
  rr: number | null;
  ex_pnl: number | null; ex_ret_pct: number | null;
  max_dd_pct: number; max_dd: number;
  sharpe: number | null; sharpe_bar: number | null;
  t_stat: number | null;
  dsr: number | null; sr0_bar: number | null; trials: number; skew: number | null; kurtosis: number | null; bars: number;
  profit_factor: number | null; gross_win: number; gross_loss: number;
  final_equity: number;
}

const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
function sd(x: number[]): number {
  if (x.length < 2) return NaN;
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1));
}

/** Fonction de répartition de la loi normale (série de Marsaglia, 2004 : précision ~1e-15 pour |x| < 8). */
export function normCdf(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;
  let s = x, t = 0, b = x, i = 1;
  const q = x * x;
  while (s !== t) { t = s; i += 2; b *= q / i; s = t + b; }
  return 0.5 + s * Math.exp(-0.5 * q - 0.91893853320467274178);
}

/** Quantile de la loi normale (algorithme d'Acklam, erreur relative < 1,2e-9). */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lo) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

const EULER = 0.5772156649015329;

/** Plus haut Sharpe attendu par chance parmi N essais de variance V (même unité que le Sharpe). */
export function expectedMaxSharpe(n: number, variance: number): number {
  if (n <= 1 || !(variance > 0)) return 0;
  return Math.sqrt(variance) * ((1 - EULER) * normInv(1 - 1 / n) + EULER * normInv(1 - 1 / (n * Math.E)));
}

/** Sharpe déflaté : Φ((SR − SR0)·√(T − 1) / √(1 − γ3·SR + (γ4 − 1)/4·SR²)), tout par barre. */
export function deflatedSharpe(sr: number, sr0: number, t: number, skew: number, kurt: number): number | null {
  const den = 1 - skew * sr + ((kurt - 1) / 4) * sr * sr;
  if (t < 2 || !(den > 0)) return null;
  return normCdf(((sr - sr0) * Math.sqrt(t - 1)) / Math.sqrt(den));
}

/** Asymétrie et aplatissement (non centré : 3 pour la loi normale), moments de population. */
export function moments(x: number[]): { skew: number; kurt: number } | null {
  if (x.length < 3) return null;
  const m = mean(x);
  const m2 = x.reduce((s, v) => s + (v - m) ** 2, 0) / x.length;
  if (!(m2 > 0)) return null;
  const m3 = x.reduce((s, v) => s + (v - m) ** 3, 0) / x.length;
  const m4 = x.reduce((s, v) => s + (v - m) ** 4, 0) / x.length;
  return { skew: m3 / m2 ** 1.5, kurt: m4 / (m2 * m2) };
}

/** Courbe de capital marquée à chaque clôture (voir l'en-tête). */
export function equityCurve(candles: Candle[], trades: Trade[], open: OpenTrade[], initial: number): number[] {
  // Balayage : positions ajoutées à leur barre d'entrée, retirées à leur barre de sortie ; le
  // latent d'une barre ne parcourt que les positions ouvertes (une poignée), pas tous les trades.
  const n = candles.length;
  const realizedAt = new Float64Array(n);
  const starts: { bar: number; end: number; size: number; price: number }[] = [];
  for (const tr of trades) {
    if (tr.exit_bar < n) realizedAt[tr.exit_bar] += tr.pnl;
    if (tr.entry_bar < tr.exit_bar) starts.push({ bar: tr.entry_bar, end: tr.exit_bar, size: tr.size, price: tr.entry_price });
  }
  for (const tr of open) starts.push({ bar: tr.entry_bar, end: n, size: tr.size, price: tr.entry_price });
  starts.sort((a, b) => a.bar - b.bar);
  const out: number[] = [];
  let realized = 0, k = 0;
  let active: typeof starts = [];
  for (let i = 0; i < n; i++) {
    realized += realizedAt[i];
    while (k < starts.length && starts[k].bar <= i) active.push(starts[k++]);
    active = active.filter((p) => i < p.end);
    let latent = 0;
    for (const p of active) latent += p.size * (candles[i].c - p.price);
    out.push(initial + realized + latent);
  }
  return out;
}

export function computeMetrics(candles: Candle[], trades: Trade[], open: OpenTrade[], initial: number, barsPerYear: number,
  trials: Trials = { n: 1, srVariance: 0 }): Metrics & { equity: number[] } {
  return metricsFromEquity(trades, equityCurve(candles, trades, open, initial), initial, barsPerYear, trials);
}

/**
 * Mesures à partir d'une courbe de capital déjà calculée : sert aussi aux segments (dans et hors
 * échantillon), où la courbe est une tranche de la courbe complète et `base` son capital de départ.
 */
export function metricsFromEquity(trades: Trade[], equity: number[], base: number, barsPerYear: number,
  trials: Trials = { n: 1, srVariance: 0 }): Metrics & { equity: number[] } {
  const initial = base;
  const pnl = trades.map((t) => t.pnl);
  const ret = trades.map((t) => t.pnl / (Math.abs(t.size) * t.entry_price));
  const wins = pnl.filter((p) => p > 0), losses = pnl.filter((p) => p <= 0);
  const grossWin = wins.reduce((s, v) => s + v, 0), grossLoss = -losses.filter((p) => p < 0).reduce((s, v) => s + v, 0);
  const total = pnl.reduce((s, v) => s + v, 0);
  // Drawdown
  let peak = -Infinity, ddPct = 0, dd = 0;
  for (const e of equity) { peak = Math.max(peak, e); if (peak > 0) { ddPct = Math.max(ddPct, (peak - e) / peak); dd = Math.max(dd, peak - e); } }
  // Rendements par barre
  const r: number[] = [];
  for (let i = 1; i < equity.length; i++) if (equity[i - 1] > 0) r.push(equity[i] / equity[i - 1] - 1);
  const s = sd(r);
  const srBar = r.length > 1 && s > 0 ? mean(r) / s : null;
  const mo = moments(r);
  const sr0 = expectedMaxSharpe(trials.n, trials.srVariance);
  const tSd = sd(ret);
  const avgLoss = losses.filter((p) => p < 0);
  return {
    trades: trades.length, wins: wins.length, losses: losses.length,
    winrate: trades.length ? wins.length / trades.length : null,
    total_pnl: total, total_pnl_pct: (total / initial) * 100,
    rr: wins.length && avgLoss.length ? mean(wins) / Math.abs(mean(avgLoss)) : null,
    ex_pnl: trades.length ? mean(pnl) : null, ex_ret_pct: trades.length ? mean(ret) * 100 : null,
    max_dd_pct: ddPct * 100, max_dd: dd,
    sharpe: srBar === null ? null : srBar * Math.sqrt(barsPerYear), sharpe_bar: srBar,
    t_stat: ret.length > 1 && tSd > 0 ? mean(ret) / (tSd / Math.sqrt(ret.length)) : null,
    dsr: srBar !== null && mo ? deflatedSharpe(srBar, sr0, r.length, mo.skew, mo.kurt) : null,
    sr0_bar: sr0, trials: Math.max(1, trials.n), skew: mo?.skew ?? null, kurtosis: mo?.kurt ?? null, bars: r.length,
    profit_factor: grossLoss > 0 ? grossWin / grossLoss : null, gross_win: grossWin, gross_loss: grossLoss,
    final_equity: equity[equity.length - 1] ?? initial,
    equity,
  };
}

/** Barres par an selon l'actif et l'unité de temps (crypto : 24/7 ; ETF : 252 séances). */
export function barsPerYear(asset: string, tf: string): number {
  const crypto = asset === 'BTC' || asset === 'ETH';
  if (tf === '1H') return crypto ? 8760 : 252 * 6.5;
  if (tf === '4H') return crypto ? 2190 : 252 * 1.625;
  return crypto ? 365 : 252;
}

/** Nombre d'essais et variance de leurs Sharpe (par barre), pour le Sharpe déflaté. */
export function trialStats(srs: number[]): Trials {
  if (srs.length < 2) return { n: Math.max(1, srs.length), srVariance: 0 };
  const s = sd(srs);
  return { n: srs.length, srVariance: s * s };
}

/** Tuiles notées (T-061) : la note qualifie l'importance de la mesure, pas le résultat. */
export const GRADED = [
  { key: 'winrate', label: 'Taux de réussite', grade: 'E' },
  { key: 'total_pnl', label: 'PnL total', grade: 'D' },
  { key: 'rr', label: 'RR', grade: 'C' },
  { key: 'ex', label: 'Espérance E[X]', grade: 'B' },
  { key: 'max_dd', label: 'Drawdown maximal', grade: 'B' },
  { key: 'sharpe', label: 'Sharpe', grade: 'A' },
  { key: 't_stat', label: 't-stat', grade: 'A' },
  { key: 'dsr', label: 'Sharpe déflaté', grade: 'S' },
] as const;
