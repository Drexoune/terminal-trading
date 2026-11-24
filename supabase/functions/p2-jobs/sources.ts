// Lecture des réponses de Polymarket, Kalshi et du BIS (plan P2, étape R1). Modules purs, testés
// sur les réponses réelles de fixtures/ (R0 et relevé du 23/11/2026).
//
// Vérifié le 23/11/2026 sur une réponse réelle :
//   - Gamma (`/public-search`, `/events`) est servi par un cache (max-age 60 à 300 s) : il sert à la
//     découverte des marchés et au volume sur 24 h, jamais aux prix de chaque minute ;
//   - CLOB `POST /books` : `bids` croissants et `asks` décroissants (l'inverse de la documentation) :
//     meilleur achat = maximum, meilleure vente = minimum, quel que soit l'ordre ; son champ
//     `last_trade_price` peut porter l'échange du jeton « non » : le dernier échange vient de
//     `POST /last-trades-prices` ;
//   - Kalshi ne date pas la cotation (`updated_time` = fiche du marché) : heure de réception seule.

import type { Bank } from './meetings.ts';
import { kalshiOutcome, matchMeeting, pickProbability, polymarketOutcome, type Outcome, type Quote } from './rates_rules.ts';

export const GAMMA = 'https://gamma-api.polymarket.com';
export const CLOB = 'https://clob.polymarket.com';
export const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
export const BIS = 'https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0';

/** Recherche Gamma par banque : mots de la recherche, titre attendu des événements « décision ». */
export const PM_SEARCH: Record<Bank, { q: string; title: RegExp }> = {
  FED: { q: 'fed decision', title: /^Fed Decision in /i },
  BCE: { q: 'ecb interest rates', title: /^ECB Interest Rates: /i },
  BOE: { q: 'bank of england decision', title: /^Bank of England Decision in /i },
  BOJ: { q: 'bank of japan decision', title: /^Bank of Japan Decision in /i },
  BNS: { q: 'swiss national bank decision', title: /^Swiss National Bank Decision in /i },
  BOC: { q: 'bank of canada decision', title: /^Bank of Canada Decision in /i },
  RBA: { q: 'reserve bank of australia decision', title: /^Reserve Bank of Australia Decision in /i },
  RBNZ: { q: 'reserve bank of new zealand decision', title: /^Reserve Bank of New Zealand Decision in /i },
};

/** Séries Kalshi des décisions (5 banques sur 8, R0) ; BCE, BoE et RBA : séries expirées. */
export const KALSHI_SERIES: Partial<Record<Bank, string>> = {
  FED: 'KXFEDDECISION', BOJ: 'KXCBDECISIONJAPAN', BOC: 'KXCBDECISIONCANADA', BNS: 'KXCBDSWISS', RBNZ: 'KXCBDECISIONNZ',
};
export const KALSHI_NONE = 'marché non coté chez Kalshi (séries expirées)';
export const KALSHI_FED_PATH = 'KXFED';

/** Codes de zone du BIS (WS_CBPOL). */
export const BIS_AREA: Record<Bank, string> = { FED: 'US', BCE: 'XM', BOE: 'GB', BOJ: 'JP', BNS: 'CH', BOC: 'CA', RBA: 'AU', RBNZ: 'NZ' };

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};

// --- Polymarket ------------------------------------------------------------------------------

export interface PmOutcome { token: string; label: string; vol24: number | null }
export interface PmEvent { bank: Bank; meeting: string | null; event_id: string; title: string; end_date: string | null;
  outcomes: Partial<Record<Outcome, PmOutcome>>; skipped: string[] }

interface GammaMarket { groupItemTitle?: string; clobTokenIds?: string; volume24hr?: number; closed?: boolean }
interface GammaEvent { slug?: string; title?: string; endDate?: string; closed?: boolean; markets?: GammaMarket[] }

