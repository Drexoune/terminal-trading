// Diagnostics du backtest (section Backtest, étape S2), fonctions pures testées par Vitest :
//
// - Monte Carlo (graine fixe, reproductible) : ordre des trades permuté (risque de séquence : même
//   PnL final, autres drawdowns) et tirage avec remise (dispersion du résultat, risque de ruine).
//   Rendements composés sur le capital, comme la taille en % du capital ; drawdown au pas des trades.
// - Sociétés de financement (docs/exploration-bt.md § 4) : FTMO 2-Step (phases 1 et 2), FTMO 1-Step,
//   LucidFlex 25K. Journées coupées dans le fuseau de chaque société (FTMO : 00:00 Europe/Prague ;
//   Lucid : séance de 18:00 à 16:45 America/New_York). Pertes contrôlées sur le capital marqué à
//   chaque clôture de barre (les plus bas intrabarre ne sont pas vus : le dire à l'écran). PnL mis à
//   l'échelle du compte : taille du compte / capital du backtest.
// - Dans et hors échantillon : mesures de part et d'autre d'une date de coupure.

import { zonedParts } from '../lib/time';
import { metricsFromEquity, type Metrics, type OpenTrade, type Trade, type Trials } from './metrics';

// --- Monte Carlo ---------------------------------------------------------------------------------

/** Générateur pseudo-aléatoire mulberry32 : même graine, même suite. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Pctl { p5: number; p25: number; p50: number; p75: number; p95: number }
export function percentiles(x: number[]): Pctl {
  const s = [...x].sort((a, b) => a - b);
  const q = (p: number) => {
    if (!s.length) return NaN;
    const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  return { p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95) };
}

/** Rendement de chaque trade sur le capital réalisé avant lui (trades rangés par sortie). */
export function tradeReturns(trades: Trade[], initial: number): number[] {
  const sorted = [...trades].sort((a, b) => a.exit_bar - b.exit_bar || a.entry_bar - b.entry_bar);
  let eq = initial;
  return sorted.map((t) => { const r = t.pnl / eq; eq += t.pnl; return r; });
}

/** Parcours composé : rendement final (%) et drawdown maximal (%), au pas des trades. */
function path(r: number[]): { final: number; dd: number; ruined: (lim: number) => boolean; minEq: number } {
  let eq = 1, peak = 1, dd = 0, minEq = 1;
  for (const x of r) { eq *= 1 + x; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); minEq = Math.min(minEq, eq); }
  return { final: (eq - 1) * 100, dd: dd * 100, ruined: (lim) => dd * 100 >= lim, minEq };
}

export interface MonteCarlo {
  iterations: number; seed: number; trades: number; ruin_dd_pct: number;
  original: { final_pct: number; dd_pct: number };
  shuffle: { dd_pct: Pctl; worse_than_original_pct: number };
  bootstrap: { final_pct: Pctl; dd_pct: Pctl; p_loss: number; p_ruin: number };
}

export function monteCarlo(trades: Trade[], initial: number, opts: { iterations?: number; seed?: number; ruinDdPct?: number } = {}): MonteCarlo | null {
  const iterations = opts.iterations ?? 1000, seed = opts.seed ?? 42, ruin = opts.ruinDdPct ?? 50;
  const r = tradeReturns(trades, initial);
  if (r.length < 2) return null;
  const rand = rng(seed);
  const orig = path(r);
  const shDd: number[] = [], bFinal: number[] = [], bDd: number[] = [];
  let worse = 0, loss = 0, ruined = 0;
  const buf = [...r];
  for (let k = 0; k < iterations; k++) {
    // Permutation de Fisher et Yates.
    for (let i = buf.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [buf[i], buf[j]] = [buf[j], buf[i]]; }
    const p = path(buf);
    shDd.push(p.dd);
    if (p.dd > orig.dd) worse++;
    // Tirage avec remise.
    const draw = Array.from({ length: r.length }, () => r[Math.floor(rand() * r.length)]);
    const b = path(draw);
    bFinal.push(b.final); bDd.push(b.dd);
    if (b.final < 0) loss++;
    if (b.ruined(ruin)) ruined++;
  }
  return {
    iterations, seed, trades: r.length, ruin_dd_pct: ruin,
    original: { final_pct: orig.final, dd_pct: orig.dd },
    shuffle: { dd_pct: percentiles(shDd), worse_than_original_pct: (worse / iterations) * 100 },
    bootstrap: { final_pct: percentiles(bFinal), dd_pct: percentiles(bDd), p_loss: (loss / iterations) * 100, p_ruin: (ruined / iterations) * 100 },
  };
}

