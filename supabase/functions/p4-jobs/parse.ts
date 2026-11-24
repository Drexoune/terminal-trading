// Lecture des réponses des sources de P4, formats relevés le 24/11/2026 (docs/exploration-p4.md).
// Fonctions pures, testées sur les réponses réelles (fixtures/). Rien n'est inventé : une ligne
// illisible est ignorée, une réponse sans aucune ligne lisible lève une erreur.

export interface Point { date: string; value: number; adj?: number }
export interface CotRow {
  market_code: string; market: string; date: string; category: string;
  long: number; short: number; spread: number | null; open_interest: number;
}
export interface CrowdPoint { ts_ms: number; value: number; long_share: number | null }

const num = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '' || x === '.') return null;
  const n = typeof x === 'number' ? x : Number(String(x).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

function nonEmpty<T>(rows: T[], what: string): T[] {
  if (!rows.length) throw new Error(`${what} : aucune ligne lisible`);
  return rows;
}

const isWeekday = (date: string) => { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d >= 1 && d <= 5; };

/** CSV de Cboe : « DATE,OPEN,HIGH,LOW,CLOSE », dates MM/DD/YYYY. */
export function cboeCsv(body: string, from: string): Point[] {
  const out: Point[] = [];
  for (const line of body.trim().split(/\r?\n/).slice(1)) {
    const f = line.split(',');
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(f[0] ?? '');
    const v = num(f[4]);
    if (!m || v === null) continue;
    const date = `${m[3]}-${m[1]}-${m[2]}`;
    if (date >= from) out.push({ date, value: v });
  }
  return nonEmpty(out, 'Cboe');
}

/** CSV de FRED : « observation_date,ID », valeurs manquantes vides ou « . ». */
export function fredDaily(body: string, from: string): Point[] {
  const out: Point[] = [];
  for (const line of body.trim().split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(',');
    const v = num(raw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') && v !== null && date >= from) out.push({ date, value: v });
  }
  return nonEmpty(out, 'FRED');
}

/** Tiingo /tiingo/daily/<t>/prices : clôture et clôture ajustée des dividendes, date de séance. */
export function tiingoDaily(body: string): Point[] {
  const d = JSON.parse(body) as { date?: string; close?: unknown; adjClose?: unknown }[];
  if (!Array.isArray(d)) throw new Error('Tiingo : liste attendue');
  const out: Point[] = [];
  for (const x of d) {
    const v = num(x.close), a = num(x.adjClose);
    if (typeof x.date === 'string' && v !== null) out.push({ date: x.date.slice(0, 10), value: v, ...(a !== null ? { adj: a } : {}) });
  }
  return nonEmpty(out, 'Tiingo');
}

/** Tiingo /tiingo/fx/<t>/prices?resampleFreq=1day : jours de semaine seulement (une bougie existe le dimanche). */
export function tiingoFxDaily(body: string): Point[] {
  const d = JSON.parse(body) as { date?: string; close?: unknown }[];
  if (!Array.isArray(d)) throw new Error('Tiingo FX : liste attendue');
  const out: Point[] = [];
  for (const x of d) {
    const v = num(x.close);
    const date = typeof x.date === 'string' ? x.date.slice(0, 10) : '';
    if (date && v !== null && isWeekday(date)) out.push({ date, value: v });
  }
  return nonEmpty(out, 'Tiingo FX');
}

/**
 * OKX /market/history-candles, barre 1Dutc : [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm],
 * la plus récente en tête. Bougie en cours (confirm = 0) exclue.
 */
export function okxDailyCandles(body: string): Point[] {
  const d = JSON.parse(body) as { code?: string; msg?: string; data?: string[][] };
  if (d.code !== '0') throw new Error(`OKX : code ${d.code ?? '?'} ${d.msg ?? ''}`.trim());
  const out: Point[] = [];
  for (const c of d.data ?? []) {
    const ts = num(c[0]), v = num(c[4]);
    if (ts === null || v === null || c[8] !== '1') continue;
    out.push({ date: new Date(ts).toISOString().slice(0, 10), value: v });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Rapport TFF (Socrata) : une ligne par marché, date et catégorie ; marchés hors catalogue ignorés. */
export function tffRows(body: string, markets: Record<string, unknown>,
  categories: Record<string, readonly (string | null)[]>): CotRow[] {
  const d = JSON.parse(body) as Record<string, string>[];
  if (!Array.isArray(d)) throw new Error('CFTC : liste attendue');
  const out: CotRow[] = [];
  for (const x of d) {
    const code = (x.cftc_contract_market_code ?? '').trim();
    const date = (x.report_date_as_yyyy_mm_dd ?? '').slice(0, 10);
    const oi = num(x.open_interest_all);
    if (!(code in markets) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || oi === null) continue;
    for (const [category, [l, s, sp]] of Object.entries(categories)) {
      const long = num(x[l!]), short = num(x[s!]);
      if (long === null || short === null) continue;
      out.push({ market_code: code, market: x.market_and_exchange_names ?? code, date, category, long, short,
        spread: sp ? num(x[sp]) : null, open_interest: oi });
    }
  }
  return out;
}

/** Binance /futures/data/*LongShort*Ratio : liste du plus ancien au plus récent. */
export function binanceRatio(body: string): CrowdPoint[] {
  const d = JSON.parse(body) as { timestamp?: number; longShortRatio?: string; longAccount?: string }[];
  if (!Array.isArray(d)) throw new Error(`Binance : ${JSON.stringify(d).slice(0, 80)}`);
  return d.flatMap((x) => {
    const ts = num(x.timestamp), v = num(x.longShortRatio);
    return ts === null || v === null ? [] : [{ ts_ms: ts, value: v, long_share: num(x.longAccount) }];
  });
}

/** OKX rubik : { code, data: [[ts, ratio], …] }, le plus récent en tête. */
export function okxRatio(body: string): CrowdPoint[] {
  const d = JSON.parse(body) as { code?: string; msg?: string; data?: string[][] };
  if (d.code !== '0') throw new Error(`OKX : code ${d.code ?? '?'} ${d.msg ?? ''}`.trim());
  return (d.data ?? []).flatMap((x) => {
    const ts = num(x[0]), v = num(x[1]);
    return ts === null || v === null ? [] : [{ ts_ms: ts, value: v, long_share: v / (1 + v) }];
  });
}

/** Bybit v5 /market/account-ratio : part acheteuse et vendeuse ; ratio = achat / vente. */
export function bybitRatio(body: string): CrowdPoint[] {
  const d = JSON.parse(body) as { retCode?: number; retMsg?: string; result?: { list?: { timestamp?: string; buyRatio?: string; sellRatio?: string }[] } };
  if (d.retCode !== 0) throw new Error(`Bybit : ${d.retCode ?? '?'} ${d.retMsg ?? ''}`.trim());
  return (d.result?.list ?? []).flatMap((x) => {
    const ts = num(x.timestamp), b = num(x.buyRatio), s = num(x.sellRatio);
    return ts === null || b === null || !s ? [] : [{ ts_ms: ts, value: b / s, long_share: b }];
  });
}

/** Taux de financement en cours : Binance premiumIndex, OKX funding-rate, Bybit tickers. */
export function funding(exchange: 'binance' | 'okx' | 'bybit', body: string): CrowdPoint {
  const d = JSON.parse(body) as Record<string, unknown>;
  let ts: number | null = null, v: number | null = null;
  if (exchange === 'binance') { ts = num(d.time); v = num(d.lastFundingRate); }
  if (exchange === 'okx') {
    const x = ((d.data as Record<string, unknown>[] | undefined) ?? [])[0] ?? {};
    ts = num(x.ts); v = num(x.fundingRate);
  }
  if (exchange === 'bybit') {
    const x = (((d.result as { list?: Record<string, unknown>[] } | undefined)?.list) ?? [])[0] ?? {};
    ts = num(d.time); v = num(x.fundingRate);
  }
  if (ts === null || v === null) throw new Error(`${exchange} : financement illisible`);
  return { ts_ms: ts, value: v, long_share: null };
}
