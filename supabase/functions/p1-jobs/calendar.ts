// Agenda économique en ligne (plan « Tout en ligne », étape O2) : portage TypeScript des
// fonctions pures de gateway/terminal_gateway/calendar_data.py. Mêmes règles, mêmes noms ;
// calendar.test.ts vérifie qu'il redonne exactement le fichier doré produit par Python
// (gateway/tests/fixtures/calendar/golden.json, scripts/make_calendar_golden.py).
//
// - ForexFactory, ff_calendar_thisweek.xml : heures en UTC (relevé du 20/11/2026),
//   encodage windows-1252 ; l'heure ForexFactory est « indicative ».
// - BLS, bls.ics : heures officielles à New York (TZID « US-Eastern » -> America/New_York).
// Aucune heure de session écrite en UTC : les conversions passent par la zone IANA.

export interface Indicator {
  id: string;
  label_fr: string;
  currency: string;
  ff_title: string;            // expression régulière sur le titre ForexFactory
  bls_release: string | null;
  official_series: string | null;
  unit: string;
  capture: boolean;
}

// Copie de calendar_data.INDICATORS ; le test la compare au fichier doré.
export const INDICATORS: Indicator[] = [
  { id: 'us-cpi-mm', label_fr: 'IPC (m/m)', currency: 'USD', ff_title: 'CPI m/m', bls_release: 'Consumer Price Index', official_series: 'CUSR0000SA0', unit: '%', capture: true },
  { id: 'us-cpi-yy', label_fr: 'IPC (sur un an)', currency: 'USD', ff_title: 'CPI y/y', bls_release: 'Consumer Price Index', official_series: 'CUUR0000SA0', unit: '%', capture: true },
  { id: 'us-core-cpi-mm', label_fr: 'IPC sous-jacent (m/m)', currency: 'USD', ff_title: 'Core CPI m/m', bls_release: 'Consumer Price Index', official_series: 'CUSR0000SA0L1E', unit: '%', capture: true },
  { id: 'us-core-cpi-yy', label_fr: 'IPC sous-jacent (sur un an)', currency: 'USD', ff_title: 'Core CPI y/y', bls_release: 'Consumer Price Index', official_series: 'CUUR0000SA0L1E', unit: '%', capture: true },
  { id: 'us-nfp', label_fr: 'Créations d’emplois non agricoles', currency: 'USD', ff_title: 'Non-Farm Employment Change', bls_release: 'Employment Situation', official_series: 'CES0000000001', unit: 'K', capture: true },
  { id: 'us-unemployment', label_fr: 'Taux de chômage', currency: 'USD', ff_title: 'Unemployment Rate', bls_release: 'Employment Situation', official_series: 'LNS14000000', unit: '%', capture: true },
  { id: 'us-ahe-mm', label_fr: 'Salaire horaire moyen (m/m)', currency: 'USD', ff_title: 'Average Hourly Earnings m/m', bls_release: 'Employment Situation', official_series: 'CES0500000003', unit: '%', capture: true },
  { id: 'us-ppi-mm', label_fr: 'Prix à la production (m/m)', currency: 'USD', ff_title: 'PPI m/m', bls_release: 'Producer Price Index', official_series: 'WPSFD4', unit: '%', capture: true },
  { id: 'us-core-ppi-mm', label_fr: 'Prix à la production sous-jacents (m/m)', currency: 'USD', ff_title: 'Core PPI m/m', bls_release: 'Producer Price Index', official_series: 'WPSFD49104', unit: '%', capture: true },
  { id: 'us-prod-qq', label_fr: 'Productivité non agricole (t/t)', currency: 'USD', ff_title: '(?:Prelim |Revised )?Nonfarm Productivity q/q', bls_release: 'Productivity and Costs', official_series: 'PRS85006092', unit: '%', capture: true },
  { id: 'us-ulc-qq', label_fr: 'Coûts salariaux unitaires (t/t)', currency: 'USD', ff_title: '(?:Prelim |Revised )?Unit Labor Costs q/q', bls_release: 'Productivity and Costs', official_series: 'PRS85006112', unit: '%', capture: true },
];

export const NEW_YORK = 'America/New_York';
export const ICS_ZONES: Record<string, string> = { 'US-Eastern': NEW_YORK };
export const TRACKED_RELEASES = [...new Set(INDICATORS.map((i) => i.bls_release).filter((r): r is string => !!r))].sort();

