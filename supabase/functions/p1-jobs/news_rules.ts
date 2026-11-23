// Fil d'actus (étape E6, en ligne : O6) : flux, lecture RSS, heures, catégories, urgence et
// doublons. Module pur, testé par Vitest sur les captures réelles du 20/11/2026
// (gateway/tests/fixtures/news/, scripts/explore_news.py rss).
//
// Règles versionnées (plan P1 § 9) : catégories et « fort impact » par expressions fixées ici,
// jamais par l'IA ; l'empreinte RULES_VERSION change dès qu'une règle change et accompagne
// chaque titre enregistré. Titres et résumés restent dans leur langue d'origine (T-019).
//
// Pièges vérifiés sur les captures :
// - Banque du Canada : l'heure de Toronto est étiquetée « +00:00 » (communiqué de 10:00 à
//   Toronto écrit « 10:00:04+00:00 ») ; l'étiquette est ignorée, l'heure lue à Toronto.
// - BCE (canal MID) : date du canal « 2026/11/20 11:25:22 », sans fuseau : heure de Francfort.
// - BNS : RSS 2.0 avec dc:date seulement ; titres « AAAA-MM-JJ - … ».
// - BoE : « Thu, 19 Nov 2026 08:00:00 Z » ; RBA : « 2026-11-06T10:45+11:00 », sans secondes,
//   et un seul élément dans le flux.
// - URL : double barre oblique de la BCE, http de la BoJ, « ?xy=rss » de FinancialJuice.

import { civilDate, zonedToUtc } from './calendar.ts';

export type Category = 'banque-centrale' | 'macro' | 'crypto' | 'matieres-premieres' | 'general';

export interface Feed {
  id: string;
  bank: string | null;          // FED, BCE, BOE, BOJ, BNS, BOC, RBA, RBNZ ; null : fil d'agence
  currency: string | null;      // devise de la banque : fenêtre rapide autour de ses décisions
  source: string;               // libellé affiché
  url: string;
  kind: 'officielle' | 'agence';
  tz: string;                   // fuseau d'une date sans fuseau (ou à étiquette fausse)
  labelLies?: boolean;          // étiquette de fuseau fausse : heure lue dans tz
}

