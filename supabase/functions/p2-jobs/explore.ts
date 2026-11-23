// Étape R0 du plan P2 (écran Taux) : sonde des sources de P2 DEPUIS Supabase, c'est-à-dire
// depuis les adresses IP qui feront la collecte. Rien n'est écrit en base. Une requête par
// source (blocage géographique, statut, délai, taille, en-têtes de limite de débit) :
//   - Polymarket Gamma (événement « décision » de la Fed) et CLOB (historique d'un marché) ;
//   - Kalshi (événements ouverts de KXFEDDECISION) ;
//   - BIS (dernier taux directeur des 8 banques) ;
//   - pages officielles : calendrier du FOMC, calendrier de la RBNZ (403 depuis le Mac).
// Module pur : réseau et horloges injectés, testé par Vitest.

export interface HeadersLike { get(name: string): string | null }
export interface ProbeResponse { status: number; headers: HeadersLike; text(): Promise<string> }
export type ProbeFetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<ProbeResponse>;

export interface ExploreDeps {
  fetch: ProbeFetch;
  now: () => number;
  perf: () => number;
  sleep: (ms: number) => Promise<void>;
  env: (name: string) => string | undefined;
}

export const GAMMA = 'https://gamma-api.polymarket.com';
export const CLOB = 'https://clob.polymarket.com';
export const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
export const BIS = 'https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0';
export const UA = 'TERMINAL/0.1 (terminal personnel, lecture seule)';
const TIMEOUT_MS = 10_000;
const KEPT = ['date', 'content-type', 'cache-control', 'age', 'server', 'cf-cache-status', 'cf-ray', 'x-ratelimit-limit',
  'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-cost', 'retry-after'];

export interface ProbeLine {
  label: string; url: string; status: number | null; ms_headers: number | null; ms_total: number | null; size: number | null;
  headers: Record<string, string>; extract: unknown; error?: string;
}

async function probe(deps: ExploreDeps, label: string, url: string, read: (body: string) => unknown = () => null): Promise<ProbeLine> {
  const t0 = deps.perf();
  try {
    const r = await deps.fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const t1 = deps.perf();
    const body = await r.text();
    const headers: Record<string, string> = {};
    for (const k of KEPT) { const v = r.headers.get(k); if (v !== null) headers[k] = v.slice(0, 120); }
    let extract: unknown = null;
    if (r.status === 200) {
      try { extract = read(body); } catch (e) { extract = { error: `lecture : ${(e as Error).message}`.slice(0, 160) }; }
    }
    return { label, url, status: r.status, ms_headers: Math.round(t1 - t0), ms_total: Math.round(deps.perf() - t0), size: body.length, headers, extract };
  } catch (e) {
    return { label, url, status: null, ms_headers: null, ms_total: Math.round(deps.perf() - t0), size: null, headers: {}, extract: null,
      error: `${(e as Error).name} : ${(e as Error).message}`.slice(0, 200) };
  }
}

/** Prochaine décision de la Fed chez Polymarket : identifiant du premier marché et prix. */
export function readGammaEvents(body: string): unknown {
  const evs = JSON.parse(body) as { slug: string; title: string; endDate?: string; markets?: { groupItemTitle?: string; bestBid?: number; bestAsk?: number; clobTokenIds?: string }[] }[];
  const e = evs[0];
  if (!e) return { events: 0 };
  return { events: evs.length, slug: e.slug, end: e.endDate ?? null,
    markets: (e.markets ?? []).map((m) => ({ outcome: m.groupItemTitle ?? null, bid: m.bestBid ?? null, ask: m.bestAsk ?? null })),
    token: (JSON.parse(e.markets?.[0]?.clobTokenIds ?? '[]') as string[])[0] ?? null };
}

export function readKalshiEvents(body: string): unknown {
  const d = JSON.parse(body) as { events?: { event_ticker: string; sub_title?: string; markets?: { ticker: string; yes_bid_dollars?: string; yes_ask_dollars?: string }[] }[] };
  return (d.events ?? []).slice(0, 2).map((e) => ({ event: e.event_ticker, sub: e.sub_title ?? null,
    markets: (e.markets ?? []).map((m) => [m.ticker, m.yes_bid_dollars ?? null, m.yes_ask_dollars ?? null]) }));
}

/** CSV SDMX du BIS : dernier taux par zone. */
export function readBisCsv(body: string): Record<string, [string, number]> {
  const [head, ...rows] = body.trim().split(/\r?\n/);
  const cols = head.split(',');
  const area = cols.indexOf('REF_AREA');
  const out: Record<string, [string, number]> = {};
  for (const line of rows) {
    // Les champs entre guillemets peuvent contenir des virgules : on lit la fin de ligne.
    const m = /,(\d{4}-\d{2}-\d{2}),(-?\d+(?:\.\d+)?),[A-Z]?,[A-Z]?,[^,]*$/.exec(line);
    const code = line.split(',')[area];
    if (m && code) out[code] = [m[1], Number(m[2])];
  }
  return out;
}

export async function explore(deps: ExploreDeps): Promise<Record<string, unknown>> {
  const started = deps.now();
  const lines: ProbeLine[] = [];
  const gamma = await probe(deps, 'polymarket-gamma', `${GAMMA}/events?slug=fed-decision-in-december-20260729232808632`, readGammaEvents);
  lines.push(gamma);
  const token = (gamma.extract as { token?: string } | null)?.token;
  if (token) {
    const end = Math.floor(deps.now() / 1000);
    lines.push(await probe(deps, 'polymarket-clob-history', `${CLOB}/prices-history?market=${token}&startTs=${end - 86400}&endTs=${end}&fidelity=60`,
      (b) => ({ points: (JSON.parse(b) as { history?: unknown[] }).history?.length ?? 0 })));
  }
  lines.push(await probe(deps, 'kalshi-events', `${KALSHI}/events?series_ticker=KXFEDDECISION&status=open&with_nested_markets=true&limit=2`, readKalshiEvents));
  lines.push(await probe(deps, 'bis-cbpol', `${BIS}/D.US+XM+GB+JP+CH+CA+AU+NZ?lastNObservations=1&format=csv`, readBisCsv));
  lines.push(await probe(deps, 'fed-calendar', 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
    (b) => ({ has_2027: b.includes('2027 FOMC Meetings') })));
  lines.push(await probe(deps, 'rbnz-calendar',
    'https://www.rbnz.govt.nz/monetary-policy/about-monetary-policy/monetary-policy-statements-and-official-cash-rate-dates'));
  return { job: 'explore', ok: lines.every((l) => l.status === 200 || l.label === 'rbnz-calendar'), started_ms: started, ms: deps.now() - started,
    region: deps.env('SB_REGION') ?? null, lines };
}
