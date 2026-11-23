// Horaires des marchés (P1, module « Horaires des marchés ») : séances, jours fériés et
// séances écourtées des places suivies, relevés le 23/11/2026 sur les pages officielles.
// Une place dont les jours fériés ne sont pas publiés dans une page lisible le dit
// (`holidays: null`) : jamais un jour férié deviné. À relire chaque fin d'année.
//
// Logique pure (état à un instant, prochain changement), testée par Vitest.

import { zonedParts, zonedToUtc, type Hm } from '../lib/time';

export interface Exchange {
  code: 'TOK' | 'HKG' | 'SYD' | 'LON' | 'PAR' | 'NY' | 'CRYPTO';
  name: string;                // place
  venue: string;               // bourse
  tz: string;
  sessions: [Hm, Hm][];        // heures locales ; vide = en continu (crypto)
  /** Jours de fermeture (AAAA-MM-JJ, date locale) avec leur nom ; null = non relevés. */
  holidays: Record<string, string> | null;
  /** Séances écourtées : date locale -> heure de clôture (null si l'heure n'est pas publiée). */
  early: Record<string, Hm | null>;
  until: string | null;        // dernier jour couvert par le relevé des jours fériés
  source: string;
  note?: string;
}

export const EXCHANGES: Exchange[] = [
  {
    code: 'TOK', name: 'Tokyo', venue: 'Bourse de Tokyo (JPX)', tz: 'Asia/Tokyo', sessions: [['09:00', '11:30'], ['12:30', '15:30']],
    holidays: {
      '2026-11-23': 'Fête du travail', '2026-12-31': 'Fermeture de fin d’année',
      '2027-01-01': 'Jour de l’an', '2027-01-02': 'Fermeture de début d’année', '2027-01-03': 'Fermeture de début d’année',
      '2027-01-11': 'Jour de la majorité', '2027-02-11': 'Fondation de l’État', '2027-02-23': 'Anniversaire de l’Empereur',
      '2027-03-21': 'Équinoxe de printemps', '2027-03-22': 'Équinoxe de printemps (reporté)', '2027-04-29': 'Jour de Shōwa',
      '2027-05-03': 'Jour de la Constitution', '2027-05-04': 'Jour de la verdure', '2027-05-05': 'Jour des enfants',
      '2027-07-19': 'Jour de la mer', '2027-08-11': 'Jour de la montagne', '2027-09-20': 'Jour du respect des aînés',
      '2027-09-23': 'Équinoxe d’automne', '2027-10-11': 'Jour du sport', '2027-11-03': 'Jour de la culture',
      '2027-11-23': 'Fête du travail', '2027-12-31': 'Fermeture de fin d’année',
    },
    early: {}, until: '2027-12-31',
    source: 'https://www.jpx.co.jp/english/corporate/about-jpx/calendar/index.html',
    note: 'séance 09:00–15:30 depuis le 05/11/2024, pause 11:30–12:30',
  },
  {
    code: 'HKG', name: 'Hong Kong', venue: 'HKEX', tz: 'Asia/Hong_Kong', sessions: [['09:30', '16:00']],
    holidays: null, early: {}, until: null,
    source: 'https://www.hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market?sc_lang=en',
    note: 'séance du matin prolongée jusqu’à 13:00 : plus de pause de midi ; jours fériés non relevés',
  },
  {
    code: 'SYD', name: 'Sydney', venue: 'ASX', tz: 'Australia/Sydney', sessions: [['10:00', '16:00']],
    holidays: {
      '2026-12-25': 'Noël', '2026-12-28': 'Boxing Day (reporté)',
      '2027-01-01': 'Jour de l’an', '2027-01-26': 'Fête nationale', '2027-03-26': 'Vendredi saint', '2027-03-29': 'Lundi de Pâques',
      '2027-06-14': 'Anniversaire du Roi', '2027-12-27': 'Noël (reporté)', '2027-12-28': 'Boxing Day (reporté)',
    },
    early: { '2026-12-24': '14:10', '2026-12-31': '14:10', '2027-12-24': '14:10', '2027-12-31': '14:10' }, until: '2027-12-31',
    source: 'https://www.asx.com.au/markets/market-resources/trading-hours-calendar/cash-market-trading-hours/trading-calendar',
    note: 'enchère d’ouverture vers 09:59:45 ; ANZAC Day 2027 (26/04) : ouvert',
  },
  {
    code: 'LON', name: 'Londres', venue: 'London Stock Exchange', tz: 'Europe/London', sessions: [['08:00', '16:30']],
    holidays: {
      '2026-12-25': 'Noël', '2026-12-28': 'Boxing Day (reporté)',
      '2027-01-01': 'Jour de l’an', '2027-03-26': 'Vendredi saint', '2027-03-29': 'Lundi de Pâques', '2027-05-03': 'Férié de début mai',
      '2027-05-31': 'Férié de printemps', '2027-08-30': 'Férié d’été', '2027-12-27': 'Noël (reporté)', '2027-12-28': 'Boxing Day (reporté)',
    },
    early: { '2026-12-24': '12:30', '2026-12-31': '12:30' }, until: '2027-12-28',
    source: 'https://www.londonstockexchange.com/equities-trading/business-days',
  },
  {
    code: 'PAR', name: 'Paris', venue: 'Euronext Paris', tz: 'Europe/Paris', sessions: [['09:00', '17:30']],
    holidays: {
      '2026-12-25': 'Noël', '2027-01-01': 'Jour de l’an', '2027-03-26': 'Vendredi saint', '2027-03-29': 'Lundi de Pâques',
    },
    early: { '2026-12-24': null, '2026-12-31': null, '2027-12-24': null, '2027-12-31': null }, until: '2027-12-31',
    source: 'https://www.euronext.com/en/trade/trading-hours-holidays',
    note: 'demi-séances : heure de clôture publiée dans un document Euronext à télécharger, non relevée',
  },
  {
    code: 'NY', name: 'New York', venue: 'NYSE', tz: 'America/New_York', sessions: [['09:30', '16:00']],
    holidays: {
      '2026-11-26': 'Thanksgiving', '2026-12-25': 'Noël',
      '2027-01-01': 'Jour de l’an', '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': 'Washington’s Birthday',
      '2027-03-26': 'Vendredi saint', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (reporté)',
      '2027-07-05': 'Fête nationale (reportée)', '2027-09-06': 'Labor Day', '2027-11-25': 'Thanksgiving', '2027-12-24': 'Noël (reporté)',
      '2028-01-17': 'Martin Luther King Jr. Day', '2028-02-21': 'Washington’s Birthday', '2028-04-14': 'Vendredi saint',
      '2028-05-29': 'Memorial Day', '2028-06-19': 'Juneteenth', '2028-07-04': 'Fête nationale', '2028-09-04': 'Labor Day',
      '2028-11-23': 'Thanksgiving', '2028-12-25': 'Noël',
    },
    early: { '2026-11-27': '13:00', '2027-11-26': '13:00', '2028-07-03': '13:00', '2028-11-24': '13:00' }, until: '2028-12-25',
    source: 'https://www.nyse.com/markets/hours-calendars',
  },
  {
    code: 'CRYPTO', name: 'Crypto', venue: 'OKX', tz: 'UTC', sessions: [], holidays: {}, early: {}, until: null,
    source: 'https://www.okx.com', note: 'en continu, 7 j/7',
  },
];

