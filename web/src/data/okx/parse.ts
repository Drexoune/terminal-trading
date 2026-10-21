// Analyse des messages WebSocket publics OKX en événements normalisés.
//
// Portage à l'identique de collectors/terminal_collectors/okx/parse.py, pour
// le Mode Online où le navigateur lit OKX sans passerelle : mêmes clés, dans le
// même ordre, mêmes valeurs. La parité est vérifiée message par message contre
// collectors/tests/fixtures/parsed_golden.json (sorties du parseur Python,
// régénérées par scripts/make_okx_golden.py). Toute modification de parse.py
// doit être reportée ici, et inversement.
//
// Rappels (docs/okx.md, vérifiés sur messages réels) :
// - trades : `tradeId` est le DERNIER identifiant d'un agrégat de `count`
//   trades ; `sz` est en contrats, pas en BTC ;
// - tickers : `volCcy24h` en devise de base ; `sodUtc0` = ouverture du jour UTC ;
// - funding-rate : `fundingTime` = PROCHAINE échéance ;
// - candle* : [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm].

/** Réponse de contrôle (abonnement, erreur, notice) ou pong. */
export class Control {
  constructor(readonly event: string, readonly raw: Record<string, unknown>) {}
}

export interface TradeEvent {
  kind: 'trade'; inst: string; trade_id: number; count: number; px: number; sz: number;
  side: 'buy' | 'sell'; ts_source: number; ts_recv: number;
}

export interface TickerEvent {
  kind: 'ticker'; inst: string; last: number; bid: number | null; ask: number | null;
  open24h: number | null; high24h: number | null; low24h: number | null;
  sod_utc0: number | null; vol_base24h: number | null; ts_source: number; ts_recv: number;
}

export interface FundingEvent {
  kind: 'funding'; inst: string; rate: number; funding_time: number | null;
  prev_funding_time: number | null; interval_ms: number | null; ts_source: number; ts_recv: number;
}

export interface OpenInterestEvent {
  kind: 'open_interest'; inst: string; oi_base: number | null; oi_usd: number | null;
  ts_source: number; ts_recv: number;
}

export interface CandleEvent {
  kind: 'candle'; inst: string; bar: string; t: number; o: number; h: number; l: number; c: number;
  vol_base: number; vol_quote: number; confirmed: boolean; ts_recv: number | null;
}

export type OkxEvent = TradeEvent | TickerEvent | FundingEvent | OpenInterestEvent | CandleEvent;

type Dict = Record<string, unknown>;

// Conversions alignées sur Python : float() et int() refusent une valeur
// absente ou vide, _f() et _i() la rendent null. Un champ illisible lève une
// erreur, comme en Python : la connexion est alors refaite et l'erreur
// apparaît dans l'état du flux, au lieu d'une valeur fausse à l'écran.
function float(v: unknown, field: string): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  throw new Error(`OKX : champ ${field} illisible (${JSON.stringify(v)})`);
}

function int(v: unknown, field: string): number {
  const n = float(v, field);
  // Au-delà de 2^53, un identifiant perdrait sa précision en JavaScript.
  if (!Number.isSafeInteger(n)) throw new Error(`OKX : champ ${field} non entier (${JSON.stringify(v)})`);
  return n;
}

/** Champ obligatoire (d["x"] en Python : absent -> erreur). */
function req<T = string>(d: Dict, key: string): T {
  if (!Object.prototype.hasOwnProperty.call(d, key)) throw new Error(`OKX : champ ${key} absent`);
  return d[key] as T;
}

const empty = (v: unknown) => v === undefined || v === null || v === '';
const f = (v: unknown, field: string) => (empty(v) ? null : float(v, field));
const i = (v: unknown, field: string) => (empty(v) ? null : int(v, field));

function trade(d: Dict, recv: number): TradeEvent {
  return {
    kind: 'trade',
    inst: req(d, 'instId'),
    trade_id: int(d.tradeId, 'tradeId'),
    count: int(d.count || 1, 'count'),
    px: float(d.px, 'px'),
    sz: float(d.sz, 'sz'),
    side: req<'buy' | 'sell'>(d, 'side'),
    ts_source: int(d.ts, 'ts'),
    ts_recv: recv,
  };
}

function ticker(d: Dict, recv: number): TickerEvent {
  return {
    kind: 'ticker',
    inst: req(d, 'instId'),
    last: float(d.last, 'last'),
    bid: f(d.bidPx, 'bidPx'),
    ask: f(d.askPx, 'askPx'),
    open24h: f(d.open24h, 'open24h'),
    high24h: f(d.high24h, 'high24h'),
    low24h: f(d.low24h, 'low24h'),
    sod_utc0: f(d.sodUtc0, 'sodUtc0'),
    vol_base24h: f(d.volCcy24h, 'volCcy24h'),
    ts_source: int(d.ts, 'ts'),
    ts_recv: recv,
  };
}

function funding(d: Dict, recv: number): FundingEvent {
  const nxt = i(d.fundingTime, 'fundingTime');
  const prev = i(d.prevFundingTime, 'prevFundingTime');
  return {
    kind: 'funding',
    inst: req(d, 'instId'),
    rate: float(d.fundingRate, 'fundingRate'),
    funding_time: nxt,
    prev_funding_time: prev,
    interval_ms: nxt && prev ? nxt - prev : null,
    ts_source: int(d.ts, 'ts'),
    ts_recv: recv,
  };
}

function openInterest(d: Dict, recv: number): OpenInterestEvent {
  return {
    kind: 'open_interest',
    inst: req(d, 'instId'),
    oi_base: f(d.oiCcy, 'oiCcy'),
    oi_usd: f(d.oiUsd, 'oiUsd'),
    ts_source: int(d.ts, 'ts'),
    ts_recv: recv,
  };
}

/** Bougie OKX (REST ou WebSocket, même tableau) en objet. */
export function candleFromRow(inst: string, bar: string, row: unknown[],
  recv: number | null = null): CandleEvent {
  return {
    kind: 'candle',
    inst,
    bar,
    t: int(row[0], 'ts'),
    o: float(row[1], 'o'),
    h: float(row[2], 'h'),
    l: float(row[3], 'l'),
    c: float(row[4], 'c'),
    vol_base: float(row[6], 'volCcy'),
    vol_quote: float(row[7], 'volCcyQuote'),
    confirmed: row[8] === '1',
    ts_recv: recv,
  };
}

const PARSERS: Record<string, (d: Dict, recv: number) => OkxEvent> = {
  trades: trade,
  tickers: ticker,
  'funding-rate': funding,
  'open-interest': openInterest,
};

/** Analyse un message brut. Retourne des événements ou un contrôle. */
export function parse(raw: string, recvMs: number): OkxEvent[] | Control {
  if (raw === 'pong') return new Control('pong', {});
  const msg = JSON.parse(raw) as Dict;
  if (Object.prototype.hasOwnProperty.call(msg, 'event')) return new Control(msg.event as string, msg);
  const arg = (msg.arg || {}) as Dict;
  const channel = (arg.channel ?? '') as string;
  const data = (msg.data || []) as unknown[];
  if (channel.startsWith('candle')) {
    const bar = channel.slice('candle'.length);
    return data.map((row) => candleFromRow(req(arg, 'instId'), bar, row as unknown[], recvMs));
  }
  const parser = Object.prototype.hasOwnProperty.call(PARSERS, channel) ? PARSERS[channel] : undefined;
  if (!parser) return new Control('unknown', msg);
  return data.map((d) => parser(d as Dict, recvMs));
}
