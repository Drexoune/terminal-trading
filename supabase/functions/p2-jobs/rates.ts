// Tâches de l'écran Taux (plan P2, étape R1), lancées par pg_cron (supabase/cron-p2.sql) :
//
//   rates          chaque minute : découverte Polymarket (Gamma, toutes les 15 min), carnets et
//                  derniers échanges (CLOB, 2 requêtes), décisions Kalshi (5 séries) et KXFED,
//                  état de l'écran (p2_state « rates:state »), instantané dans rate_quotes ;
//   rates-history  chaque jour : historique 60 jours de la prochaine réunion de chaque banque
//                  (CLOB prices-history, bougies Kalshi), complété depuis le dernier point ;
//   policy         chaque jour : taux directeurs du BIS (WS_CBPOL), dernier mouvement.
//
// Rien n'est inventé : une source sans marché porte sa raison, une issue sans prix reste absente.
// Les futures n'ont pas de source gratuite (« — » partout, plan § Probabilités de taux).

import { civilDate } from '../p1-jobs/calendar.ts';
import type { Json, Rest, Row } from '../p1-jobs/rest.ts';
import { fireRateGapAlerts, type AlertDeps, type RateGap } from '../p1-jobs/alerts.ts';
import { BANKS, CALENDARS, type Bank } from './meetings.ts';
import {
  daysUntil, distribution, expectedChangeBp, expectedUpperBound, maxGap, pathFromChanges, pathFromLevels,
  OUTCOME_LABEL, upcomingMeetings, type Outcome, type PathPoint, type Quote,
} from './rates_rules.ts';
import {
  BIS, BIS_AREA, bisSeries, CLOB, GAMMA, KALSHI, KALSHI_FED_PATH, KALSHI_NONE, KALSHI_SERIES, kalshiCandles, kalshiDecisions,
  kalshiFedLevels, PM_SEARCH, pmBooks, pmEvents, pmHistory, pmLastTrades, pmQuote, policyFromSeries,
  type KDecision, type PmOutcome, type PolicyRate,
} from './sources.ts';

export type HttpFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ status: number; text(): Promise<string> }>;

export interface RatesDeps {
  fetch: HttpFetch; now: () => number; rest: Rest;
  /** Moteur d'alertes (règles rate_gap, R5) ; absent en test, rien n'est alors évalué. */
  alerts?: AlertDeps;
}

const UA = 'TERMINAL/1.0 (terminal personnel, lecture seule)';
const TIMEOUT_MS = 12_000;
const MIN = 60_000;
const DAY = 86_400_000;
export const DISCOVERY_EVERY_MS = 15 * MIN;
export const MEETINGS_SHOWN = 3;                 // réunions détaillées par banque (prochaine + 2)
export const MINUTE_ROWS_KEEP_MS = 3 * DAY;      // lignes de chaque minute ; la minute 0 de chaque heure est gardée
export const HISTORY_DAYS = 60;
const SOURCE_NAME: Record<string, string> = { polymarket: 'Polymarket', kalshi: 'Kalshi' };
export const FUTURES_NONE = 'aucun flux gratuit de futures de taux (calcul prévu en P7 ou FedWatch payant)';

/** Libellé du taux affiché par banque (taux publié par le BIS, WS_CBPOL). */
export const RATE_LABEL: Record<Bank, string> = {
  FED: 'Fourchette des fed funds', BCE: 'Facilité de dépôt', BOE: 'Bank Rate', BOJ: 'Taux cible au jour le jour',
  BNS: 'Taux directeur BNS', BOC: 'Taux cible du financement à un jour', RBA: 'Taux cible du cash', RBNZ: 'OCR',
};

async function http(deps: RatesDeps, url: string, body?: unknown): Promise<string> {
  const r = await deps.fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'User-Agent': UA, Accept: 'application/json, text/csv', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await r.text();
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return text;
}

const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 160);

async function getState<T>(rest: Rest, key: string): Promise<T | null> {
  const rows = await rest.select<{ value: T }>('p2_state', { select: 'value', key: `eq.${key}`, limit: '1' });
  return rows[0]?.value ?? null;
}

