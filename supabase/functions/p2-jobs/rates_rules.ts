// Règles de l'écran Taux (plan P2, étape R1) : modules purs, testés par Vitest sur les réponses
// réelles relevées en R0 (fixtures/). Aucune valeur n'est inventée : une issue sans prix reste
// absente, une source sans marché porte sa raison.
//
// Issues normalisées (jamais par l'ordre des marchés, qui varie d'une banque à l'autre) :
//   m50 = baisse de 50 pb ou plus, m25 = baisse de 25 pb, hold = statu quo,
//   p25 = hausse de 25 pb, p50 = hausse de 50 pb ou plus.

import { civilDate, zonedToUtc } from '../p1-jobs/calendar.ts';
import { CALENDARS, type Bank } from './meetings.ts';

export const OUTCOMES = ['m50', 'm25', 'hold', 'p25', 'p50'] as const;
export type Outcome = (typeof OUTCOMES)[number];
/** Variation retenue par issue, en points de base (« 50+ » compté 50 : borne basse, dite dans la note de méthode). */
export const OUTCOME_BP: Record<Outcome, number> = { m50: -50, m25: -25, hold: 0, p25: 25, p50: 50 };
export const OUTCOME_LABEL: Record<Outcome, string> = { m50: '−50 pb et plus', m25: '−25 pb', hold: 'Statu quo', p25: '+25 pb', p50: '+50 pb et plus' };

/** Écart achat/vente au-delà duquel le milieu n'est plus retenu (10 points). */
export const WIDE_SPREAD = 0.10;
/** Somme des probabilités jugée cohérente (marchés exclusifs). */
export const SUM_OK: [number, number] = [0.95, 1.05];

export interface Quote {
  p: number | null;            // probabilité retenue 0–1
  bid: number | null;
  ask: number | null;
  last: number | null;
  wide: boolean;               // fourchette large : dernier échange retenu
  vol24: number | null;        // volume sur 24 h (dollars Polymarket, contrats Kalshi)
}

/** Probabilité = milieu de la fourchette si l'écart est d'au plus 10 points, sinon dernier échange (« fourchette large »). */
export function pickProbability(bid: number | null, ask: number | null, last: number | null, vol24: number | null = null): Quote {
  if (bid !== null && ask !== null && ask >= bid && ask - bid <= WIDE_SPREAD + 1e-9) {
    return { p: round4((bid + ask) / 2), bid, ask, last, wide: false, vol24 };
  }
  return { p: last, bid, ask, last, wide: true, vol24 };
}

export const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** Libellé Polymarket (« 25 bps decrease », « No Change », « 50+ bps increase ») -> issue. */
export function polymarketOutcome(label: string | null | undefined): Outcome | null {
  const s = (label ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^no change$/.test(s)) return 'hold';
  const m = /^(\d+)(\+?) ?bps? (decrease|increase|cut|hike)$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  const up = m[3] === 'increase' || m[3] === 'hike';
  if (n === 25 && !m[2]) return up ? 'p25' : 'm25';
  if (n === 50 && m[2]) return up ? 'p50' : 'm50';
  return null;   // autre découpage : non retenu plutôt que mal classé
}

/** Marché Kalshi (suffixe du ticker, puis libellé) -> issue. */
export function kalshiOutcome(ticker: string, subtitle: string | null | undefined): Outcome | null {
  const suffix = ticker.split('-').pop() ?? '';
  const bySuffix: Record<string, Outcome> = { C26: 'm50', C25P: 'm50', C25: 'm25', H0: 'hold', HOLD: 'hold', H25: 'p25', H26: 'p50', H25P: 'p50' };
  if (bySuffix[suffix]) return bySuffix[suffix];
  const s = (subtitle ?? '').toLowerCase();
  if (/maintain|hold/.test(s)) return 'hold';
  const big = /(>|more than) ?25/.test(s);
  if (/^cut/.test(s)) return big ? 'm50' : /25/.test(s) ? 'm25' : null;
  if (/^hike/.test(s)) return big ? 'p50' : /25/.test(s) ? 'p25' : null;
  return null;
}

export interface Distribution { probs: Partial<Record<Outcome, Quote>>; total: number | null; sum_ok: boolean | null }

export function distribution(probs: Partial<Record<Outcome, Quote>>): Distribution {
  const ps = OUTCOMES.map((o) => probs[o]?.p).filter((p): p is number => p !== null && p !== undefined);
  if (!ps.length) return { probs, total: null, sum_ok: null };
  const total = round4(ps.reduce((a, b) => a + b, 0));
  return { probs, total, sum_ok: total >= SUM_OK[0] && total <= SUM_OK[1] };
}

/** Variation attendue (pb) d'une réunion : Σ p × variation / Σ p, sur les issues chiffrées. Null sans issue. */
export function expectedChangeBp(probs: Partial<Record<Outcome, Quote>>): number | null {
  let s = 0, w = 0;
  for (const o of OUTCOMES) {
    const p = probs[o]?.p;
    if (p === null || p === undefined) continue;
    s += p * OUTCOME_BP[o];
    w += p;
  }
  return w > 0 ? Math.round((s / w) * 100) / 100 : null;
}

