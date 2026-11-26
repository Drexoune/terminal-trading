// Options BTC (P7, S3, T-075) : calculs du code sur le résumé public de Deribit
// (public/get_book_summary_by_currency) : vol implicite « mark » de chaque option, open interest,
// prix à terme de chaque échéance (underlying_price). Deribit ne donne pas les deltas dans ce
// résumé : delta de Black-Scholes sur le prix à terme, taux nul (convention des greeks de Deribit,
// vérifiée contre public/ticker). Aucune estimation de liquidations ni de « max pain ».

export interface SummaryRow { instrument_name: string; mark_iv: number | null; open_interest: number | null; underlying_price: number | null; volume_usd?: number | null }
export interface Parsed { name: string; expiry: number; strike: number; type: 'C' | 'P' }
export interface SmilePoint { strike: number; iv: number; delta: number; oi_c: number; oi_p: number }
export interface Expiry {
  expiry: number; label: string; days: number; forward: number;
  atm: number | null; rr25: number | null; bf25: number | null;
  oi_c: number; oi_p: number; smile: SmilePoint[];
}
export interface OptionsSnapshot {
  at: number; index: number | null; dvol: number | null;
  expiries: Expiry[]; atm30: number | null; rr25_30: number | null; bf25_30: number | null;
  oi_c: number; oi_p: number; pcr: number | null; instruments: number;
}

const MON: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const YEAR_MS = 365 * 86_400_000;

/** BTC-26NOV26-60000-C → échéance 08:00 UTC (règlement de Deribit), strike, type. */
export function parseName(name: string): Parsed | null {
  const m = /^BTC-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-([CP])$/.exec(name);
  if (!m || MON[m[2]] === undefined) return null;
  return { name, expiry: Date.UTC(2000 + Number(m[3]), MON[m[2]], Number(m[1]), 8), strike: Number(m[4]), type: m[5] as 'C' | 'P' };
}

/** Fonction de répartition de la loi normale (Abramowitz et Stegun 7.1.26 via erf, erreur < 1,5e-7). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Delta de Black-Scholes sur le prix à terme, taux nul ; iv en fraction. */
export function bsDelta(type: 'C' | 'P', forward: number, strike: number, iv: number, years: number): number {
  const s = iv * Math.sqrt(years);
  const d1 = (Math.log(forward / strike) + 0.5 * s * s) / s;
  return type === 'C' ? normCdf(d1) : normCdf(d1) - 1;
}

/** Interpolation linéaire de y en x (xs croissants) ; null hors de l'intervalle couvert. */
export function interp(xs: number[], ys: number[], x: number): number | null {
  if (!xs.length || x < xs[0] || x > xs[xs.length - 1]) return null;
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) { const w = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1); return ys[i - 1] + w * (ys[i] - ys[i - 1]); }
  }
  return ys[ys.length - 1];
}

const fmtExpiry = (ms: number) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: '2-digit', month: 'short', year: '2-digit' }).format(ms);