function feed(name: string, label: string, now: number, ok: boolean, error: string | null, lateMs: number, staleMs: number, last: number | null): Row {
  return { name, label, late_after_ms: lateMs, stale_after_ms: staleMs, status: ok ? 'connected' : 'reconnecting',
    connected_since_ms: null, last_message_ms: ok ? now : last, reconnects: 0, outages: [], last_error: error };
}

async function setStates(rest: Rest, now: number, entries: Record<string, unknown>): Promise<void> {
  await rest.upsert('p2_state', Object.entries(entries).map(([key, value]) => ({ key, value: value as Json, updated_ms: now })), 'key');
}

/** Limite le nombre de requêtes simultanées vers une même source. */
async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await f(items[k]); }
  }));
  return out;
}

// --- Découverte Polymarket -------------------------------------------------------------------

interface MarketRow { bank: Bank; meeting: string; event_id: string; title: string; end_date: string | null;
  outcomes: Partial<Record<Outcome, PmOutcome>>; ts_recv: string }

export async function discoverPolymarket(deps: RatesDeps, now: number): Promise<{ found: number; unmatched: string[]; problems: string[] }> {
  const problems: string[] = [], unmatched: string[] = [];
  const rows: Row[] = [];
  await pool(BANKS, 4, async (bank) => {
    try {
      const q = new URLSearchParams({ q: PM_SEARCH[bank].q, limit_per_type: '20', events_status: 'active' });
      const evs = pmEvents(bank, await http(deps, `${GAMMA}/public-search?${q}`));
      const upcoming = upcomingMeetings(bank, now).slice(0, MEETINGS_SHOWN);
      for (const e of evs) {
        if (!e.meeting) { unmatched.push(`${bank} : ${e.title} (fin ${e.end_date ?? '?'})`); continue; }
        if (!upcoming.includes(e.meeting)) continue;
        rows.push({ source: 'polymarket', bank, meeting: e.meeting, event_id: e.event_id, title: e.title, end_date: e.end_date,
          outcomes: e.outcomes as unknown as Json, ts_recv: new Date(now).toISOString() });
      }
    } catch (e) { problems.push(`Gamma ${bank} : ${errText(e)}`); }
  });
  if (rows.length) await deps.rest.upsert('rate_markets', rows, 'source,bank,meeting');
  // Réunions passées : leur marché n'est plus suivi.
  await deps.rest.remove('rate_markets', { meeting: `lt.${civilDate(now - 2 * DAY, 'UTC')}` });
  return { found: rows.length, unmatched, problems };
}

// --- Tâche de chaque minute ------------------------------------------------------------------

interface SourceBlock { probs?: Partial<Record<Outcome, Quote>>; total?: number | null; sum_ok?: boolean | null; expected_bp?: number | null;
  ts_source?: number | null; ts_recv?: number; ref?: string; title?: string; missing?: string }

export interface PolicyState { [bank: string]: PolicyRate & { ts_recv: number } }

function policyView(bank: Bank, p: (PolicyRate & { ts_recv: number }) | undefined) {
  if (!p) return { missing: 'taux du BIS pas encore relevé (tâche policy)' };
  const label = RATE_LABEL[bank];
  if (bank === 'FED') {
    // Le BIS publie le milieu de la fourchette (pas de 25 pb) : bornes et borne haute en découlent.
    const lo = Math.round((p.rate - 0.125) * 1000) / 1000, hi = Math.round((p.rate + 0.125) * 1000) / 1000;
    return { ...p, label, display: hi, range: [lo, hi], basis: 'milieu publié par le BIS ± 12,5 pb' };
  }
  return { ...p, label, display: p.rate, range: null, basis: null };
}

