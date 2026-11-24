// Tâche « candles » de bt-jobs (section Backtest, T-061, T-062) : bougies servies au moteur.
//
// - OKX (BTC/USDT, ETH/USDT) : quotidien depuis 2018 (l'historique d'OKX commence en mars 2018),
//   horaire depuis 2021 ; le 4 h est agrégé depuis l'horaire à la lecture (bt_candles_cols).
//   Reprise : chaque passage lit d'abord les bougies récentes, puis remonte l'historique d'au plus
//   PAGE_BUDGET pages (100 bougies par page) ; la série est « complète » quand OKX ne rend plus rien.
// - Tiingo (QQQ, SPY) : OHLC quotidien ajusté des dividendes depuis 1999, relu en entier au plus une
//   fois toutes les 20 h (un appel par titre : les cours ajustés changent après chaque dividende).
// Seules les bougies closes sont gardées. Rien n'est inventé : une série en échec garde ses lignes
// et porte l'erreur dans bt_state (« series », « feed:candles »).

import type { Json, Rest, Row } from '../p1-jobs/rest.ts';

export type HttpFetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) =>
  Promise<{ status: number; text(): Promise<string> }>;
export interface CandleDeps {
  fetch: HttpFetch; now: () => number; rest: Rest; env: (n: string) => string | undefined; sleep?: (ms: number) => Promise<void>;
  pageBudget?: number;   // PAGE_BUDGET par défaut (réduit en test)
}

export interface Bar { ts: number; open: number; high: number; low: number; close: number; volume: number | null }
export interface SeriesSpec { asset: string; tf: '1D' | '1H'; source: 'okx' | 'tiingo'; code: string; start: string; label: string }

export const OKX = 'https://www.okx.com';
export const TIINGO = 'https://api.tiingo.com';
export const PAGE_BUDGET = 120;          // pages OKX par passage, toutes séries confondues
const OKX_GAP_MS = 120;                  // history-candles : 20 requêtes par 2 s au plus
const UA = 'TERMINAL/1.0 (terminal personnel, lecture seule)';
const TIMEOUT_MS = 30_000;
const DAY = 86_400_000;
export const TIINGO_EVERY_MS = 20 * 3_600_000;

export const SERIES: SeriesSpec[] = [
  { asset: 'BTC', tf: '1D', source: 'okx', code: 'BTC-USDT', start: '2018-01-01', label: 'BTC/USDT (OKX)' },
  { asset: 'ETH', tf: '1D', source: 'okx', code: 'ETH-USDT', start: '2018-01-01', label: 'ETH/USDT (OKX)' },
  { asset: 'BTC', tf: '1H', source: 'okx', code: 'BTC-USDT', start: '2021-01-01', label: 'BTC/USDT (OKX)' },
  { asset: 'ETH', tf: '1H', source: 'okx', code: 'ETH-USDT', start: '2021-01-01', label: 'ETH/USDT (OKX)' },
  { asset: 'QQQ', tf: '1D', source: 'tiingo', code: 'QQQ', start: '1999-03-10', label: 'QQQ, substitut du Nasdaq 100 (Tiingo, ajusté)' },
  { asset: 'SPY', tf: '1D', source: 'tiingo', code: 'SPY', start: '1999-01-01', label: 'SPY, substitut du S&P 500 (Tiingo, ajusté)' },
];

const num = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '') return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
};

/** OKX history-candles : [ts, o, h, l, c, vol, …, confirm], la plus récente en tête ; bougie en cours exclue. */
export function okxBars(body: string): { bars: Bar[]; raw: number } {
  const d = JSON.parse(body) as { code?: string; msg?: string; data?: string[][] };
  if (d.code !== '0') throw new Error(`OKX : code ${d.code ?? '?'} ${d.msg ?? ''}`.trim());
  const bars: Bar[] = [];
  for (const c of d.data ?? []) {
    const [ts, o, h, l, cl] = [num(c[0]), num(c[1]), num(c[2]), num(c[3]), num(c[4])];
    if (ts === null || o === null || h === null || l === null || cl === null || c[8] !== '1') continue;
    bars.push({ ts, open: o, high: h, low: l, close: cl, volume: num(c[5]) });
  }
  return { bars: bars.sort((a, b) => a.ts - b.ts), raw: d.data?.length ?? 0 };
}

/** Tiingo /tiingo/daily/<t>/prices : OHLC ajusté (adjOpen…), date de séance à minuit UTC. */
export function tiingoBars(body: string): Bar[] {
  const d = JSON.parse(body) as Record<string, unknown>[] | { detail?: string };
  if (!Array.isArray(d)) throw new Error(`Tiingo : ${(d as { detail?: string }).detail ?? 'liste attendue'}`.slice(0, 160));
  const bars: Bar[] = [];
  for (const x of d) {
    const ts = typeof x.date === 'string' ? Date.parse(`${x.date.slice(0, 10)}T00:00:00Z`) : NaN;
    const [o, h, l, c] = [num(x.adjOpen), num(x.adjHigh), num(x.adjLow), num(x.adjClose)];
    if (!Number.isFinite(ts) || o === null || h === null || l === null || c === null) continue;
    bars.push({ ts, open: o, high: h, low: l, close: c, volume: num(x.adjVolume) });
  }
  if (!bars.length) throw new Error('Tiingo : aucune bougie lisible');
  return bars.sort((a, b) => a.ts - b.ts);
}

async function get(deps: CandleDeps, url: string, headers: Record<string, string> = {}): Promise<string> {
  const r = await deps.fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await r.text();
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return body;
}