// --- Sociétés de financement ---------------------------------------------------------------------

export type FirmId = 'ftmo2_p1' | 'ftmo2_p2' | 'ftmo1' | 'lucid25';
export interface FirmRules {
  id: FirmId; label: string; account: number; tz: string; dayShiftH: number;
  target: number;                       // profit à atteindre, en devise
  dailyLoss: number | null;             // perte journalière autorisée, en devise (sous le solde de début de journée)
  dailyLossFails: boolean;              // FTMO : échec ; Lucid : séance bloquée seulement
  maxLoss: number;                      // perte maximale, en devise
  maxLossMode: 'static' | 'eod_trailing';
  trailLock: number | null;             // Lucid : seuil figé à compte + trailLock
  minDays: number;
  consistency: number | null;           // meilleur jour / profit total, au plus (0,4 = 40 %)
  sessionCloseHm: [number, number] | null;  // Lucid : positions fermées à 16:45 New York
  source: string;
}

export function firms(opts: { ftmoAccount?: number; lucidDll?: boolean; lucidConsistency?: 0.4 | 0.5 } = {}): FirmRules[] {
  const A = opts.ftmoAccount ?? 100_000;
  const ftmo = { tz: 'Europe/Prague', dayShiftH: 0, sessionCloseHm: null, trailLock: null, source: 'ftmo.com/en/trading-objectives, relevé du 24/11/2026' };
  return [
    { ...ftmo, id: 'ftmo2_p1', label: 'FTMO 2-Step · Challenge', account: A, target: 0.10 * A, dailyLoss: 0.05 * A, dailyLossFails: true,
      maxLoss: 0.10 * A, maxLossMode: 'static', minDays: 4, consistency: null },
    { ...ftmo, id: 'ftmo2_p2', label: 'FTMO 2-Step · Vérification', account: A, target: 0.05 * A, dailyLoss: 0.05 * A, dailyLossFails: true,
      maxLoss: 0.10 * A, maxLossMode: 'static', minDays: 4, consistency: null },
    { ...ftmo, id: 'ftmo1', label: 'FTMO 1-Step', account: A, target: 0.10 * A, dailyLoss: 0.03 * A, dailyLossFails: true,
      maxLoss: 0.10 * A, maxLossMode: 'eod_trailing', minDays: 0, consistency: 0.5 },
    { id: 'lucid25', label: 'LucidFlex 25K · Évaluation', account: 25_000, tz: 'America/New_York', dayShiftH: 6, target: 1250,
      dailyLoss: opts.lucidDll ? 600 : null, dailyLossFails: false, maxLoss: 1000, maxLossMode: 'eod_trailing', trailLock: 100, minDays: 0,
      consistency: opts.lucidConsistency ?? 0.4, sessionCloseHm: [16, 45],
      source: 'règles transmises par Clément (consolidation non officielle), à vérifier sur le tableau de bord Lucid' },
  ];
}