export async function runRates(deps: RatesDeps): Promise<Record<string, unknown>> {
  const { rest } = deps;
  const now = deps.now();
  const minute = Math.floor(now / MIN) * MIN;
  const recvIso = new Date(now).toISOString();
  const problems: string[] = [];
  const report: Record<string, unknown> = { job: 'rates', minute: new Date(minute).toISOString() };

  // 1. Découverte (toutes les 15 min, ou s'il manque une prochaine réunion).
  const lastDisc = await getState<{ ms: number; unmatched: string[] }>(rest, 'pm:discovery');
  let markets = await rest.select<MarketRow>('rate_markets', { select: 'bank,meeting,event_id,title,end_date,outcomes,ts_recv', source: 'eq.polymarket' });
  const nextOf = Object.fromEntries(BANKS.map((b) => [b, upcomingMeetings(b, now)[0] ?? null])) as Record<Bank, string | null>;
  const missingNext = BANKS.some((b) => nextOf[b] && !markets.some((m) => m.bank === b && m.meeting === nextOf[b]));
  let unmatched = lastDisc?.unmatched ?? [];
  if (!lastDisc || now - lastDisc.ms >= DISCOVERY_EVERY_MS || (missingNext && now - lastDisc.ms >= 5 * MIN)) {
    const d = await discoverPolymarket(deps, now);
    problems.push(...d.problems);
    unmatched = d.unmatched;
    await setStates(rest, now, { 'pm:discovery': { ms: now, found: d.found, unmatched, problems: d.problems } });
    markets = await rest.select<MarketRow>('rate_markets', { select: 'bank,meeting,event_id,title,end_date,outcomes,ts_recv', source: 'eq.polymarket' });
    report.discovery = d.found;
  }

  // 2. Polymarket : carnets et derniers échanges de toutes les issues suivies (2 requêtes).
  const tokens = [...new Set(markets.flatMap((m) => Object.values(m.outcomes).map((o) => o!.token)))];
  let books = new Map<string, { bid: number | null; ask: number | null; ts: number | null }>();
  let last = new Map<string, number>();
  let pmOk = tokens.length > 0;
  let pmError: string | null = tokens.length ? null : 'aucun marché découvert';
  if (tokens.length) {
    try {
      for (let i = 0; i < tokens.length; i += 100) {
        const part = pmBooks(await http(deps, `${CLOB}/books`, tokens.slice(i, i + 100).map((t) => ({ token_id: t }))));
        books = new Map([...books, ...part]);
      }
      last = pmLastTrades(await http(deps, `${CLOB}/last-trades-prices`, tokens.slice(0, 500).map((t) => ({ token_id: t }))));
    } catch (e) { pmOk = false; pmError = `CLOB : ${errText(e)}`; problems.push(pmError); }
  }

  // 3. Kalshi : décisions des 5 banques cotées et trajectoire de la Fed (KXFED).
  const kalshi = new Map<Bank, KDecision[]>();
  const kErrors: string[] = [];
  await pool(Object.entries(KALSHI_SERIES) as [Bank, string][], 3, async ([bank, series]) => {
    try {
      const q = new URLSearchParams({ series_ticker: series, status: 'open', with_nested_markets: 'true', limit: '12' });
      kalshi.set(bank, kalshiDecisions(bank, await http(deps, `${KALSHI}/events?${q}`)));
    } catch (e) { kErrors.push(`${series} : ${errText(e)}`); }
  });
  let fedLevels: ReturnType<typeof kalshiFedLevels> | null = null;
  try {
    const q = new URLSearchParams({ series_ticker: KALSHI_FED_PATH, status: 'open', with_nested_markets: 'true', limit: '12' });
    fedLevels = kalshiFedLevels(await http(deps, `${KALSHI}/events?${q}`));
  } catch (e) { kErrors.push(`${KALSHI_FED_PATH} : ${errText(e)}`); }
  problems.push(...kErrors.map((x) => `Kalshi ${x}`));

  // 4. Taux actuels (tâche policy).
  const policy = (await getState<PolicyState>(rest, 'policy:all')) ?? {};

  // 5. État de chaque banque et lignes de l'instantané.
  const quoteRows: Row[] = [];
  const banks: Record<string, unknown> = {};
  const writeAll = Math.floor(minute / MIN) % 15 === 0;
  for (const bank of BANKS) {
    const cal = CALENDARS[bank];
    const upcoming = upcomingMeetings(bank, now).slice(0, Math.max(MEETINGS_SHOWN, 10));
    const pol = policyView(bank, policy[bank]);
    const meetings = upcoming.slice(0, MEETINGS_SHOWN).map((date, idx) => {
      const sources: Record<string, SourceBlock> = {};
      const mk = markets.find((m) => m.bank === bank && m.meeting === date);
      if (!mk) sources.polymarket = { missing: 'marché non coté chez Polymarket' };
      else if (!pmOk) sources.polymarket = { missing: `Polymarket indisponible (${pmError})` };
      else {
        const q = pmQuote(mk.outcomes, books, last);
        const d = distribution(q.probs);
        sources.polymarket = Object.keys(q.probs).length
          ? { probs: q.probs, total: d.total, sum_ok: d.sum_ok, expected_bp: expectedChangeBp(q.probs), ts_source: q.ts_source, ts_recv: now,
            ref: mk.event_id, title: mk.title }
          : { missing: 'aucun prix dans les carnets' };
      }
      if (!KALSHI_SERIES[bank]) sources.kalshi = { missing: KALSHI_NONE };
      else if (!kalshi.has(bank)) sources.kalshi = { missing: 'Kalshi indisponible' };
      else {
        const k = kalshi.get(bank)!.find((x) => x.meeting === date);
        if (!k) sources.kalshi = { missing: 'marché non coté chez Kalshi pour cette réunion' };
        else {
          const d = distribution(k.probs);
          sources.kalshi = { probs: k.probs, total: d.total, sum_ok: d.sum_ok, expected_bp: expectedChangeBp(k.probs), ts_source: null, ts_recv: now,
            ref: k.event_ticker, title: k.title };
        }
      }
      sources.futures = { missing: FUTURES_NONE };
      for (const src of ['polymarket', 'kalshi'] as const) {
        const b = sources[src];
        if (!b.probs || (idx > 0 && !writeAll)) continue;
        quoteRows.push({ ts: new Date(minute).toISOString(), source: src, bank, meeting: date, probs: b.probs as unknown as Json, total: b.total ?? null,
          ts_source: b.ts_source ? new Date(b.ts_source).toISOString() : null, ts_recv: recvIso });
      }
      const priced = Object.fromEntries(Object.entries(sources).filter(([, b]) => b.probs).map(([s, b]) => [s, b.probs!]));
      return { date, days: daysUntil(bank, date, now), sources, gap: idx === 0 ? maxGap(priced) : null };
    });

    // Trajectoire implicite.
    let path: Record<string, unknown>;
    const base = 'display' in pol ? pol.display as number : null;
    if (base === null) path = { missing: 'taux actuel absent (BIS)' };
    else {
      let points: PathPoint[] = [];
      let source = 'polymarket';
      let note = 'taux actuel + variations attendues cumulées (Σ probabilité × variation ; « 50 pb et plus » compté 50 pb)';
      let truncated = false;
      if (bank === 'FED' && fedLevels) {
        const levels = fedLevels.filter((l) => l.meeting && upcoming.includes(l.meeting)).flatMap((l) => {
          const e = expectedUpperBound(l.strikes);
          if (!e) return [];
          truncated ||= e.truncated;
          return [{ meeting: l.meeting!, rate: e.rate }];
        });
        if (levels.length) {
          points = pathFromLevels(base, levels);
          source = 'kalshi';
          note = 'borne haute attendue = K0 + Σ 0,25 × P(borne haute > K), marchés KXFED de Kalshi';
        }
      }
      if (!points.length) {
        points = pathFromChanges(base, meetings.map((m) => ({ meeting: m.date, delta_bp: m.sources.polymarket.expected_bp ?? null })));
      }
      path = points.length ? { source, base, points, end: points[points.length - 1].rate, note, truncated }
        : { missing: 'aucune réunion cotée' };
    }
    banks[bank] = {
      bank, name: cal.name, currency: cal.currency, tz: cal.tz, time: cal.time,
      calendar: { source: cal.source, url: cal.url, read_on: cal.read_on, until: cal.until, note: cal.note ?? null },
      policy: pol, next: meetings[0] ?? null, meetings, path,
    };
  }

  if (quoteRows.length) await rest.insertIgnore('rate_quotes', quoteRows, 'source,bank,meeting,ts', 'bank');
  // Alerte d'écart entre sources (R5) : prochaine réunion de chaque banque cotée par deux sources.
  if (deps.alerts) {
    const gaps: RateGap[] = [];
    for (const [bank, st] of Object.entries(banks) as [string, { meetings: { date: string; gap: ReturnType<typeof maxGap>;
      sources: Record<string, SourceBlock> }[] }][]) {
      const m = st.meetings[0];
      if (!m?.gap) continue;
      const [a, b] = m.gap.sources;
      const val = (src: string) => ((m.sources[src].probs?.[m.gap!.outcome]?.p ?? 0) * 100).toFixed(2);
      gaps.push({ bank, meeting: m.date, pts: m.gap.pts.toFixed(1), outcome: OUTCOME_LABEL[m.gap.outcome],
        sources: [SOURCE_NAME[a] ?? a, SOURCE_NAME[b] ?? b], values: [val(a), val(b)] });
    }
    try {
      report.gap_alerts = await fireRateGapAlerts(deps.alerts, gaps);
    } catch (e) { problems.push(`alertes d'écart : ${errText(e)}`); }
  }
  const kOk = kErrors.length === 0;
  await setStates(rest, now, {
    'rates:state': { computed_ms: now, minute_ms: minute, banks, unmatched } as unknown as Json,
    'feed:polymarket': feed('polymarket', 'Polymarket', now, pmOk, pmError, 3 * MIN, 5 * MIN, null),
    'feed:kalshi': feed('kalshi', 'Kalshi', now, kOk, kErrors.join(' ; ') || null, 3 * MIN, 5 * MIN, null),
  });
  // Ménage une fois par heure : les lignes de chaque minute de plus de 3 jours (la minute 0 reste).
  if (new Date(minute).getUTCMinutes() === 7) {
    await rest.remove('rate_quotes', { hourly: 'is.false', ts: `lt.${new Date(now - MINUTE_ROWS_KEEP_MS).toISOString()}` });
  }
  return { ...report, ok: problems.length === 0, rows: quoteRows.length, tokens: tokens.length, problems };
}

