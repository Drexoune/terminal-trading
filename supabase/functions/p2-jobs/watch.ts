// Tâche « watch » de p2-jobs (Markets Watch, décisions T-051 et T-052), lancée toutes les 3 min.
//
// - Tiingo, offre gratuite (50 requêtes par heure, usage personnel) : une requête pour le change
//   (EUR/USD, USD/JPY, XAU/USD) quand le marché des changes est ouvert (dimanche 17:00 au
//   vendredi 17:00, heure de New York), une pour QQQ et SPY (prix de référence IEX) les jours de
//   semaine de 04:00 à 20:00 à New York. Au plus 40 requêtes par heure.
// - FRED, sans clé : rendement US 10 ans (DGS10) et indice large du dollar de la Fed (DTWEXBGS),
//   relus au plus toutes les 6 h ; les 30 dernières observations sont gardées (une ligne par date).
// - Les cours de plus de 3 jours sont effacés (les séries du jour suffisent à l'écran).
// Rien n'est inventé : un champ absent de la réponse reste vide, une réponse illisible est un échec
// noté dans l'état du flux (feed:watch de p1_state, lu par l'écran).

import type { Rest, Row } from '../p1-jobs/rest.ts';

export const TIINGO = 'https://api.tiingo.com';
export const FRED = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
export const FX_TICKERS = ['eurusd', 'usdjpy', 'xauusd'] as const;
export const IEX_TICKERS = ['qqq', 'spy'] as const;
export const FRED_SERIES: Record<string, string> = { us10y: 'DGS10', 'usd-broad': 'DTWEXBGS' };
const NY = 'America/New_York';
const FRED_EVERY_MS = 6 * 3_600_000;
const KEEP_MS = 3 * 86_400_000;
const TIMEOUT_MS = 10_000;