export const exchange = (code: Exchange['code']) => EXCHANGES.find((e) => e.code === code)!;

// --- état à un instant ------------------------------------------------------------------

export type MarketState = 'ouvert' | 'pause' | 'fermé' | 'férié' | 'week-end' | 'continu';

export interface Status {
  state: MarketState;
  holiday: string | null;          // nom du jour férié
  early: boolean;                  // séance écourtée aujourd'hui
  earlyTimeKnown: boolean;
  next: { kind: 'ouverture' | 'clôture'; at: number } | null;
}

const dayKey = (p: { y: number; m: number; d: number }) => `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
const minutes = (hm: Hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

/** Séances d'un jour local (date AAAA-MM-JJ) en millisecondes UTC ; [] si fermé. */
export function sessionsOn(ex: Exchange, day: string): [number, number][] {
  const [y, m, d] = day.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (wd === 0 || wd === 6 || ex.holidays?.[day]) return [];
  const close = ex.early[day];
  const out: [number, number][] = [];
  for (const [a, b] of ex.sessions) {
    // Séance écourtée à heure inconnue : seul le début est sûr, la fin est laissée à la séance normale.
    const end = close && minutes(close) < minutes(b) ? close : b;
    if (close && minutes(close) <= minutes(a)) continue;
    out.push([zonedToUtc(y, m, d, a, ex.tz), zonedToUtc(y, m, d, end, ex.tz)]);
  }
  return out;
}

function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T12:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function marketStatus(ex: Exchange, ms: number): Status {
  if (!ex.sessions.length) return { state: 'continu', holiday: null, early: false, earlyTimeKnown: true, next: null };
  const today = dayKey(zonedParts(ms, ex.tz));
  const wd = zonedParts(ms, ex.tz).wd;
  const todays = sessionsOn(ex, today);
  const holiday = ex.holidays?.[today] ?? null;
  const early = today in ex.early;
  const earlyTimeKnown = !early || ex.early[today] !== null;
  let next: Status['next'] = null;
  // Prochain changement : clôture de la séance en cours, sinon ouverture suivante (jusqu'à 14 jours).
  for (const [a, b] of todays) {
    if (ms >= a && ms < b) { next = { kind: 'clôture', at: b }; break; }
    if (ms < a) { next = { kind: 'ouverture', at: a }; break; }
  }
  if (!next) {
    for (let i = 1; i <= 14 && !next; i++) {
      const s = sessionsOn(ex, addDays(today, i));
      if (s.length) next = { kind: 'ouverture', at: s[0][0] };
    }
  }
  const inSession = todays.some(([a, b]) => ms >= a && ms < b);
  const state: MarketState = inSession ? 'ouvert'
    : holiday ? 'férié'
      : wd >= 6 ? 'week-end'
        : todays.length && ms > todays[0][0] && ms < todays[todays.length - 1][1] ? 'pause' : 'fermé';
  return { state, holiday, early, earlyTimeKnown, next };
}

/** Compte à rebours lisible : « 2 h 14 », « 35 min », « 3 j 4 h ». */
export function countdown(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
}

/** Prochains jours fériés et séances écourtées de toutes les places, à partir d'aujourd'hui. */
export function upcomingClosures(ms: number, n = 10): { code: Exchange['code']; name: string; day: string; label: string; kind: 'férié' | 'écourtée' }[] {
  const out: { code: Exchange['code']; name: string; day: string; label: string; kind: 'férié' | 'écourtée' }[] = [];
  for (const ex of EXCHANGES) {
    const today = dayKey(zonedParts(ms, ex.tz));
    for (const [day, label] of Object.entries(ex.holidays ?? {})) {
      const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
      if (day >= today && wd !== 0 && wd !== 6) out.push({ code: ex.code, name: ex.name, day, label, kind: 'férié' });
    }
    for (const [day, close] of Object.entries(ex.early)) {
      if (day >= today) out.push({ code: ex.code, name: ex.name, day, label: close ? `clôture à ${close}` : 'clôture avancée, heure non relevée', kind: 'écourtée' });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.name.localeCompare(b.name))).slice(0, n);
}