/** Réponse de `/public-search` -> événements « décision » de la banque, rattachés aux réunions officielles. */
export function pmEvents(bank: Bank, body: string): PmEvent[] {
  const d = JSON.parse(body) as { events?: GammaEvent[] };
  const out: PmEvent[] = [];
  for (const e of d.events ?? []) {
    if (!e.slug || !e.title || e.closed || !PM_SEARCH[bank].title.test(e.title)) continue;
    const outcomes: Partial<Record<Outcome, PmOutcome>> = {};
    const skipped: string[] = [];
    for (const m of e.markets ?? []) {
      const o = polymarketOutcome(m.groupItemTitle);
      let token: string | undefined;
      try { token = (JSON.parse(m.clobTokenIds ?? '[]') as string[])[0]; } catch { token = undefined; }
      if (!o || !token || outcomes[o]) { skipped.push(m.groupItemTitle ?? '?'); continue; }
      outcomes[o] = { token, label: m.groupItemTitle ?? '', vol24: num(m.volume24hr) };
    }
    out.push({ bank, meeting: matchMeeting(bank, e.endDate), event_id: e.slug, title: e.title, end_date: e.endDate ?? null, outcomes, skipped });
  }
  return out;
}

export interface Book { bid: number | null; ask: number | null; ts: number | null }

/** Réponse de `POST /books` -> meilleur achat (maximum), meilleure vente (minimum), heure du carnet, par jeton. */
export function pmBooks(body: string): Map<string, Book> {
  const d = JSON.parse(body) as { asset_id?: string; timestamp?: string; bids?: { price: string }[]; asks?: { price: string }[] }[];
  const out = new Map<string, Book>();
  for (const b of Array.isArray(d) ? d : []) {
    if (!b.asset_id) continue;
    const bids = (b.bids ?? []).map((x) => num(x.price)).filter((x): x is number => x !== null);
    const asks = (b.asks ?? []).map((x) => num(x.price)).filter((x): x is number => x !== null);
    out.set(b.asset_id, { bid: bids.length ? Math.max(...bids) : null, ask: asks.length ? Math.min(...asks) : null, ts: num(b.timestamp) });
  }
  return out;
}

/** Réponse de `POST /last-trades-prices` -> dernier prix échangé par jeton. */
export function pmLastTrades(body: string): Map<string, number> {
  const d = JSON.parse(body) as { token_id?: string; price?: string }[];
  const out = new Map<string, number>();
  for (const x of Array.isArray(d) ? d : []) {
    const p = num(x.price);
    if (x.token_id && p !== null) out.set(x.token_id, p);
  }
  return out;
}

/** Cotation Polymarket d'une réunion (carnets et derniers échanges de chaque issue). */
export function pmQuote(outcomes: Partial<Record<Outcome, PmOutcome>>, books: Map<string, Book>, last: Map<string, number>):
  { probs: Partial<Record<Outcome, Quote>>; ts_source: number | null } {
  const probs: Partial<Record<Outcome, Quote>> = {};
  let ts: number | null = null;
  for (const [o, m] of Object.entries(outcomes) as [Outcome, PmOutcome][]) {
    const b = books.get(m.token);
    const q = pickProbability(b?.bid ?? null, b?.ask ?? null, last.get(m.token) ?? null, m.vol24);
    if (q.p === null) continue;
    probs[o] = q;
    if (b?.ts) ts = Math.max(ts ?? 0, b.ts);
  }
  return { probs, ts_source: ts };
}

/** Réponse de `/prices-history` -> points (instant ms, probabilité). */
export function pmHistory(body: string): { t: number; p: number }[] {
  const d = JSON.parse(body) as { history?: { t?: number; p?: number }[] };
  return (d.history ?? []).flatMap((x) => (typeof x.t === 'number' && typeof x.p === 'number' && Number.isFinite(x.p) ? [{ t: x.t * 1000, p: x.p }] : []));
}

// --- Kalshi ----------------------------------------------------------------------------------

interface KMarket { ticker?: string; yes_sub_title?: string; status?: string; yes_bid_dollars?: string; yes_ask_dollars?: string;
  last_price_dollars?: string; volume_24h_fp?: string; expected_expiration_time?: string; close_time?: string;
  floor_strike?: number | null; strike_type?: string }
interface KEvent { event_ticker?: string; title?: string; sub_title?: string; strike_date?: string | null; markets?: KMarket[] }

export interface KDecision { bank: Bank; meeting: string | null; event_ticker: string; title: string;
  probs: Partial<Record<Outcome, Quote>>; tickers: Partial<Record<Outcome, string>> }

const kq = (m: KMarket): Quote => pickProbability(num(m.yes_bid_dollars), num(m.yes_ask_dollars), num(m.last_price_dollars), num(m.volume_24h_fp));

