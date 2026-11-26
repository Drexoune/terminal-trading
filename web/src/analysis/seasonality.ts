// Saisonnalité (P7, S1, T-075) : statistiques des rendements par mois, jour de semaine, jour du mois
// et heure de Paris, calculées par le code sur nos bougies (bt_candles : OKX pour BTC et ETH, Tiingo
// ajusté pour QQQ et SPY). Aucune prévision : des moyennes historiques, avec leur nombre
// d'observations et la mention « échantillon faible » sous un seuil.
//
// Conventions :
// - bougie quotidienne : date de la bougie = date UTC de son ouverture (OKX 1Dutc, Tiingo à 00:00 UTC) ;
// - rendement quotidien : clôture / clôture précédente − 1 (au moins un jour d'écart, sans trou de plus de 5 jours) ;
// - rendement mensuel : dernière clôture du mois / dernière clôture du mois précédent − 1 ;
// - rendement horaire : clôture / ouverture − 1, regroupé par heure de Paris de l'ouverture (fuseau
//   IANA : les changements d'heure sont pris en compte bougie par bougie).

import { zonedParts } from '../lib/time';

export interface Bar { t: number; o: number; h: number; l: number; c: number }
export interface Bucket { key: number; label: string; n: number; mean: number | null; median: number | null; up: number | null; sd: number | null; t: number | null; weak: boolean }
export interface YearPath { year: number; points: (number | null)[] }      // cumul depuis le 1er janvier, index = jour de l'année − 1
export interface Seasonality {
  asset: string; label: string; source: string;
  from: number | null; to: number | null; bars_daily: number; bars_hourly: number;
  months: Bucket[]; weekdays: Bucket[]; monthdays: Bucket[]; hours: Bucket[];
  avg_path: (number | null)[]; current: YearPath | null; years: number;
  computed_ms: number;
}

export const MIN_N = { month: 8, weekday: 30, monthday: 30, hour: 100 } as const;
const DAY = 86_400_000;
const MAX_GAP = 5 * DAY;
export const PARIS = 'Europe/Paris';
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WEEKDAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

/** Statistiques d'une liste de rendements (fractions). */
export function stats(xs: number[], minN: number): Omit<Bucket, 'key' | 'label'> {
  const n = xs.length;
  if (!n) return { n, mean: null, median: null, up: null, sd: null, t: null, weak: true };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const s = [...xs].sort((a, b) => a - b);
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const up = xs.filter((x) => x > 0).length / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : null;
  const t = sd && sd > 0 ? mean / (sd / Math.sqrt(n)) : null;
  return { n, mean, median, up, sd, t, weak: n < minN };
}

const sorted = (bars: Bar[]) => [...bars].filter((b) => Number.isFinite(b.c) && b.c > 0).sort((a, b) => a.t - b.t);
const utc = (ms: number) => { const d = new Date(ms); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: ((d.getUTCDay() + 6) % 7) + 1 }; };

/** Rendements quotidiens datés (date UTC de la bougie du jour). */
export function dailyReturns(daily: Bar[]): { t: number; r: number }[] {
  const s = sorted(daily), out: { t: number; r: number }[] = [];
  for (let i = 1; i < s.length; i++) {
    const gap = s[i].t - s[i - 1].t;
    if (gap >= DAY - 3_600_000 && gap <= MAX_GAP) out.push({ t: s[i].t, r: s[i].c / s[i - 1].c - 1 });
  }
  return out;
}