/** Écart maximal entre sources (points de pourcentage) sur les issues cotées par au moins deux sources. */
export function maxGap(bySource: Record<string, Partial<Record<Outcome, Quote>>>): { pts: number; outcome: Outcome; sources: [string, string] } | null {
  let best: { pts: number; outcome: Outcome; sources: [string, string] } | null = null;
  const names = Object.keys(bySource);
  for (const o of OUTCOMES) {
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = bySource[names[i]][o]?.p, b = bySource[names[j]][o]?.p;
        if (a === null || a === undefined || b === null || b === undefined) continue;
        const pts = Math.round(Math.abs(a - b) * 1000) / 10;
        if (!best || pts > best.pts) best = { pts, outcome: o, sources: [names[i], names[j]] };
      }
    }
  }
  return best;
}

// --- Trajectoire implicite -----------------------------------------------------------------

export interface PathPoint { meeting: string; rate: number; delta_bp: number }

/**
 * Fed, Kalshi KXFED : marchés « borne haute de la fourchette > K » (règle officielle de Kalshi).
 * Les probabilités sont rendues décroissantes en K (minimum courant), puis
 * E[borne haute] = K0 + Σ (K(i+1) − K(i)) × P(> K(i)), le dernier pas valant 0,25.
 * `truncated` signale une queue basse non couverte (P(> K0) < 0,98).
 */
export function expectedUpperBound(strikes: { k: number; p: number }[]): { rate: number; truncated: boolean } | null {
  const s = strikes.filter((x) => Number.isFinite(x.k) && Number.isFinite(x.p)).sort((a, b) => a.k - b.k);
  if (s.length < 2) return null;
  let run = 1;
  const mono = s.map((x) => { run = Math.min(run, Math.max(0, Math.min(1, x.p))); return { k: x.k, p: run }; });
  let e = mono[0].k;
  for (let i = 0; i < mono.length; i++) {
    const step = i + 1 < mono.length ? mono[i + 1].k - mono[i].k : 0.25;
    e += step * mono[i].p;
  }
  return { rate: Math.round(e * 10_000) / 10_000, truncated: mono[0].p < 0.98 };
}

/** Enchaîne des taux attendus par réunion en trajectoire (variation contre la réunion précédente). */
export function pathFromLevels(base: number, levels: { meeting: string; rate: number }[]): PathPoint[] {
  let prev = base;
  return levels.map((l) => {
    const pt = { meeting: l.meeting, rate: round4(l.rate), delta_bp: Math.round((l.rate - prev) * 1000) / 10 };
    prev = l.rate;
    return pt;
  });
}

/** Autres banques : taux actuel + variations attendues cumulées, réunion après réunion ; s'arrête au premier trou. */
export function pathFromChanges(base: number, changes: { meeting: string; delta_bp: number | null }[]): PathPoint[] {
  const out: PathPoint[] = [];
  let rate = base;
  for (const c of changes) {
    if (c.delta_bp === null) break;
    rate += c.delta_bp / 100;
    out.push({ meeting: c.meeting, rate: round4(rate), delta_bp: Math.round(c.delta_bp * 10) / 10 });
  }
  return out;
}

// --- Réunions ------------------------------------------------------------------------------

const DAY = 86_400_000;

/** Rattache une date de fin donnée par une source (instant UTC) à la réunion officielle la plus proche, à un jour près. */
export function matchMeeting(bank: Bank, iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const local = civilDate(ms, CALENDARS[bank].tz);
  const t = Date.parse(`${local}T00:00:00Z`);
  let best: string | null = null, bestDiff = Infinity;
  for (const d of CALENDARS[bank].dates) {
    const diff = Math.abs(Date.parse(`${d}T00:00:00Z`) - t);
    if (diff <= DAY && diff < bestDiff) { best = d; bestDiff = diff; }
  }
  return best;
}

/** Instant de l'annonce (heure habituelle, ou fin de journée locale quand la banque n'en fixe pas). */
export function announcementMs(bank: Bank, date: string): number {
  const cal = CALENDARS[bank];
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = cal.time ? cal.time.split(':').map(Number) : [23, 59];
  return zonedToUtc(y, m, d, h, mi, cal.tz);
}

/** Réunions à venir : une réunion reste « prochaine » jusqu'à 2 h après l'heure de l'annonce. */
export function upcomingMeetings(bank: Bank, nowMs: number): string[] {
  return CALENDARS[bank].dates.filter((d) => announcementMs(bank, d) + 2 * 3_600_000 > nowMs);
}

/** Jours calendaires entre aujourd'hui (fuseau de la banque) et la réunion. */
export function daysUntil(bank: Bank, date: string, nowMs: number): number {
  const today = civilDate(nowMs, CALENDARS[bank].tz);
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
}