export const FEEDS: Feed[] = [
  { id: 'fed-monetary', bank: 'FED', currency: 'USD', source: 'Fed', url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', kind: 'officielle', tz: 'America/New_York' },
  { id: 'fed-all', bank: 'FED', currency: 'USD', source: 'Fed', url: 'https://www.federalreserve.gov/feeds/press_all.xml', kind: 'officielle', tz: 'America/New_York' },
  { id: 'fed-speeches', bank: 'FED', currency: 'USD', source: 'Fed', url: 'https://www.federalreserve.gov/feeds/speeches.xml', kind: 'officielle', tz: 'America/New_York' },
  { id: 'ecb-press', bank: 'BCE', currency: 'EUR', source: 'BCE', url: 'https://www.ecb.europa.eu/rss/press.html', kind: 'officielle', tz: 'Europe/Berlin' },
  { id: 'ecb-mid', bank: 'BCE', currency: 'EUR', source: 'BCE · MID', url: 'https://mid.ecb.europa.eu/rss/mid.xml', kind: 'officielle', tz: 'Europe/Berlin' },
  { id: 'boe-news', bank: 'BOE', currency: 'GBP', source: 'BoE', url: 'https://www.bankofengland.co.uk/rss/news', kind: 'officielle', tz: 'Europe/London' },
  { id: 'boe-speeches', bank: 'BOE', currency: 'GBP', source: 'BoE', url: 'https://www.bankofengland.co.uk/rss/speeches', kind: 'officielle', tz: 'Europe/London' },
  { id: 'boj-whatsnew', bank: 'BOJ', currency: 'JPY', source: 'BoJ', url: 'https://www.boj.or.jp/en/rss/whatsnew.xml', kind: 'officielle', tz: 'Asia/Tokyo' },
  { id: 'snb-pressrel', bank: 'BNS', currency: 'CHF', source: 'BNS', url: 'https://www.snb.ch/public/rss/en/pressrel', kind: 'officielle', tz: 'Europe/Zurich' },
  { id: 'snb-mopo', bank: 'BNS', currency: 'CHF', source: 'BNS', url: 'https://www.snb.ch/public/rss/en/mopo', kind: 'officielle', tz: 'Europe/Zurich' },
  { id: 'boc-press', bank: 'BOC', currency: 'CAD', source: 'BoC', url: 'https://www.bankofcanada.ca/content_type/press-releases/feed/', kind: 'officielle', tz: 'America/Toronto', labelLies: true },
  { id: 'boc-announcements', bank: 'BOC', currency: 'CAD', source: 'BoC', url: 'https://www.bankofcanada.ca/content_type/announcements/feed/', kind: 'officielle', tz: 'America/Toronto', labelLies: true },
  { id: 'rba-media', bank: 'RBA', currency: 'AUD', source: 'RBA', url: 'https://www.rba.gov.au/rss/rss-cb-media-releases.xml', kind: 'officielle', tz: 'Australia/Sydney' },
  { id: 'rbnz-news', bank: 'RBNZ', currency: 'NZD', source: 'RBNZ', url: 'https://www.rbnz.govt.nz/feeds/news', kind: 'officielle', tz: 'Pacific/Auckland' },
  { id: 'financialjuice', bank: null, currency: null, source: 'FinancialJuice', url: 'https://www.financialjuice.com/feed.ashx?xy=rss', kind: 'agence', tz: 'UTC' },
];
export const FEED_BY_ID = new Map(FEEDS.map((f) => [f.id, f]));

// --- lecture XML --------------------------------------------------------------------------------

export interface RawItem { title: string; link: string | null; guid: string | null; date_raw: string | null; summary: string | null; category: string | null }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

/** Texte d'un élément : CDATA déroulé, entités décodées, balises HTML retirées, blancs réduits. */
export function textOf(inner: string): string {
  let s = inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c: string) => c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  s = unescapeXml(s.replace(/<[^>]*>/g, ' '));
  // Le HTML d'un résumé arrive souvent échappé une fois de plus : balises et entités restantes.
  s = unescapeXml(s.replace(/<[^>]*>/g, ' '));
  return s.replace(/\s+/g, ' ').trim();
}

function child(block: string, names: string[]): string | null {
  for (const n of names) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i').exec(block);
    if (m) return textOf(m[1]);
  }
  return null;
}

/**
 * Octets d'un flux -> texte : marque d'ordre des octets, puis encodage de la déclaration XML,
 * puis celui de l'en-tête HTTP, sinon UTF-8 (défaut de XML). Un encodage inconnu retombe sur UTF-8.
 */
export function decodeFeed(body: Uint8Array | string, contentType: string | null = null): string {
  if (typeof body === 'string') return body;
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return new TextDecoder('utf-8').decode(body.subarray(3));
  const head = new TextDecoder('latin1').decode(body.subarray(0, 200));
  const label = /<\?xml[^>]*encoding=["']([\w.-]+)["']/i.exec(head)?.[1] ?? /charset=([\w.-]+)/i.exec(contentType ?? '')?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/** Éléments d'un flux RSS 2.0, RSS 1.0 (RDF) ou Atom. */
export function parseFeed(body: Uint8Array | string, contentType: string | null = null): RawItem[] {
  const xml = decodeFeed(body, contentType);
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
  return blocks.map(([whole, , inner]) => {
    const about = /rdf:about="([^"]+)"/.exec(whole)?.[1] ?? null;
    const atomLink = /<link\b[^>]*href="([^"]+)"/i.exec(inner)?.[1] ?? null;
    return {
      title: child(inner, ['title']) ?? '',
      link: child(inner, ['link']) || atomLink || about,
      guid: child(inner, ['guid', 'id']) || about,
      date_raw: child(inner, ['pubDate', 'dc:date', 'published', 'updated']),
      summary: child(inner, ['description', 'summary', 'content']),
      category: child(inner, ['category', 'dc:subject']),
    };
  }).filter((i) => i.title);
}

