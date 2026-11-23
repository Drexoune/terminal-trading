// Calendriers officiels des réunions de politique monétaire des 8 banques (plan P2, R0),
// relevés le 23/11/2026 sur les pages officielles (scripts/explore_rates.py, captures dans
// data/explore/rates/2026-11-23_probe/). À relire quand une banque publie l'année suivante ;
// une date tirée des marchés n'est jamais présentée comme officielle.
//
// `date` : jour de l'annonce, dans le fuseau de la banque ; `time` : heure habituelle de
// l'annonce (indicative, null quand la banque n'en fixe pas, comme la BoJ).
// Pour une banque dont la page officielle est inaccessible, `source` vaut « marchés » et les
// dates viennent des contrats de prédiction, marquées comme telles à l'écran.

export type Bank = 'FED' | 'BCE' | 'BOE' | 'BOJ' | 'BNS' | 'BOC' | 'RBA' | 'RBNZ';

export interface BankCalendar {
  bank: Bank;
  name: string;               // libellé affiché
  currency: string;
  tz: string;                 // fuseau IANA des annonces
  time: string | null;        // heure locale habituelle de l'annonce
  source: 'officielle' | 'marchés';
  url: string;
  read_on: string;            // date du relevé
  until: string | null;       // dernière date publiée par la source (liste incomplète au-delà)
  dates: string[];            // AAAA-MM-JJ, jours d'annonce à partir de novembre 2026
  note?: string;
}

export const CALENDARS: Record<Bank, BankCalendar> = {
  FED: {
    bank: 'FED', name: 'Réserve fédérale', currency: 'USD', tz: 'America/New_York', time: '14:00', source: 'officielle',
    url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', read_on: '2026-11-23', until: '2028-01-26',
    dates: ['2026-12-09', '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-10-27',
      '2027-11-17', '2028-01-26'],
    note: 'dates provisoires jusqu’à confirmation à la réunion précédente ; 25-26/01/2028 annoncée en note',
  },
  BCE: {
    bank: 'BCE', name: 'Banque centrale européenne', currency: 'EUR', tz: 'Europe/Berlin', time: '14:15', source: 'officielle',
    url: 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html', read_on: '2026-11-23', until: '2028-12-07',
    dates: ['2026-12-17', '2027-02-04', '2027-03-18', '2027-04-29', '2027-06-10', '2027-07-22', '2027-09-09', '2027-10-28',
      '2027-12-16', '2028-02-03'],
  },
  BOE: {
    bank: 'BOE', name: 'Banque d’Angleterre', currency: 'GBP', tz: 'Europe/London', time: '12:00', source: 'officielle',
    url: 'https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates', read_on: '2026-11-23', until: '2027-12-16',
    dates: ['2026-12-17', '2027-02-04', '2027-03-18', '2027-04-29', '2027-06-17', '2027-07-29', '2027-09-16', '2027-11-04',
      '2027-12-16'],
  },
  BOJ: {
    bank: 'BOJ', name: 'Banque du Japon', currency: 'JPY', tz: 'Asia/Tokyo', time: null, source: 'officielle',
    url: 'https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm', read_on: '2026-11-23', until: '2027-12-17',
    dates: ['2026-12-18', '2027-01-22', '2027-03-18', '2027-04-28', '2027-06-11', '2027-07-22', '2027-09-22', '2027-10-29',
      '2027-12-17'],
    note: 'réunion sur deux jours, annonce le second jour, sans heure fixe',
  },
  BNS: {
    bank: 'BNS', name: 'Banque nationale suisse', currency: 'CHF', tz: 'Europe/Zurich', time: '09:30', source: 'officielle',
    url: 'https://www.snb.ch/en/services-events/digital-services/event-schedule', read_on: '2026-11-23', until: '2028-12-14',
    dates: ['2026-12-10', '2027-03-18', '2027-06-24', '2027-09-23', '2027-12-16', '2028-03-23'],
  },
  BOC: {
    bank: 'BOC', name: 'Banque du Canada', currency: 'CAD', tz: 'America/Toronto', time: '09:45', source: 'officielle',
    url: 'https://www.bankofcanada.ca/press/upcoming-events/?event_type=interest-rate-announcements', read_on: '2026-11-23',
    until: '2027-07-21',
    dates: ['2026-12-09', '2027-01-27', '2027-03-03', '2027-04-28', '2027-06-02', '2027-07-21'],
    note: 'la page des événements ne liste que les mois à venir',
  },
  RBA: {
    bank: 'RBA', name: 'Banque de réserve d’Australie', currency: 'AUD', tz: 'Australia/Sydney', time: '14:30', source: 'officielle',
    url: 'https://www.rba.gov.au/schedules-events/board-meeting-schedules.html', read_on: '2026-11-23', until: '2027-12-14',
    dates: ['2026-12-08', '2027-02-09', '2027-03-23', '2027-05-04', '2027-06-22', '2027-08-10', '2027-09-28', '2027-11-02',
      '2027-12-14'],
    note: 'réunion sur deux jours, annonce le second jour',
  },
  RBNZ: {
    bank: 'RBNZ', name: 'Banque de réserve de Nouvelle-Zélande', currency: 'NZD', tz: 'Pacific/Auckland', time: '14:00', source: 'marchés',
    url: 'https://www.rbnz.govt.nz/monetary-policy/about-monetary-policy/monetary-policy-statements-and-official-cash-rate-dates',
    read_on: '2026-11-23', until: '2027-03-17',
    dates: ['2026-12-09', '2027-02-10', '2027-03-17'],
    note: 'page officielle refusée aux serveurs (HTTP 403, aucun contournement) : dates des contrats Polymarket ; Kalshi date la même annonce de la veille (heure des États-Unis)',
  },
};

export const BANKS = Object.keys(CALENDARS) as Bank[];

/** Prochaine date d'annonce au jour `today` (AAAA-MM-JJ, fuseau de la banque) ou après, sinon null. */
export function nextMeeting(bank: Bank, today: string): string | null {
  return CALENDARS[bank].dates.find((d) => d >= today) ?? null;
}