export function indicatorFor(title: string, currency: string): Indicator | null {
  const t = title.trim();
  return INDICATORS.find((i) => i.currency === currency && new RegExp(`^(?:${i.ff_title})$`).test(t)) ?? null;
}

// --- valeurs ----------------------------------------------------------------------------

const VALUE = /^([<>]?)(-?\d+(?:\.\d+)?)\s*([%KMBT]|bp)?$/;

/** « 0.4% » -> ["0.4", "%"] ; « 198K » -> ["198", "K"] ; illisible ou borné (« <1.25% ») -> [null, null]. */
export function parseValue(raw: string | null | undefined): [string | null, string | null] {
  const m = VALUE.exec((raw ?? '').trim());
  if (!m || m[1]) return [null, null];
  return [m[2], m[3] ?? ''];
}

// --- dates et fuseaux -----------------------------------------------------------------------

/** Date civile (AAAA-MM-JJ) d'un instant dans une zone IANA. */
export function civilDate(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function tzOffsetMs(ms: number, tz: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(ms / 1000) * 1000;
}

/** Heure locale d'une zone IANA -> instant UTC (ms), changements d'heure compris. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}

// --- ForexFactory ------------------------------------------------------------------------

export interface FfEvent {
  title: string;
  currency: string;
  impact: string;
  date_utc: string;
  time_raw: string;
  time_ms: number | null;
  forecast_raw: string;
  previous_raw: string;
  url: string;
  series: string | null;
  identity: string;
  indicator: Indicator | null;
  ny_date: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function xmlText(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** Texte d'un élément simple : CDATA, texte avec entités, ou élément vide (« <forecast /> »). */
function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${name}>)`).exec(block);
  if (!m || m[1] === undefined) return '';
  const inner = m[1];
  const parts = inner.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/);
  return parts.map((p) => (p.startsWith('<![CDATA[') ? p.slice(9, -3) : xmlText(p))).join('').trim();
}

export function decodeXml(body: Uint8Array | string): string {
  return typeof body === 'string' ? body : new TextDecoder('windows-1252').decode(body);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const TIME = /^(\d{1,2}):(\d{2})\s*([ap]m)$/i;

/** XML hebdomadaire de ForexFactory -> événements, dans l'ordre du fichier. */
export function parseFfXml(body: Uint8Array | string): FfEvent[] {
  const xml = decodeXml(body);
  const out: FfEvent[] = [];
  for (const m of xml.matchAll(/<event>([\s\S]*?)<\/event>/g)) {
    const b = m[1];
    const dm = /^(\d{2})-(\d{2})-(\d{4})$/.exec(tag(b, 'date'));
    if (!dm) continue;
    const [y, mo, d] = [Number(dm[3]), Number(dm[1]), Number(dm[2])];
    const dateUtc = `${dm[3]}-${dm[1]}-${dm[2]}`;
    const timeRaw = tag(b, 'time');
    const tm = TIME.exec(timeRaw);
    const timeMs = tm ? Date.UTC(y, mo - 1, d, (Number(tm[1]) % 12) + (tm[3].toLowerCase() === 'pm' ? 12 : 0), Number(tm[2])) : null;
    const url = tag(b, 'url');
    const title = tag(b, 'title');
    const currency = tag(b, 'country');
    out.push({
      title, currency, impact: tag(b, 'impact'), date_utc: dateUtc, time_raw: timeRaw, time_ms: timeMs,
      forecast_raw: tag(b, 'forecast'), previous_raw: tag(b, 'previous'), url,
      series: url.includes('/calendar/') ? url.replace(/\/+$/, '').split('/').pop() ?? null : null,
      identity: '', indicator: indicatorFor(title, currency),
      ny_date: timeMs === null ? dateUtc : civilDate(timeMs, NEW_YORK),
    });
  }
  // Identité stable : série, devise, jour à New York, rang du jour.
  const seen = new Map<string, number>();
  for (const ev of out) {
    const base = `${ev.series ?? slug(ev.title)}|${ev.currency}|${ev.ny_date}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    ev.identity = `${base}|${n}`;
  }
  return out;
}

// --- BLS ------------------------------------------------------------------------------------

export interface OfficialRelease { title: string; local_date: string; local_time: string; tz: string; utc_ms: number }