const toRows = (s: SeriesSpec, bars: Bar[], recv: string): Row[] => bars.map((b) => ({
  asset: s.asset, tf: s.tf, ts: new Date(b.ts).toISOString(), open: b.open, high: b.high, low: b.low, close: b.close,
  volume: b.volume, source: s.source, ts_recv: recv,
}));

async function save(rest: Rest, rows: Row[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 1000) await rest.upsert('bt_candles', rows.slice(i, i + 1000), 'asset,tf,ts');
}

async function edge(rest: Rest, s: SeriesSpec, dir: 'asc' | 'desc'): Promise<number | null> {
  const r = await rest.select<{ ts: string }>('bt_candles', { select: 'ts', asset: `eq.${s.asset}`, tf: `eq.${s.tf}`, order: `ts.${dir}`, limit: '1' });
  return r[0] ? Date.parse(r[0].ts) : null;
}

interface SeriesState { label: string; source: string; first: string | null; last: string | null; complete: boolean; last_ok_ms?: number; error: string | null; pages?: number }

/** Une série OKX : récent d'abord, puis remontée de l'historique dans le budget de pages. */
async function okxSeries(deps: CandleDeps, s: SeriesSpec, budget: { pages: number }, recv: string, prev: SeriesState | undefined) {
  const bar = s.tf === '1D' ? '1Dutc' : '1H';
  const page = async (after: number | null) => {
    budget.pages--;
    await deps.sleep?.(OKX_GAP_MS);
    return okxBars(await get(deps, `${OKX}/api/v5/market/history-candles?instId=${s.code}&bar=${bar}&limit=100${after ? `&after=${after}` : ''}`));
  };
  const newest = await edge(deps.rest, s, 'desc');
  // Récent : pages jusqu'à rejoindre la dernière bougie connue.
  let after: number | null = null;
  while (budget.pages > 0) {
    const { bars, raw } = await page(after);
    if (bars.length) await save(deps.rest, toRows(s, bars, recv));
    if (!raw || !bars.length || newest === null || bars[0].ts <= newest) break;
    after = bars[0].ts;
  }
  // Historique : remontée depuis la plus ancienne bougie connue.
  const start = Date.parse(`${s.start}T00:00:00Z`);
  let complete = prev?.complete ?? false;
  let oldest = await edge(deps.rest, s, 'asc');
  while (!complete && oldest !== null && oldest > start && budget.pages > 0) {
    const { bars, raw } = await page(oldest);
    if (!raw) { complete = true; break; }   // OKX n'a rien de plus ancien
    if (bars.length) await save(deps.rest, toRows(s, bars, recv));
    oldest = bars.length ? bars[0].ts : oldest - 100 * (s.tf === '1D' ? DAY : 3_600_000);
  }
  if (oldest !== null && oldest <= start) complete = true;
  return { oldest, complete };
}

export async function runCandles(deps: CandleDeps): Promise<Record<string, unknown>> {
  const { rest } = deps;
  const now = deps.now();
  const recv = new Date(now).toISOString();
  const budget = { pages: deps.pageBudget ?? PAGE_BUDGET };
  const problems: string[] = [];
  const prevAll = (await rest.select<{ value: Record<string, SeriesState> }>('bt_state', { select: 'value', key: 'eq.series' }))[0]?.value ?? {};
  const states: Record<string, SeriesState> = { ...prevAll };
  let ok = 0;
  for (const s of SERIES) {
    const key = `${s.asset}:${s.tf}`;
    const prev = prevAll[key];
    try {
      let complete = true;
      if (s.source === 'okx') ({ complete } = await okxSeries(deps, s, budget, recv, prev));
      else if (prev?.last_ok_ms && !prev.error && now - prev.last_ok_ms < TIINGO_EVERY_MS) {
        ok++;   // quotidien : relu au plus une fois toutes les 20 h (budget Tiingo de 50 requêtes par heure)
        continue;
      } else {
        const k = deps.env('TIINGO_API_KEY');
        if (!k) throw new Error('TIINGO_API_KEY absente des secrets');
        try {
          await save(rest, toRows(s, tiingoBars(await get(deps, `${TIINGO}/tiingo/daily/${s.code}/prices?startDate=${s.start}`, { Authorization: `Token ${k}` })), recv));
        } catch (e) { throw new Error(String((e as Error).message).split(k).join('<clé>')); }
        await deps.sleep?.(1000);
      }
      const [first, last] = [await edge(rest, s, 'asc'), await edge(rest, s, 'desc')];
      states[key] = { label: s.label, source: s.source, first: first ? new Date(first).toISOString() : null, last: last ? new Date(last).toISOString() : null,
        complete, last_ok_ms: now, error: null };
      ok++;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 160);
      problems.push(`${key} : ${msg}`);
      states[key] = { ...(prev ?? { label: s.label, source: s.source, first: null, last: null, complete: false }), error: msg };
    }
  }
  await rest.upsert('bt_state', [
    { key: 'series', updated_ms: now, value: states as unknown as Json },
    { key: 'feed:candles', updated_ms: now, value: {
      name: 'bt-candles', label: 'Bougies du backtest (OKX, Tiingo)', late_after_ms: 2 * 3_600_000, stale_after_ms: 30 * 3_600_000,
      status: problems.length && !ok ? 'reconnecting' : 'connected', connected_since_ms: null, last_message_ms: ok ? now : null,
      reconnects: 0, outages: [], last_error: problems.join(' ; ').slice(0, 500) || null,
    } as unknown as Json },
  ], 'key');
  return { job: 'candles', ok: problems.length === 0, pages_left: budget.pages, series: states, problems };
}