// --- heures ---------------------------------------------------------------------------------

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function offsetMs(z: string): number | null {
  if (/^(z|gmt|ut|utc)$/i.test(z)) return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(z);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
}

/**
 * Heure UTC d'une date de flux, ou null si illisible. Sans fuseau, ou quand l'étiquette du
 * flux est connue pour mentir (BoC), l'heure est lue dans le fuseau du flux.
 */
export function parseFeedDate(raw: string | null, feed: Pick<Feed, 'tz' | 'labelLies'>): number | null {
  if (!raw) return null;
  const s = raw.trim();
  let y: number, mo: number, d: number, h: number, mi: number, sec: number, zone: string | undefined;
  let m = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*([A-Za-z]+|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    [d, y, h, mi, sec] = [Number(m[1]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
    mo = MONTHS[m[2].toLowerCase()];
    zone = m[7];
    if (!mo) return null;
  } else {
    m = /^(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
    if (!m) return null;
    [y, mo, d, h, mi, sec] = [1, 2, 3, 4, 5, 6].map((i) => Number(m![i] ?? 0));
    zone = m[7];
  }
  const off = zone === undefined || feed.labelLies ? null : offsetMs(zone);
  if (zone !== undefined && !feed.labelLies && off === null) return null;
  const base = off === null ? zonedToUtc(y, mo, d, h, mi, feed.tz) : Date.UTC(y, mo - 1, d, h, mi) - off;
  return base + sec * 1000;
}

// --- identité et doublons -------------------------------------------------------------------

export function canonicalUrl(url: string | null): string | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase();
  u.pathname = u.pathname.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
  u.searchParams.delete('xy');
  for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
  u.hash = '';
  return u.toString();
}

export function cleanTitle(feed: Feed, title: string): string {
  return feed.id === 'financialjuice' ? title.replace(/^FinancialJuice:\s*/i, '').trim() : title.trim();
}

export function normTitle(title: string): string {
  return title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}%.\-]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Nombres d'un titre : deux titres qui n'ont pas les mêmes ne sont jamais fusionnés. */
export function numbersOf(title: string): string {
  return [...title.matchAll(/[-−]?\d+(?:[.,]\d+)?%?/g)].map((x) => x[0].replace('−', '-').replace(',', '.')).join(' ');
}

const WORD = /[\p{L}\p{N}]{3,}/gu;
export function nearDuplicate(a: string, b: string): boolean {
  if (numbersOf(a) !== numbersOf(b)) return false;
  const A = new Set(normTitle(a).match(WORD) ?? []);
  const B = new Set(normTitle(b).match(WORD) ?? []);
  if (A.size < 3 || B.size < 3) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter) >= 0.8;
}

// --- catégories, urgence, rubriques écartées -------------------------------------------------

/** Titres de décision de chaque banque (plan P1 § 9) ; la BNS est ancrée sur la date. */
export const DECISION_RULES: Record<string, RegExp> = {
  FED: /^Federal Reserve issues FOMC statement$|^Minutes of the Federal Open Market Committee\b/i,
  BCE: /^Monetary policy decisions$/i,
  BOE: /\bBank Rate (?:maintained|reduced|increased|cut|raised|held|unchanged)\b/i,
  BOJ: /^Statement on Monetary Policy\b/i,
  BNS: /^(\d{4}-\d{2}-\d{2}) - Monetary policy assessment of\b/i,
  BOC: /^Bank of Canada (?:maintains|holds|reduces|lowers|cuts|increases|raises)\b.*\bpolicy (?:interest )?rate\b/i,
  RBA: /\bMonetary Policy Decision\b/i,
  RBNZ: /^(?:OCR|Official Cash Rate)\b.*\b(?:reduced|cut|increased|raised|held|unchanged|on hold)\b|\bon hold\b/i,
};