/** Une échéance : sourire (option hors de la monnaie à chaque strike), vol ATM, risk reversal et butterfly 25 delta (points de vol). */
export function buildExpiry(rows: { p: Parsed; r: SummaryRow }[], now: number): Expiry | null {
  const forward = rows.find((x) => x.r.underlying_price)?.r.underlying_price ?? null;
  const expiry = rows[0]?.p.expiry;
  if (!forward || !expiry || expiry <= now) return null;
  const years = (expiry - now) / YEAR_MS;
  const byStrike = new Map<number, { c?: SummaryRow; p?: SummaryRow }>();
  for (const { p, r } of rows) { const e = byStrike.get(p.strike) ?? {}; if (p.type === 'C') e.c = r; else e.p = r; byStrike.set(p.strike, e); }
  const smile: SmilePoint[] = [];
  let oi_c = 0, oi_p = 0;
  for (const [strike, e] of [...byStrike.entries()].sort((a, b) => a[0] - b[0])) {
    oi_c += e.c?.open_interest ?? 0; oi_p += e.p?.open_interest ?? 0;
    const otm = strike >= forward ? e.c : e.p;
    const iv = otm?.mark_iv ?? (strike >= forward ? e.p : e.c)?.mark_iv ?? null;
    if (!iv || iv <= 0) continue;
    smile.push({ strike, iv, delta: bsDelta('C', forward, strike, iv / 100, years), oi_c: e.c?.open_interest ?? 0, oi_p: e.p?.open_interest ?? 0 });
  }
  const lk = smile.map((s) => Math.log(s.strike / forward));
  const atm = interp(lk, smile.map((s) => s.iv), 0);
  // vol en fonction du delta du call (décroissant avec le strike) : 25 delta call = 0,25 ; 25 delta put = call 0,75.
  const byDelta = [...smile].sort((a, b) => a.delta - b.delta);
  const dx = byDelta.map((s) => s.delta), dy = byDelta.map((s) => s.iv);
  const c25 = interp(dx, dy, 0.25), p25 = interp(dx, dy, 0.75);
  return {
    expiry, label: fmtExpiry(expiry), days: (expiry - now) / 86_400_000, forward, atm,
    rr25: c25 !== null && p25 !== null ? c25 - p25 : null,
    bf25: c25 !== null && p25 !== null && atm !== null ? (c25 + p25) / 2 - atm : null,
    oi_c, oi_p, smile,
  };
}

/** Valeur à 30 jours : interpolation en variance totale (ATM) ou linéaire en jours (skew), entre les deux échéances qui encadrent. */
export function at30(exps: Expiry[], pick: (e: Expiry) => number | null, variance: boolean): number | null {
  const pts = exps.map((e) => ({ d: e.days, v: pick(e) })).filter((x): x is { d: number; v: number } => x.v !== null && x.d > 0.5);
  if (!pts.length) return null;
  const T = 30;
  const lo = [...pts].reverse().find((x) => x.d <= T), hi = pts.find((x) => x.d >= T);
  if (!lo || !hi) return null;
  if (lo.d === hi.d) return lo.v;
  const w = (T - lo.d) / (hi.d - lo.d);
  if (!variance) return lo.v + w * (hi.v - lo.v);
  const tv = lo.v ** 2 * lo.d + w * (hi.v ** 2 * hi.d - lo.v ** 2 * lo.d);
  return Math.sqrt(tv / T);
}

export function snapshotOptions(rows: SummaryRow[], index: number | null, dvol: number | null, now: number): OptionsSnapshot {
  const groups = new Map<number, { p: Parsed; r: SummaryRow }[]>();
  let n = 0;
  for (const r of rows) {
    const p = parseName(r.instrument_name);
    if (!p) continue;
    n++;
    const g = groups.get(p.expiry); if (g) g.push({ p, r }); else groups.set(p.expiry, [{ p, r }]);
  }
  const expiries = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => buildExpiry(g, now)).filter((e): e is Expiry => !!e);
  const oi_c = expiries.reduce((s, e) => s + e.oi_c, 0), oi_p = expiries.reduce((s, e) => s + e.oi_p, 0);
  return {
    at: now, index, dvol, expiries,
    atm30: at30(expiries, (e) => e.atm, true), rr25_30: at30(expiries, (e) => e.rr25, false), bf25_30: at30(expiries, (e) => e.bf25, false),
    oi_c, oi_p, pcr: oi_c > 0 ? oi_p / oi_c : null, instruments: n,
  };
}

/** Point d'historique (toutes les 5 min, gardé sur la machine). */
export interface HistPoint { t: number; index: number | null; dvol: number | null; atm30: number | null; rr25: number | null; bf25: number | null; pcr: number | null }
export const histPoint = (s: OptionsSnapshot): HistPoint => ({ t: s.at, index: s.index, dvol: s.dvol, atm30: s.atm30, rr25: s.rr25_30, bf25: s.bf25_30, pcr: s.pcr });

/** Historique réduit à un point par pas (le dernier de chaque pas), pour l'écran. */
export function downsample(points: HistPoint[], stepMs: number, fromMs: number): HistPoint[] {
  const out = new Map<number, HistPoint>();
  for (const p of points) if (p.t >= fromMs) out.set(Math.floor(p.t / stepMs), p);
  return [...out.values()].sort((a, b) => a.t - b.t);
}