/** Clé de journée de la société : date locale de l'instant décalé (Lucid : séance 18:00 → 16:45). */
export function dayKey(ms: number, tz: string, shiftH: number): string {
  const p = zonedParts(ms + shiftH * 3_600_000, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export interface FirmInput {
  closeTimes: number[];          // heure de clôture de chaque barre (UTC, ms)
  equity: number[];              // capital marqué à chaque clôture
  balance: number[];             // capital réalisé (trades clos) à chaque clôture
  flat: boolean[];               // aucune position ouverte à la clôture
  trades: Trade[];
  capital: number;               // capital du backtest
}

export interface FirmResult {
  id: FirmId; label: string; account: number; source: string;
  status: 'passed' | 'failed' | 'running';
  at: string | null;             // jour (fuseau de la société) du passage ou de l'échec
  reason: string;
  days: number;                  // journées écoulées jusqu'au verdict (ou jusqu'à la fin)
  trading_days: number;
  best_day_pct: number | null;   // meilleur jour / profit total, en %
  dll_days: number;              // Lucid : séances bloquées par la DLL
  session_holds: number;         // Lucid : trades gardés au-delà de 16:45 New York
  scale: number;
}

/** Journée de la société pour chaque barre (calculée une fois : Intl est coûteux). */
export function barDays(r: FirmRules, x: FirmInput): string[] {
  return x.closeTimes.map((t) => dayKey(t, r.tz, r.dayShiftH));
}

/** Une évaluation à partir de la barre `start` (capital ramené au compte à cette barre). */
export function evaluateFirm(r: FirmRules, x: FirmInput, start = 0, days_: string[] = barDays(r, x)): FirmResult {
  const k = r.account / x.capital;
  const n = x.equity.length;
  const eq0 = x.equity[start], bal0 = x.balance[start];
  const E = (i: number) => r.account + (x.equity[i] - eq0) * k;
  const B = (i: number) => r.account + (x.balance[i] - bal0) * k;
  const base = { id: r.id, label: r.label, account: r.account, source: r.source, scale: k };
  // Jours de trading (une position ouverte dans la journée) et profit clos par jour.
  const entryDays = new Set<string>();
  const dayPnl = new Map<string, number>();
  let holds = 0;
  for (const t of x.trades) {
    if (t.entry_bar < start) continue;
    // L'entrée se fait à l'ouverture de la barre d'entrée : journée de la barre précédente close.
    const ed = days_[Math.max(0, t.entry_bar - 1)] ?? days_[t.entry_bar];
    entryDays.add(ed);
    if (t.exit_bar < n) {
      const d = days_[t.exit_bar];
      dayPnl.set(d, (dayPnl.get(d) ?? 0) + t.pnl * k);
      if (r.sessionCloseHm && ed !== d) holds++;
    }
  }
  let day = '', dayStartBal = r.account, maxEod = r.account, floor = r.account - r.maxLoss, days = 0, dll = 0, dllHit = false;
  const daysSeen: string[] = [];
  const tradedBefore = (d: string) => [...entryDays].filter((e) => e <= d).length;
  const bestDay = (d: string) => {
    let total = 0, best = 0;
    for (const [dd, p] of dayPnl) if (dd <= d) { total += p; best = Math.max(best, p); }
    return total > 0 ? best / total : null;
  };
  for (let i = start; i < n; i++) {
    const d = days_[i];
    if (d !== day) {
      // Nouvelle journée : solde de début (clôture de la journée précédente) et seuil suiveur.
      if (day) {
        const eod = B(i - 1);
        dayStartBal = eod;
        if (r.maxLossMode === 'eod_trailing') {
          maxEod = Math.max(maxEod, eod);
          floor = maxEod - r.maxLoss;
          if (r.trailLock !== null) floor = Math.min(floor, r.account + r.trailLock);
        }
      }
      day = d; days++; daysSeen.push(d); dllHit = false;
    }
    const e = E(i);
    if (e < floor) {
      return { ...base, status: 'failed', at: d, reason: `perte maximale franchie : capital ${Math.round(e)} sous le seuil de ${Math.round(floor)}`,
        days, trading_days: tradedBefore(d), best_day_pct: null, dll_days: dll, session_holds: holds };
    }
    if (r.dailyLoss !== null && e < dayStartBal - r.dailyLoss) {
      if (r.dailyLossFails) {
        return { ...base, status: 'failed', at: d, reason: `perte journalière franchie : capital ${Math.round(e)} sous ${Math.round(dayStartBal - r.dailyLoss)}`,
          days, trading_days: tradedBefore(d), best_day_pct: null, dll_days: dll, session_holds: holds };
      }
      if (!dllHit) { dll++; dllHit = true; }
    }
    if (x.flat[i] && B(i) >= r.account + r.target) {
      const td = tradedBefore(d), bd = bestDay(d);
      const consistencyOk = r.consistency === null || (bd !== null && bd <= r.consistency);
      if (td >= r.minDays && consistencyOk) {
        return { ...base, status: 'passed', at: d, reason: `objectif de ${Math.round(r.target)} atteint`, days, trading_days: td,
          best_day_pct: bd === null ? null : bd * 100, dll_days: dll, session_holds: holds };
      }
    }
  }
  const lastDay = daysSeen[daysSeen.length - 1] ?? '';
  const bd = bestDay(lastDay);
  const pnl = (n ? B(n - 1) : r.account) - r.account;
  const why = pnl >= r.target ? (r.consistency !== null && (bd ?? 1) > r.consistency ? 'objectif atteint mais règle de constance non tenue'
    : `objectif atteint, ${r.minDays} jours de trading non atteints`) : `objectif non atteint (${Math.round(pnl)} sur ${Math.round(r.target)})`;
  return { ...base, status: 'running', at: null, reason: why, days, trading_days: tradedBefore(lastDay), best_day_pct: bd === null ? null : bd * 100,
    dll_days: dll, session_holds: holds };
}

/** Départs au premier jour de chaque mois (fuseau de la société) : part des évaluations réussies. */
export function rollingStarts(r: FirmRules, x: FirmInput): { starts: number; passed: number; failed: number; running: number; median_days: number | null } {
  const days = barDays(r, x);
  const idx: number[] = [];
  let prev = '';
  for (let i = 0; i < days.length; i++) {
    const m = days[i].slice(0, 7);
    if (m !== prev) { idx.push(i); prev = m; }
  }
  let passed = 0, failed = 0, running = 0;
  const durations: number[] = [];
  for (const s of idx) {
    const v = evaluateFirm(r, x, s, days);
    if (v.status === 'passed') { passed++; durations.push(v.days); } else if (v.status === 'failed') failed++; else running++;
  }
  return { starts: idx.length, passed, failed, running, median_days: durations.length ? percentiles(durations).p50 : null };
}

/** Données des évaluations à partir des transactions et de la courbe de capital. */
export function firmInput(candleTimes: number[], step: number, equity: number[], trades: Trade[], open: OpenTrade[], capital: number): FirmInput {
  const n = candleTimes.length;
  const realizedAt = new Float64Array(n);
  const busy = new Int32Array(n + 1);
  for (const t of trades) {
    if (t.exit_bar < n) realizedAt[t.exit_bar] += t.pnl;
    if (t.entry_bar < t.exit_bar) { busy[t.entry_bar]++; busy[Math.min(n, t.exit_bar)]--; }
  }
  for (const o of open) { busy[o.entry_bar]++; busy[n]--; }
  const balance: number[] = [], flat: boolean[] = [];
  let acc = capital, open_ = 0;
  for (let i = 0; i < n; i++) { acc += realizedAt[i]; open_ += busy[i]; balance.push(acc); flat.push(open_ === 0); }
  return { closeTimes: candleTimes.map((t) => t + step - 1), equity, balance, flat, trades, capital };
}

// --- Dans et hors échantillon ---------------------------------------------------------------------

export interface Split { split_bar: number; is: Metrics; oos: Metrics; ratio_sharpe: number | null }

/**
 * Coupure à la barre `splitBar` : dans l'échantillon, les trades ouverts avant et la courbe de
 * capital jusqu'à la coupure ; hors échantillon, les trades ouverts ensuite et la suite de la
 * courbe (un trade à cheval compte dans l'échantillon, son PnL latent pèse sur la suite).
 */
export function splitSample(trades: Trade[], equity: number[], splitBar: number, capital: number, barsPerYear: number, trials?: Trials): Split | null {
  if (splitBar < 2 || splitBar > equity.length - 2) return null;
  const is = metricsFromEquity(trades.filter((t) => t.entry_bar < splitBar), equity.slice(0, splitBar), capital, barsPerYear, trials);
  const oos = metricsFromEquity(trades.filter((t) => t.entry_bar >= splitBar), equity.slice(splitBar - 1), equity[splitBar - 1], barsPerYear, trials);
  return { split_bar: splitBar, is, oos, ratio_sharpe: is.sharpe && oos.sharpe !== null ? oos.sharpe / is.sharpe : null };
}