/** Chiffre structuré de FinancialJuice : « UK Retail Sales MoM Actual 0.7% (Forecast 0%, Previous -0.4%) ». */
export const FIGURE = /^(.+?) Actual (\S+) \(Forecast ([^,]+), Previous ([^,)]+)(?:, Revised ([^)]+))?\)\s*$/;
const MAJOR_COUNTRY = /^(?:US|USA|U\.S\.|Eurozone|EZ|Euro Zone|German|Germany|UK|British|Japan|Japanese|Swiss|Switzerland|Canadian|Canada|Australian|Australia|New Zealand|NZ)\b/i;
const MAJOR_INDICATOR = /\b(?:CPI|Core PCE|PCE|Non[- ]?Farm Payrolls|Nonfarm Payrolls|Unemployment Rate|Employment Change|GDP|Retail Sales|Interest Rate Decision|Rate Decision|ISM Manufacturing|ISM Services|Average (?:Hourly )?Earnings)\b/i;
const CB_SPEAKER = /^(?:Fed|ECB|BoE|BOE|BoJ|BOJ|SNB|BoC|BOC|RBA|RBNZ)(?:'s|’s| Chair| President| Governor)\b|^(?:Powell|Lagarde|Bailey|Ueda|Schlegel|Macklem|Bullock)\b/;
const CRYPTO = /\b(?:bitcoin|btc|ether|ethereum|eth|crypto(?:currency|currencies)?|stablecoins?|coinbase|binance|microstrategy|saylor|spot (?:bitcoin|ether) etf|tether|usdt|usdc|solana)\b/i;
const COMMODITIES = /\b(?:oil|crude|brent|wti|opec\+?|gold|silver|copper|natural gas|lng|wheat|corn|soybeans?|iron ore)\b/i;
/** Rubriques récurrentes de FinancialJuice (graphiques, recherche payante) : écartées et comptées. */
export const FJ_NOISE = /(?:Implied Volatility|Correlation Matrix|Interest Rate Probabilities|MOO Imbalance|MOC Imbalance|Currency Strength Chart.*)$|- FJElite\s*$/i;

export interface Classified { category: Category; urgent: boolean; rule: string | null; figure: Record<string, string | null> | null }

export function classify(feed: Feed, title: string, publishedMs: number | null): Classified {
  if (feed.bank) {
    const rx = DECISION_RULES[feed.bank];
    const m = rx?.exec(title);
    let urgent = !!m;
    // BNS : le titre porte la date de l'évaluation ; seule celle du jour de publication compte.
    if (m && feed.bank === 'BNS') {
      const day = publishedMs === null ? null : civilDate(publishedMs, feed.tz);
      urgent = m[1] === day;
    }
    return { category: 'banque-centrale', urgent, rule: urgent ? `decision:${feed.bank}` : null, figure: null };
  }
  const f = FIGURE.exec(title);
  if (f) {
    const name = f[1].trim();
    const major = MAJOR_COUNTRY.test(name) && MAJOR_INDICATOR.test(name);
    const dash = (v: string | undefined) => (v === undefined || v.trim() === '-' ? null : v.trim());
    return { category: 'macro', urgent: major, rule: major ? 'figure:major' : 'figure',
      figure: { name, actual: dash(f[2]), forecast: dash(f[3]), previous: dash(f[4]), revised: dash(f[5]) } };
  }
  if (CB_SPEAKER.test(title)) return { category: 'banque-centrale', urgent: false, rule: 'speaker', figure: null };
  if (CRYPTO.test(title)) return { category: 'crypto', urgent: false, rule: 'crypto', figure: null };
  if (COMMODITIES.test(title)) return { category: 'matieres-premieres', urgent: false, rule: 'commodities', figure: null };
  return { category: 'general', urgent: false, rule: null, figure: null };
}

/** Empreinte des règles (FNV-1a sur leur texte) : change dès qu'une règle change. */
export const RULES_VERSION = (() => {
  const text = JSON.stringify([Object.entries(DECISION_RULES).map(([k, v]) => [k, v.source, v.flags]), FIGURE.source,
    MAJOR_COUNTRY.source, MAJOR_INDICATOR.source, CB_SPEAKER.source, CRYPTO.source, COMMODITIES.source, FJ_NOISE.source]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `r1-${h.toString(16).padStart(8, '0')}`;
})();
