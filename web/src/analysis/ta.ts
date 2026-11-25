// Indicateurs techniques (P7, S2, T-075) : mêmes définitions que Pine Script (vérifiées contre
// pinets), calculés par le code. EMA amorcée par la moyenne simple ; RSI et ATR lissés à la Wilder
// (RMA amorcée par la moyenne simple) ; MACD 12/26/9. « null » tant que l'historique ne suffit pas.

export interface Ohlc { t: number; o: number; h: number; l: number; c: number }
type S = (number | null)[];

export function ema(xs: number[], n: number): S {
  const out: S = Array(xs.length).fill(null), a = 2 / (n + 1);
  let prev: number | null = null;
  for (let i = 0; i < xs.length; i++) {
    if (prev === null) { if (i >= n - 1) { prev = xs.slice(i - n + 1, i + 1).reduce((s, x) => s + x, 0) / n; out[i] = prev; } }
    else { prev = a * xs[i] + (1 - a) * prev; out[i] = prev; }
  }
  return out;
}

export function rma(xs: (number | null)[], n: number): S {
  const out: S = Array(xs.length).fill(null);
  let prev: number | null = null, buf: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (x === null) continue;
    if (prev === null) { buf.push(x); if (buf.length === n) { prev = buf.reduce((s, v) => s + v, 0) / n; out[i] = prev; buf = []; } }
    else { prev = (x + (n - 1) * prev) / n; out[i] = prev; }
  }
  return out;
}

export function rsi(c: number[], n = 14): S {
  const up: (number | null)[] = c.map((x, i) => (i ? Math.max(x - c[i - 1], 0) : null));
  const dn: (number | null)[] = c.map((x, i) => (i ? Math.max(c[i - 1] - x, 0) : null));
  const u = rma(up, n), d = rma(dn, n);
  return c.map((_, i) => { const a = u[i], b = d[i]; return a === null || b === null ? null : b === 0 ? 100 : a === 0 ? 0 : 100 - 100 / (1 + a / b); });
}

export function atr(bars: Ohlc[], n = 14): S {
  const tr = bars.map((b, i) => (i ? Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)) : b.h - b.l));
  return rma(tr, n);
}

export function macd(c: number[], fast = 12, slow = 26, sig = 9): { macd: S; signal: S; hist: S } {
  const f = ema(c, fast), s = ema(c, slow);
  const m: S = c.map((_, i) => (f[i] === null || s[i] === null ? null : f[i]! - s[i]!));
  const first = m.findIndex((x) => x !== null);
  const sg: S = Array(c.length).fill(null);
  if (first >= 0) ema(m.slice(first) as number[], sig).forEach((v, j) => { sg[first + j] = v; });
  return { macd: m, signal: sg, hist: m.map((x, i) => (x === null || sg[i] === null ? null : x - sg[i]!)) };
}

export type Trend = 'up' | 'neutral' | 'down';
export interface Snapshot {
  close: number; ema20: number | null; ema50: number | null; ema200: number | null; rsi: number | null;
  macd_hist: number | null; atr_pct: number | null; from_high: number | null;
  signals: { label: string; bull: boolean | null }[]; score: number; trend: Trend | null;
}

/** Dernier état d'une série : signaux explicables (±1 chacun), tendance si au moins 3 signaux dans le même sens. */
export function snapshot(bars: Ohlc[], highWindow: number): Snapshot | null {
  if (!bars.length) return null;
  const c = bars.map((b) => b.c), i = c.length - 1, last = (s: S) => s[i] ?? null;
  const e20 = last(ema(c, 20)), e50 = last(ema(c, 50)), e200 = last(ema(c, 200)), r = last(rsi(c)), h = last(macd(c).hist), a = last(atr(bars));
  const hi = Math.max(...bars.slice(-highWindow).map((b) => b.h));
  const cmp = (x: number | null, y: number | null) => (x === null || y === null ? null : x > y);
  const signals = [
    { label: 'clôture > EMA 20', bull: cmp(c[i], e20) },
    { label: 'EMA 20 > EMA 50', bull: cmp(e20, e50) },
    { label: 'EMA 50 > EMA 200', bull: cmp(e50, e200) },
    { label: 'MACD au-dessus du signal', bull: h === null ? null : h > 0 },
    { label: 'RSI 14 > 50', bull: r === null ? null : r > 50 },
  ];
  const known = signals.filter((s) => s.bull !== null);
  const score = known.reduce((s, x) => s + (x.bull ? 1 : -1), 0);
  return {
    close: c[i], ema20: e20, ema50: e50, ema200: e200, rsi: r, macd_hist: h, atr_pct: a === null ? null : a / c[i],
    from_high: bars.length >= highWindow ? c[i] / hi - 1 : null, signals, score,
    trend: known.length < 4 ? null : score >= 3 ? 'up' : score <= -3 ? 'down' : 'neutral',
  };
}