// --- Historique 60 jours ---------------------------------------------------------------------

async function lastHistoryT(rest: Rest, source: string, bank: Bank, meeting: string): Promise<number | null> {
  const r = await rest.select<{ t: string }>('rate_history', { select: 't', source: `eq.${source}`, bank: `eq.${bank}`, meeting: `eq.${meeting}`,
    order: 't.desc', limit: '1' });
  return r[0] ? Date.parse(r[0].t) : null;
}

async function saveHistory(rest: Rest, rows: Row[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 1000) await rest.upsert('rate_history', rows.slice(i, i + 1000), 'source,bank,meeting,outcome,t');
}

export async function runRatesHistory(deps: RatesDeps): Promise<Record<string, unknown>> {
  const { rest } = deps;
  const now = deps.now();
  const from = now - HISTORY_DAYS * DAY;
  const problems: string[] = [];
  const done: Record<string, number> = {};
  const markets = await rest.select<MarketRow>('rate_markets', { select: 'bank,meeting,outcomes', source: 'eq.polymarket' });
  for (const bank of BANKS) {
    const meeting = upcomingMeetings(bank, now)[0];
    if (!meeting) continue;
    // Polymarket : 30 jours au pas horaire (interval=max) et le reste au pas quotidien ; ensuite depuis le dernier point.
    const mk = markets.find((m) => m.bank === bank && m.meeting === meeting);
    if (mk) {
      const lastT = await lastHistoryT(rest, 'polymarket', bank, meeting);
      const rows: Row[] = [];
      try {
        await pool(Object.entries(mk.outcomes) as [Outcome, PmOutcome][], 3, async ([o, m]) => {
          const push = (pts: { t: number; p: number }[], step: string) => {
            for (const x of pts) if (x.t >= from) rows.push({ source: 'polymarket', bank, meeting, outcome: o, t: new Date(x.t).toISOString(), p: x.p, step });
          };
          if (lastT && now - lastT < 13 * DAY) {
            push(pmHistory(await http(deps, `${CLOB}/prices-history?market=${m.token}&startTs=${Math.floor(lastT / 1000)}&endTs=${Math.floor(now / 1000)}&fidelity=60`)), '1h');
          } else {
            const hourly = pmHistory(await http(deps, `${CLOB}/prices-history?market=${m.token}&interval=max&fidelity=60`));
            const daily = pmHistory(await http(deps, `${CLOB}/prices-history?market=${m.token}&interval=max&fidelity=1440`));
            const firstHourly = hourly[0]?.t ?? Infinity;
            push(daily.filter((x) => x.t < firstHourly), '1d');
            push(hourly, '1h');
          }
        });
        await saveHistory(rest, rows);
        done[`polymarket:${bank}`] = rows.length;
      } catch (e) { problems.push(`Polymarket ${bank} : ${errText(e)}`); }
    }
    // Kalshi : bougies horaires depuis le dernier point (60 jours au plus), une requête par issue.
    const series = KALSHI_SERIES[bank];
    if (series) {
      try {
        const q = new URLSearchParams({ series_ticker: series, status: 'open', with_nested_markets: 'true', limit: '12' });
        const k = kalshiDecisions(bank, await http(deps, `${KALSHI}/events?${q}`)).find((x) => x.meeting === meeting);
        if (k) {
          const lastT = await lastHistoryT(rest, 'kalshi', bank, meeting);
          const start = Math.floor(Math.max(from, lastT ?? 0) / 1000);
          const rows: Row[] = [];
          await pool(Object.entries(k.tickers) as [Outcome, string][], 3, async ([o, ticker]) => {
            const body = await http(deps, `${KALSHI}/series/${series}/markets/${ticker}/candlesticks?start_ts=${start}&end_ts=${Math.floor(now / 1000)}&period_interval=60`);
            for (const x of kalshiCandles(body)) rows.push({ source: 'kalshi', bank, meeting, outcome: o, t: new Date(x.t).toISOString(), p: x.p, step: '1h' });
          });
          await saveHistory(rest, rows);
          done[`kalshi:${bank}`] = rows.length;
        }
      } catch (e) { problems.push(`Kalshi ${bank} : ${errText(e)}`); }
    }
  }
  await setStates(rest, now, { 'history:last': { ms: now, done, problems } });
  return { job: 'rates-history', ok: problems.length === 0, done, problems };
}