/** Rendements mensuels : dernière clôture du mois / dernière clôture du mois précédent − 1 (mois complets seulement). */
export function monthlyReturns(daily: Bar[], now: number): { y: number; m: number; r: number }[] {
  const last = new Map<string, { y: number; m: number; c: number }>();
  for (const b of sorted(daily)) { const p = utc(b.t); last.set(`${p.y}-${p.m}`, { y: p.y, m: p.m, c: b.c }); }
  const cur = utc(now), months = [...last.values()], out: { y: number; m: number; r: number }[] = [];
  for (let i = 1; i < months.length; i++) {
    const a = months[i - 1], b = months[i];
    const consecutive = (b.y * 12 + b.m) - (a.y * 12 + a.m) === 1;
    const complete = !(b.y === cur.y && b.m === cur.m);
    if (consecutive && complete) out.push({ y: b.y, m: b.m, r: b.c / a.c - 1 });
  }
  return out;
}

function buckets(count: number, first: number, label: (k: number) => string, values: Map<number, number[]>, minN: number): Bucket[] {
  return Array.from({ length: count }, (_, i) => { const key = first + i; return { key, label: label(key), ...stats(values.get(key) ?? [], minN) }; });
}
const push = (m: Map<number, number[]>, k: number, v: number) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };

/** Jour de l'année (1 à 366) d'une date UTC. */
export function dayOfYear(ms: number): number {
  const d = new Date(ms);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY) + 1;
}

/** Trajectoire d'une année : cumul depuis la dernière clôture de l'année précédente, reporté les jours sans cotation. */
export function yearPath(daily: Bar[], year: number): YearPath | null {
  const s = sorted(daily);
  const prev = [...s].reverse().find((b) => utc(b.t).y < year);
  const inYear = s.filter((b) => utc(b.t).y === year);
  if (!prev || !inYear.length || year - utc(prev.t).y > 1) return null;
  const points: (number | null)[] = Array(366).fill(null);
  for (const b of inYear) points[dayOfYear(b.t) - 1] = b.c / prev.c - 1;
  const lastDay = dayOfYear(inYear[inYear.length - 1].t);
  let carry: number | null = 0;
  for (let i = 0; i < lastDay; i++) { if (points[i] === null) points[i] = carry; else carry = points[i]; }
  return { year, points };
}

export function seasonality(asset: string, label: string, source: string, daily: Bar[], hourly: Bar[], now: number): Seasonality {
  const d = sorted(daily), h = sorted(hourly);
  const months = new Map<number, number[]>(), wds = new Map<number, number[]>(), mds = new Map<number, number[]>(), hrs = new Map<number, number[]>();
  for (const x of monthlyReturns(d, now)) push(months, x.m, x.r);
  for (const x of dailyReturns(d)) { const p = utc(x.t); push(wds, p.wd, x.r); push(mds, p.d, x.r); }
  for (const b of h) if (b.o > 0) push(hrs, zonedParts(b.t, PARIS).h, b.c / b.o - 1);

  const curYear = utc(now).y;
  const years = [...new Set(d.map((b) => utc(b.t).y))].filter((y) => y < curYear);
  const paths = years.map((y) => yearPath(d, y)).filter((p): p is YearPath => !!p && p.points.filter((x) => x !== null).length >= 300);
  const avg_path = Array.from({ length: 366 }, (_, i) => {
    const xs = paths.map((p) => p.points[i]).filter((x): x is number => x !== null);
    // jour couvert par la moitié des années ou moins (366e jour, hors années bissextiles) : non tracé
    return xs.length && xs.length * 2 > paths.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  });

  return {
    asset, label, source,
    from: d[0]?.t ?? null, to: d[d.length - 1]?.t ?? null, bars_daily: d.length, bars_hourly: h.length,
    months: buckets(12, 1, (k) => MONTHS[k - 1], months, MIN_N.month),
    weekdays: buckets(7, 1, (k) => WEEKDAYS[k - 1], wds, MIN_N.weekday).filter((b) => b.n > 0),
    monthdays: buckets(31, 1, String, mds, MIN_N.monthday),
    hours: h.length ? buckets(24, 0, (k) => `${String(k).padStart(2, '0')} h`, hrs, MIN_N.hour) : [],
    avg_path, current: yearPath(d, curYear), years: paths.length, computed_ms: now,
  };
}