/** Réponse de `/events?series_ticker=…&with_nested_markets=true` (décisions) -> cotation par réunion. */
export function kalshiDecisions(bank: Bank, body: string): KDecision[] {
  const d = JSON.parse(body) as { events?: KEvent[] };
  const out: KDecision[] = [];
  for (const e of d.events ?? []) {
    if (!e.event_ticker) continue;
    const live = (e.markets ?? []).filter((m) => m.ticker && (m.status === 'active' || m.status === undefined));
    if (!live.length) continue;
    const probs: Partial<Record<Outcome, Quote>> = {};
    const tickers: Partial<Record<Outcome, string>> = {};
    for (const m of live) {
      const o = kalshiOutcome(m.ticker!, m.yes_sub_title);
      if (!o || probs[o]) continue;
      const q = kq(m);
      tickers[o] = m.ticker!;
      if (q.p !== null) probs[o] = q;
    }
    const when = live[0].expected_expiration_time ?? live[0].close_time ?? e.strike_date ?? null;
    out.push({ bank, meeting: matchMeeting(bank, when), event_ticker: e.event_ticker, title: e.title ?? e.event_ticker, probs, tickers });
  }
  return out;
}

/** KXFED : par réunion, marchés « borne haute > K » (probabilité retenue de chacun). */
export function kalshiFedLevels(body: string): { meeting: string | null; event_ticker: string; strikes: { k: number; p: number }[]; wide: number }[] {
  const d = JSON.parse(body) as { events?: KEvent[] };
  return (d.events ?? []).flatMap((e) => {
    const live = (e.markets ?? []).filter((m) => m.strike_type === 'greater' && typeof m.floor_strike === 'number' && m.status === 'active');
    if (!e.event_ticker || !live.length) return [];
    let wide = 0;
    const strikes = live.flatMap((m) => {
      const q = kq(m);
      if (q.wide) wide++;
      return q.p === null ? [] : [{ k: m.floor_strike as number, p: q.p }];
    });
    return [{ meeting: matchMeeting('FED', e.strike_date ?? live[0].expected_expiration_time), event_ticker: e.event_ticker, strikes, wide }];
  });
}

/** Bougies Kalshi (`/candlesticks`) -> points : milieu de la fourchette de clôture si ≤ 10 points, sinon dernier prix. */
export function kalshiCandles(body: string): { t: number; p: number }[] {
  const d = JSON.parse(body) as { candlesticks?: { end_period_ts?: number; price?: { close_dollars?: string | null };
    yes_bid?: { close_dollars?: string | null }; yes_ask?: { close_dollars?: string | null } }[] };
  return (d.candlesticks ?? []).flatMap((c) => {
    if (typeof c.end_period_ts !== 'number') return [];
    const q = pickProbability(num(c.yes_bid?.close_dollars), num(c.yes_ask?.close_dollars), num(c.price?.close_dollars));
    return q.p === null ? [] : [{ t: c.end_period_ts * 1000, p: q.p }];
  });
}

// --- BIS -------------------------------------------------------------------------------------

/** CSV SDMX du BIS -> observations par zone, dans l'ordre des dates. Les champs entre guillemets
 *  peuvent contenir des virgules : la date et la valeur se lisent par la fin de la ligne. */
export function bisSeries(body: string): Map<string, [string, number][]> {
  const out = new Map<string, [string, number][]>();
  for (const line of body.trim().split(/\r?\n/).slice(1)) {
    const m = /,(\d{4}-\d{2}-\d{2}),(-?\d+(?:\.\d+)?),[A-Z]?,[A-Z]?,[^,]*$/.exec(line);
    const area = line.split(',')[1];
    if (!m || !area) continue;
    if (!out.has(area)) out.set(area, []);
    out.get(area)!.push([m[1], Number(m[2])]);
  }
  for (const s of out.values()) s.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return out;
}

export interface PolicyRate { rate: number; date: string; last_change: { date: string; from: number; to: number } | null; since: string }

/** Dernier taux et dernier mouvement d'une série du BIS ; `since` = première date lue (aucun mouvement depuis). */
export function policyFromSeries(s: [string, number][]): PolicyRate | null {
  if (!s.length) return null;
  const [date, rate] = s[s.length - 1];
  for (let i = s.length - 1; i > 0; i--) {
    if (s[i][1] !== s[i - 1][1]) return { rate, date, last_change: { date: s[i][0], from: s[i - 1][1], to: s[i][1] }, since: s[0][0] };
  }
  return { rate, date, last_change: null, since: s[0][0] };
}
