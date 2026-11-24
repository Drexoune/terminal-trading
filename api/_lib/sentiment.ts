// /api/sentiment/* — P4 (sentiment et liquidité), lecture de l'état publié par l'Edge Function
// p4-jobs (p4_state) avec la clé secrète, côté serveur. Données publiques seulement. Chaque
// réponse porte l'état du flux (source, dernière réception, erreur) : porte de P4.
//
//   GET /api/sentiment/risk        indice de risque, 7 composantes, historique, SPY et VIX sur un an
//   GET /api/sentiment/cot         rapport TFF : positions nettes par catégorie, percentile sur 3 ans
//   GET /api/sentiment/banks       catégorie « dealers » du TFF (T-060) ; Bank Participation Report
//                                  s'il est relevé un jour (« — » avec la raison sinon)
//   GET /api/sentiment/crowding    ratios long/short et financement (Binance, OKX, Bybit)
//   GET /api/sentiment/liquidity   liquidité nette de la Fed
//   GET /api/sentiment/probe       sonde du Bank Participation Report depuis Vercel (T-060),
//                                  en-tête x-jobs-secret exigé

import { HttpError, json, NO_STORE, readQuery, respond, type Env } from './http.js';
import { sameSecret } from './macro.js';
import type { FetchFn } from './okx.js';
import type { Context } from './routes.js';
import { rest, supabaseConfig, type SupabaseConfig } from './supabase.js';

export const ROUTES = ['risk', 'cot', 'banks', 'crowding', 'liquidity'] as const;
type Route = (typeof ROUTES)[number];

/** Clés de p4_state lues par chaque route : état publié, flux, état des séries. */
const KEYS: Record<Route, { state: string; feed: string; series?: string[] }> = {
  risk: { state: 'risk', feed: 'feed:closes', series: ['VIX', 'VIX_FRED', 'HY_OAS', 'SPY', 'TLT', 'CPER', 'GLD', 'AUDJPY', 'BTC', 'ETH'] },
  cot: { state: 'cot', feed: 'feed:cot' },
  banks: { state: 'cot', feed: 'feed:cot' },
  crowding: { state: 'crowding', feed: 'feed:crowding' },
  liquidity: { state: 'liquidity', feed: 'feed:liquidity', series: ['WALCL', 'WDTGAL', 'RRP'] },
};

export const BPR_REASON_NONE = 'Bank Participation Report non relevé : la page de la CFTC refuse les serveurs de Supabase (décision T-060)';

interface StateRow { key: string; value: unknown; updated_ms: number }
interface CotMarket { code: string; label: string; group: string; date: string; open_interest: number;
  categories: Record<string, unknown>; history: { dates: string[]; net: Record<string, number[]> } }

export async function sentimentRoute(cfg: SupabaseConfig, fetchFn: FetchFn, now: number, route: Route) {
  const k = KEYS[route];
  const keys = [k.state, k.feed, ...(k.series ? ['series'] : []), ...(route === 'banks' ? ['bpr'] : [])];
  const { rows } = await rest(cfg, fetchFn, 'GET', 'p4_state',
    { select: 'key,value,updated_ms', key: `in.(${keys.map((x) => `"${x}"`).join(',')})` }, false);
  const by = new Map((rows as StateRow[]).map((r) => [r.key, r]));
  const state = by.get(k.state);
  const base = {
    configured: true, route, computed_ms: now,
    published_ms: state?.updated_ms ?? null,
    feed: by.get(k.feed)?.value ?? null,
    ...(k.series ? { series: pick((by.get('series')?.value ?? {}) as Record<string, unknown>, k.series) } : {}),
  };
  if (route !== 'banks') return { ...base, data: state?.value ?? null, reason: state ? null : 'pas encore calculé' };
  // Positions des banques : catégorie « dealers » du rapport TFF, sans les autres catégories.
  const cot = state?.value as { report_date?: string; markets?: CotMarket[] } | undefined;
  const dealers = (cot?.markets ?? []).map((m) => ({ code: m.code, label: m.label, group: m.group, date: m.date, open_interest: m.open_interest,
    dealer: m.categories.dealer ?? null, history: { dates: m.history.dates, net: m.history.net.dealer ?? [] } }));
  const bpr = by.get('bpr');
  return { ...base, data: cot ? { report_date: cot.report_date ?? null, label: 'Dealers (rapport TFF de la CFTC)', markets: dealers } : null,
    reason: cot ? null : 'pas encore calculé', bpr: bpr?.value ?? null, bpr_reason: bpr ? null : BPR_REASON_NONE };
}

const pick = (o: Record<string, unknown>, ids: string[]) => Object.fromEntries(ids.map((id) => [id, o[id] ?? null]));

// ---------------------------------------------------------------------------------------------
// Sonde du Bank Participation Report (T-060)

export const BPR_INDEX = 'https://www.cftc.gov/MarketReports/BankParticipationReports/index.htm';
export const BPR_PAGE = 'https://www.cftc.gov/MarketReports/BankParticipation/';
const UA = 'TERMINAL/1.0 (terminal personnel, lecture seule)';
const MIN_SECRET = 32;
const TIMEOUT_MS = 20_000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Pages « futures » de l'index (« deanov26f »), de la plus ancienne à la plus récente. */
export function bprFuturesPages(html: string): { month: string; page: string }[] {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/BankParticipation\/(dea([a-z]{3})(\d{2})f)\b/g)) {
    const i = MONTHS.indexOf(m[2]);
    if (i >= 0) out.set(`20${m[3]}-${String(i + 1).padStart(2, '0')}`, m[1]);
  }
  return [...out.entries()].sort().map(([month, page]) => ({ month, page }));
}