// --- Taux directeurs (BIS) -------------------------------------------------------------------

export async function runPolicy(deps: RatesDeps): Promise<Record<string, unknown>> {
  const { rest } = deps;
  const now = deps.now();
  const prev = (await getState<PolicyState>(rest, 'policy:all')) ?? {};
  const latest = await rest.select<{ obs_date: string }>('policy_rates', { select: 'obs_date', order: 'obs_date.desc', limit: '1' });
  // Premier passage : 800 jours ; ensuite depuis la dernière date relevée moins 7 jours (le BIS complète en retard).
  const start = latest[0] ? civilDate(Date.parse(`${latest[0].obs_date}T00:00:00Z`) - 7 * DAY, 'UTC') : civilDate(now - 800 * DAY, 'UTC');
  let body: string;
  try {
    body = await http(deps, `${BIS}/D.${BANKS.map((b) => BIS_AREA[b]).join('+')}?startPeriod=${start}&format=csv`);
  } catch (e) {
    const err = `BIS : ${errText(e)}`;
    await setStates(rest, now, { 'feed:bis': feed('bis', 'Banques centrales (BIS)', now, false, err, 26 * 3_600_000, 50 * 3_600_000, null) });
    return { job: 'policy', ok: false, problems: [err] };
  }
  const series = bisSeries(body);
  const rows: Row[] = [];
  const next: PolicyState = {};
  const problems: string[] = [];
  for (const bank of BANKS) {
    const s = series.get(BIS_AREA[bank]) ?? [];
    for (const [d, v] of s) rows.push({ bank, obs_date: d, rate: v, ts_recv: new Date(now).toISOString() });
    const p = policyFromSeries(s);
    const old = prev[bank];
    if (!p) { if (old) next[bank] = old; problems.push(`${bank} : aucune observation depuis le ${start}`); continue; }
    // Aucun mouvement dans la fenêtre relue : le dernier mouvement connu est gardé.
    const keepOld = !p.last_change && old && (old.rate === p.rate || old.last_change?.to === p.rate);
    const changed = !p.last_change && old && old.rate !== p.rate && s.length ? { date: s[0][0], from: old.rate, to: p.rate } : null;
    next[bank] = { ...p, last_change: p.last_change ?? (keepOld ? old!.last_change : changed), since: old && old.since < p.since ? old.since : p.since,
      ts_recv: now };
  }
  for (let i = 0; i < rows.length; i += 1000) await rest.upsert('policy_rates', rows.slice(i, i + 1000), 'bank,obs_date');
  await setStates(rest, now, {
    'policy:all': next as unknown as Json,
    'feed:bis': feed('bis', 'Banques centrales (BIS)', now, true, problems.join(' ; ') || null, 26 * 3_600_000, 50 * 3_600_000, null),
  });
  return { job: 'policy', ok: problems.length === 0, start, rows: rows.length, banks: Object.keys(next).length, problems };
}

