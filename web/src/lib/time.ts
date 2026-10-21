// Fuseaux, horloges, marchés ouverts et bandes de session.
//
// Règle : aucune heure de session codée en UTC. Chaque horaire est exprimé
// en heure locale de sa place, avec son fuseau IANA, et converti en UTC pour
// la date demandée. Londres et New York changent d'heure à des dates
// différentes (25/10/2026 en Europe, 01/11/2026 aux États-Unis) : seule cette
// conversion reste juste entre les deux.

export type Hm = `${number}:${number}`;

interface Parts { y: number; m: number; d: number; h: number; mi: number; s: number; wd: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Date et heure murales dans `tz` à l'instant `ms` (UTC). */
export function zonedParts(ms: number, tz: string): Parts {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) out[p.type] = p.value;
  return {
    y: Number(out.year), m: Number(out.month), d: Number(out.day),
    h: Number(out.hour), mi: Number(out.minute), s: Number(out.second),
    wd: WEEKDAYS[out.weekday] ?? 0,
  };
}

/** Décalage du fuseau à l'instant `ms`, en ms (Paris en hiver : +3 600 000). */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Instant UTC de l'heure murale `hm` du jour (y, m, d) dans `tz`. */
export function zonedToUtc(y: number, m: number, d: number, hm: Hm, tz: string): number {
  const [h, mi] = hm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let utc = guess - tzOffsetMs(guess, tz);
  const off2 = tzOffsetMs(utc, tz);
  if (guess - off2 !== utc) utc = guess - off2;
  return utc;
}

export function fmtHm(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

export function fmtHms(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${fmtHm(ms, tz)}:${String(p.s).padStart(2, '0')}`;
}

// --- Places boursières (horloges de la barre du haut) -----------------------
// Horaires de la séance continue, heure locale, jours ouvrés, hors jours fériés
// (le calendrier des fériés viendra avec le calendrier économique, P1).
// Sources : JPX (TSE, 09:00–11:30 et 12:30–15:30 depuis le 05/11/2024),
// LSEG (LSE, 08:00–16:30), Euronext (Paris, 09:00–17:30), NYSE (09:30–16:00).

export interface Market {
  code: 'TOK' | 'LON' | 'PAR' | 'NY';
  name: string;
  tz: string;
  sessions: [Hm, Hm][];
}

export const MARKETS: Market[] = [
  { code: 'TOK', name: 'Tokyo', tz: 'Asia/Tokyo', sessions: [['09:00', '11:30'], ['12:30', '15:30']] },
  { code: 'LON', name: 'Londres', tz: 'Europe/London', sessions: [['08:00', '16:30']] },
  { code: 'PAR', name: 'Paris', tz: 'Europe/Paris', sessions: [['09:00', '17:30']] },
  { code: 'NY', name: 'New York', tz: 'America/New_York', sessions: [['09:30', '16:00']] },
];

function minutesOf(hm: Hm): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export function isMarketOpen(market: Market, ms: number): boolean {
  const p = zonedParts(ms, market.tz);
  if (p.wd >= 6) return false;
  const now = p.h * 60 + p.mi;
  return market.sessions.some(([a, b]) => now >= minutesOf(a) && now < minutesOf(b));
}

// --- Bandes de session des graphiques -----------------------------------------
// Relevées sur la maquette Main : Asie = séance de Tokyo jusqu'à 15:00 (00:00–
// 06:00 UTC), Londres 08:00–16:30, New York 09:30–16:00, chacune dans son
// fuseau. Les week-ends n'ont pas de bande (ni CME ni ETF ne cotent).

export interface SessionDef { id: 'asia' | 'london' | 'ny'; label: string; tz: string; open: Hm; close: Hm }

export const SESSIONS: SessionDef[] = [
  { id: 'asia', label: 'Asie', tz: 'Asia/Tokyo', open: '09:00', close: '15:00' },
  { id: 'london', label: 'Londres', tz: 'Europe/London', open: '08:00', close: '16:30' },
  { id: 'ny', label: 'New York', tz: 'America/New_York', open: '09:30', close: '16:00' },
];

export interface Band { id: SessionDef['id']; label: string; from: number; to: number }

const DAY = 86_400_000;

/** Bandes intersectant [fromMs, toMs[, découpées à cet intervalle. */
export function sessionBands(fromMs: number, toMs: number, sessions = SESSIONS): Band[] {
  const out: Band[] = [];
  for (const s of sessions) {
    // Parcourt les dates locales qui peuvent toucher l'intervalle.
    for (let t = fromMs - DAY; t < toMs + DAY; t += DAY) {
      const p = zonedParts(t, s.tz);
      if (p.wd >= 6) continue;
      const a = zonedToUtc(p.y, p.m, p.d, s.open, s.tz);
      const b = zonedToUtc(p.y, p.m, p.d, s.close, s.tz);
      const from = Math.max(a, fromMs);
      const to = Math.min(b, toMs);
      if (to > from && !out.some((x) => x.id === s.id && x.from === from)) {
        out.push({ id: s.id, label: s.label, from, to });
      }
    }
  }
  return out.sort((x, y) => x.from - y.from);
}

/** Session ouverte la plus récente à l'instant `ms`, ou null. */
export function currentSession(ms: number): Band | null {
  const open = sessionBands(ms - DAY, ms + DAY).filter((b) => b.from <= ms && ms < b.to);
  return open.length ? open[open.length - 1] : null;
}

export function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY) * DAY;
}