export interface WatchDeps {
  fetch: (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;
  now: () => number;
  env: (name: string) => string | undefined;
  rest: Rest;
}

/** Marché des changes ouvert : du dimanche 17:00 au vendredi 17:00, heure de New York. */
export function fxOpen(ms: number): boolean {
  const { wd, mins } = nyClock(ms);
  if (wd === 6) return false;                 // samedi
  if (wd === 7) return mins >= 17 * 60;       // dimanche
  if (wd === 5) return mins < 17 * 60;        // vendredi
  return true;
}

/** Prix de référence IEX utile : jours de semaine, 04:00–20:00 à New York. */
export function iexWindow(ms: number): boolean {
  const { wd, mins } = nyClock(ms);
  return wd >= 1 && wd <= 5 && mins >= 4 * 60 && mins < 20 * 60;
}

const NY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const WD: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Jour (1 = lundi … 7 = dimanche) et minutes depuis minuit, à New York. */
export function nyClock(ms: number): { wd: number; mins: number } {
  const parts = Object.fromEntries(NY_FMT.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { wd: WD[parts.weekday] ?? 0, mins: Number(parts.hour) * 60 + Number(parts.minute) };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Réponse de /tiingo/fx/top -> lignes (milieu de fourchette, achat, vente, heure de la cotation). */
export function fxRows(body: string, recvIso: string): Row[] {
  const items = JSON.parse(body) as { ticker?: string; quoteTimestamp?: string; bidPrice?: number; askPrice?: number; midPrice?: number }[];
  return items.flatMap((x) => {
    const mid = num(x.midPrice);
    if (!x.ticker || mid === null || !x.quoteTimestamp) return [];
    return [{ asset: x.ticker.toLowerCase(), source: 'tiingo-fx', ts_source: x.quoteTimestamp, ts_recv: recvIso, price: mid,
      bid: num(x.bidPrice), ask: num(x.askPrice), prev_close: null }];
  });
}

/** Réponse de /iex/?tickers= -> lignes (prix de référence tngoLast, clôture de la veille). */
export function iexRows(body: string, recvIso: string): Row[] {
  const items = JSON.parse(body) as { ticker?: string; timestamp?: string; tngoLast?: number; prevClose?: number; bidPrice?: number; askPrice?: number }[];
  return items.flatMap((x) => {
    const last = num(x.tngoLast);
    if (!x.ticker || last === null || !x.timestamp) return [];
    return [{ asset: x.ticker.toLowerCase(), source: 'tiingo-iex', ts_source: x.timestamp, ts_recv: recvIso, price: last,
      bid: num(x.bidPrice), ask: num(x.askPrice), prev_close: num(x.prevClose) }];
  });
}

/** CSV de FRED -> n dernières observations chiffrées, de la plus ancienne à la plus récente (jours fériés vides ignorés). */
export function fredSeries(body: string, n = 30): [string, number][] {
  const out: [string, number][] = [];
  for (const line of body.trim().split(/\r?\n/).slice(1)) {
    const [d, v] = line.split(',');
    const x = Number(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v !== '' && v !== '.' && v !== undefined && Number.isFinite(x)) out.push([d, x]);
  }
  return out.slice(-n);
}

export const fredLast = (body: string): [string, number] | null => fredSeries(body, 1)[0] ?? null;

async function get(deps: WatchDeps, url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  const r = await deps.fetch(url, { headers: { 'User-Agent': 'TERMINAL/1.0 (terminal personnel)', Accept: 'application/json, text/csv', ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: r.status, body: await r.text() };
}

export async function runWatch(deps: WatchDeps): Promise<Record<string, unknown>> {
  const { rest } = deps;
  const now = deps.now();
  const recv = new Date(now).toISOString();
  const key = deps.env('TIINGO_API_KEY');
  const report: Record<string, unknown> = { job: 'watch', fx: 'fermé', iex: 'hors séance', fred: 'pas encore', rows: 0 };
  const problems: string[] = [];
  const rows: Row[] = [];
  const auth = key ? { Authorization: `Token ${key}` } : null;
  if (!auth) problems.push('TIINGO_API_KEY absente des secrets');
  if (auth && fxOpen(now)) {
    try {
      const r = await get(deps, `${TIINGO}/tiingo/fx/top?tickers=${FX_TICKERS.join(',')}`, auth);
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      const got = fxRows(r.body, recv);
      rows.push(...got);
      report.fx = `${got.length} cours`;
    } catch (e) { problems.push(`change : ${(e as Error).message}`.slice(0, 160)); report.fx = 'échec'; }
  }
  if (auth && iexWindow(now)) {
    try {
      const r = await get(deps, `${TIINGO}/iex/?tickers=${IEX_TICKERS.join(',')}`, auth);
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      const got = iexRows(r.body, recv);
      rows.push(...got);
      report.iex = `${got.length} cours`;
    } catch (e) { problems.push(`IEX : ${(e as Error).message}`.slice(0, 160)); report.iex = 'échec'; }
  }
  const lastFred = await rest.select<{ ts_recv: string }>('watch_quotes', { select: 'ts_recv', source: 'eq.fred', order: 'ts_recv.desc', limit: '1' });
  if (!lastFred.length || now - Date.parse(lastFred[0].ts_recv) >= FRED_EVERY_MS) {
    const got: string[] = [];
    for (const [asset, id] of Object.entries(FRED_SERIES)) {
      try {
        const r = await get(deps, `${FRED}?id=${id}`);
        if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
        // 30 dernières observations : série de l'écran et variation contre la précédente (déjà en base : ignorées).
        const obs = fredSeries(r.body, 30);
        if (!obs.length) throw new Error('aucune observation chiffrée');
        for (const [d, v] of obs) rows.push({ asset, source: 'fred', ts_source: `${d}T00:00:00Z`, ts_recv: recv, price: v, bid: null, ask: null, prev_close: null });
        got.push(`${asset} ${obs[obs.length - 1][0]}`);
      } catch (e) { problems.push(`FRED ${id} : ${(e as Error).message}`.slice(0, 160)); }
    }
    report.fred = got.join(', ') || 'échec';
  }
  if (rows.length) await rest.insertIgnore('watch_quotes', rows, 'asset,source,ts_source', 'asset');
  await rest.remove('watch_quotes', { source: 'neq.fred', ts_recv: `lt.${new Date(now - KEEP_MS).toISOString()}` });
  report.rows = rows.length;
  // État du flux pour la barre de flux et l'écran (même forme que feed:news, seuils de 6 et 15 min).
  await rest.upsert('p1_state', [{ key: 'feed:watch', updated_ms: now, value: {
    name: 'watch', label: 'Watchlist', late_after_ms: 6 * 60_000, stale_after_ms: 15 * 60_000,
    status: problems.length && !rows.length && (report.fx !== 'fermé' || report.iex !== 'hors séance') ? 'reconnecting' : 'connected',
    // Marchés fermés, rien à relever : la tâche a tourné, le flux reste vivant ; l'âge de chaque
    // cours est montré ligne par ligne à l'écran.
    connected_since_ms: null, last_message_ms: problems.length && !rows.length ? null : now, reconnects: 0, outages: [],
    last_error: problems.join(' ; ') || null, fx_open: fxOpen(now), iex_window: iexWindow(now) } }], 'key');
  return { ...report, ok: problems.length === 0, problems };
}