/** Calendrier iCalendar du BLS -> publications ; problèmes (zone inconnue…) à part. */
export function parseBlsIcs(text: string): [OfficialRelease[], string[]] {
  const unfolded = text.replace(/\r?\n[ \t]/g, '').replace(/\r\n/g, '\n');
  const out: OfficialRelease[] = [];
  const problems: string[] = [];
  for (const m of unfolded.matchAll(/BEGIN:VEVENT\n([\s\S]*?)END:VEVENT/g)) {
    const block = m[1];
    const summary = /^SUMMARY:(.*)$/m.exec(block);
    const start = /^DTSTART;TZID=([^:]+):(\d{8})T(\d{4})\d{2}$/m.exec(block);
    if (!summary || !start) {
      problems.push(`publication illisible : ${JSON.stringify(block.slice(0, 60))}`);
      continue;
    }
    const zone = ICS_ZONES[start[1]];
    if (!zone) {
      problems.push(`zone inconnue : ${start[1]}`);
      continue;
    }
    const d = start[2];
    const hm = start[3];
    out.push({
      title: summary[1].replace(/\\,/g, ',').trim(),
      local_date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`,
      local_time: `${hm.slice(0, 2)}:${hm.slice(2)}`,
      tz: zone,
      utc_ms: zonedToUtc(Number(d.slice(0, 4)), Number(d.slice(4, 6)), Number(d.slice(6)), Number(hm.slice(0, 2)), Number(hm.slice(2)), zone),
    });
  }
  return [out, problems];
}

/** Heure officielle des indicateurs captés : la publication du BLS du même jour. */
export function attachOfficial(events: FfEvent[], releases: OfficialRelease[]): Map<string, OfficialRelease> {
  const byKey = new Map(releases.map((r) => [`${r.title}|${r.local_date}`, r] as const));
  const out = new Map<string, OfficialRelease>();
  for (const ev of events) {
    const rel = ev.indicator?.bls_release ? byKey.get(`${ev.indicator.bls_release}|${ev.ny_date}`) : undefined;
    if (rel) out.set(ev.identity, rel);
  }
  return out;
}

// --- semaines -------------------------------------------------------------------------------

function isoWeek(y: number, m: number, d: number): [number, number] {
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return [year, week];
}

function addDays(day: string, n: number): string {
  const t = new Date(`${day}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Semaine ForexFactory (dimanche -> samedi, New York) nommée par la semaine ISO de son lundi. */
export function weekId(nyDay: string): string {
  const wd = new Date(`${nyDay}T12:00:00Z`).getUTCDay();   // 0 = dimanche
  const monday = wd === 0 ? addDays(nyDay, 1) : addDays(nyDay, 1 - wd);
  const [y, w] = isoWeek(Number(monday.slice(0, 4)), Number(monday.slice(5, 7)), Number(monday.slice(8)));
  return `${y}-W${String(w).padStart(2, '0')}`;
}

/** « 2026-W47 » -> [dimanche, samedi] à New York. */
export function weekBounds(week: string): [string, string] {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) throw new Error(`semaine attendue sous la forme AAAA-Wnn : ${week}`);
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (Number(m[2]) - 1) * 7);
  const iso = monday.toISOString().slice(0, 10);
  return [addDays(iso, -1), addDays(iso, 5)];
}

// --- événement pour l'écran -------------------------------------------------------------------

export function eventDict(ev: FfEvent, official: OfficialRelease | null | undefined): Record<string, unknown> {
  const [forecast, unit] = parseValue(ev.forecast_raw);
  const [previous] = parseValue(ev.previous_raw);
  const ind = ev.indicator;
  const tOff = official ? official.utc_ms : null;
  return {
    id: ev.identity,
    title: ev.title,
    title_fr: ind ? ind.label_fr : null,
    indicator: ind ? ind.id : null,
    capture: !!(ind && ind.capture),
    currency: ev.currency,
    impact: ev.impact,
    ny_date: ev.ny_date,
    time_ms: tOff !== null ? tOff : ev.time_ms,
    time_source: tOff !== null ? 'BLS' : 'ForexFactory',
    time_kind: tOff !== null ? 'officielle' : (ev.time_ms !== null ? 'indicative' : ev.time_raw),
    ff_time_ms: ev.time_ms,
    time_mismatch: tOff !== null && ev.time_ms !== null && ev.time_ms !== tOff,
    official: official ? { local_date: official.local_date, local_time: official.local_time, tz: official.tz, release: official.title } : null,
    forecast_raw: ev.forecast_raw || null,
    forecast,
    previous_raw: ev.previous_raw || null,
    previous,
    unit,
    actual: null,
    series: ev.series,
  };
}