export interface BprRow { market: string; date: string; banks: number | null; long: number; long_pct: number; short: number; short_pct: number; open_interest: number }

const cells = (row: string) => [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)]
  .map((c) => c[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim());
const n = (s: string | undefined) => { const v = Number((s ?? '').replace(/,/g, '')); return s && Number.isFinite(v) ? v : null; };

/**
 * Tableau d'un mois : pour chaque marché, trois lignes (banques américaines, non américaines,
 * total). Seule la ligne totale est gardée ; nombre de banques absent sous 4 (confidentialité).
 */
export function bprRows(html: string): BprRow[] {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => cells(r[1]));
  const dm = /REPORT DATE:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(html);
  if (!dm) return [];
  const date = `${dm[3]}-${dm[1].padStart(2, '0')}-${dm[2].padStart(2, '0')}`;
  const out: BprRow[] = [];
  let market: string | null = null, oi: number | null = null;
  for (const c of rows) {
    // Première ligne d'un marché : nom, type de banque (« U.S. » ou « NON U.S. »), …, intérêt ouvert.
    if (c.length === 8 && c[0] && /U\.S\./.test(c[1] ?? '')) { market = c[0]; oi = n(c[7]); continue; }
    // Ligne totale : premier champ vide, puis nombre de banques et 4 nombres.
    if (market && oi !== null && c.length >= 6 && c[0] === '' && !/U\.S\./.test(c.join(' '))) {
      const [banks, l, lp, s, sp] = c.slice(1, 6).map(n);
      if (l !== null && lp !== null && s !== null && sp !== null) out.push({ market, date, banks, long: l, long_pct: lp, short: s, short_pct: sp, open_interest: oi });
      market = null; oi = null;
    }
  }
  return out;
}

export async function probeBpr(fetchFn: FetchFn, now: () => number) {
  const get = async (label: string, url: string) => {
    const t0 = now();
    try {
      const r = await fetchFn(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = await r.text();
      return { label, status: r.status, ms: now() - t0, size: body.length, body, challenge: /Just a moment/.test(body) };
    } catch (e) {
      return { label, status: null, ms: now() - t0, size: null, body: '', challenge: false, error: `${(e as Error).name} : ${(e as Error).message}`.slice(0, 160) };
    }
  };
  const index = await get('bpr-index', BPR_INDEX);
  const pages = index.status === 200 ? bprFuturesPages(index.body) : [];
  const latest = pages[pages.length - 1];
  const page = latest ? await get(`bpr-${latest.month}`, `${BPR_PAGE}${latest.page}`) : null;
  const rows = page?.status === 200 ? bprRows(page.body) : [];
  const strip = ({ body, ...rest }: { body: string } & Record<string, unknown>) => ({ ...rest, excerpt: rest.status === 200 ? undefined : body.slice(0, 80) });
  return {
    ok: index.status === 200 && rows.length > 0,
    region: (globalThis as { process?: { env?: Env } }).process?.env?.VERCEL_REGION ?? null,
    lines: [strip(index), ...(page ? [strip(page)] : [])],
    months: pages.slice(-3).map((p) => p.month),
    rows: rows.length,
    sample: rows.filter((r) => /EURO FX$|JAPANESE YEN|E-MINI S&P 500$|BITCOIN$/.test(r.market)),
  };
}

// ---------------------------------------------------------------------------------------------

export function handleSentiment(request: Request, ctx: Context): Promise<Response> {
  return respond(ctx.env, '/api/sentiment', async () => {
    if (request.method !== 'GET') throw new HttpError(405, 'méthode non autorisée : GET attendu');
    // Route lue dans le chemin (/api/sentiment/risk, serveur de développement) ou dans ?path=
    // (réécriture de vercel.json), comme le module Alertes.
    const q = readQuery(request, ['path']);
    const m = /^\/api\/sentiment\/([a-z]+)\/?$/.exec(new URL(request.url).pathname);
    const path = m ? m[1] : q.get('path') ?? '';
    const now = ctx.deps.now();
    if (path === 'probe') {
      const secret = ctx.env.P1_JOBS_SECRET?.trim() ?? '';
      if (secret.length < MIN_SECRET) throw new HttpError(503, 'P1_JOBS_SECRET absente des variables de Vercel');
      if (!(await sameSecret(request.headers.get('x-jobs-secret') ?? '', secret))) throw new HttpError(401, 'secret d’appel invalide');
      return json(await probeBpr(ctx.deps.fetch, ctx.deps.now), NO_STORE);
    }
    if (!(ROUTES as readonly string[]).includes(path)) {
      throw new HttpError(404, `route inconnue (attendues : ${ROUTES.map((r) => `/api/sentiment/${r}`).join(', ')})`);
    }
    const cfg = supabaseConfig(ctx.env);
    if (!cfg.ok) return json({ configured: false, route: path, reason: cfg.reason, data: null, feed: null, computed_ms: now }, NO_STORE);
    return json(await sentimentRoute(cfg.config, ctx.deps.fetch, now, path as Route), NO_STORE);
  });
}
