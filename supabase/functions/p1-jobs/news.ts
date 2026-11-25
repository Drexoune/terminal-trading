// Fil d'actus en ligne (étape E6, plan « Tout en ligne » O6) : tâche « news » de p1-jobs,
// lancée chaque minute par pg_cron.
//
// - Les 15 flux (8 banques centrales, FinancialJuice) sont relus chaque minute, en GET
//   conditionnel (ETag, Last-Modified) : un flux inchangé répond 304 et ne coûte rien.
// - Fenêtre d'une décision de banque centrale (événement Fort de l'agenda, T-1 min à T+10 min) :
//   les flux de cette banque sont relus toutes les 3 s pendant toute la minute (plan P1 § 9).
// - 403 ou 429 : flux mis en pause une heure, état « bloqué », aucun contournement.
// - Doublons en quatre couches : identifiant natif, URL canonique, titre normalisé de la même
//   banque, quasi-doublon dans les 15 min (jamais deux nombres différents).
// - Un titre de plus de 2 h, ou lu au tout premier passage d'un flux, est enregistré comme
//   « arriéré » : affiché, jamais annoncé (ni alerte, ni voix).
// - Chaque titre gardé va dans news_items et dans p1_state (news:item:<id>), diffusé au front par
//   Realtime : un titre urgent arrive à l'écran dans les 2 s qui suivent sa lecture.

import { fireEventWatch, fireNewsAlerts, type AlertDeps } from './alerts.ts';
import { actualFor, matchFigure, type FigureItem } from './calendar_actuals.ts';
import { feedFail, feedOk, type FeedState } from './calendar_job.ts';
import {
  canonicalUrl, classify, cleanTitle, FEEDS, FJ_NOISE, nearDuplicate, normTitle, numbersOf, parseFeed, parseFeedDate,
  RULES_VERSION, type Feed,
} from './news_rules.ts';
import type { Json, Rest, Row } from './rest.ts';

export const NEWS_FEED = { name: 'news', label: 'Fil d’actus', late_after_ms: 3 * 60_000, stale_after_ms: 10 * 60_000 };
const MIN = 60_000;
const KEEP_DAYS = 7;
const BACKFILL_MS = 2 * 3_600_000;
const NEAR_MS = 15 * MIN;
const BLOCK_MS = 3_600_000;
const FAST_EVERY_MS = 3000;
const FAST_BUDGET_MS = 52_000;
const FETCH_TIMEOUT_MS = 8000;
const SUMMARY_MAX = 600;
const UA = 'TERMINAL/1.0 (terminal personnel, lecture RSS ; usage non commercial)';

export interface NewsHttpResponse { status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }
export interface NewsDeps {
  fetch: (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<NewsHttpResponse>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  env: (name: string) => string | undefined;
  rest: Rest;
}

interface FeedStatus { status: 'ok' | 'erreur' | 'bloqué'; last_ok_ms: number | null; last_error: string | null; blocked_until: number | null;
  etag: string | null; last_modified: string | null; polls: number; items: number; noise: number; first_done: boolean }

export interface Known { id: number; feed: string; native_id: string | null; url: string | null; title: string; title_norm: string; bank: string | null; t: number }

/**
 * Les quatre couches de doublons du fil d'actus, partagées par les RSS (cette tâche) et Tree of
 * Alpha (machine Oracle, T-072) : identifiant natif, URL canonique, titre normalisé de la même
 * banque (ou du même flux), quasi-doublon dans les 15 min (jamais deux nombres différents).
 */
export function isDuplicate(known: Known[], feed: Pick<Feed, 'id' | 'bank'>, nativeId: string | null, url: string | null, title: string, norm: string, t: number): boolean {
  for (const k of known) {
    if (nativeId && k.feed === feed.id && k.native_id === nativeId) return true;                   // 1. identifiant natif
    if (url && k.url === url) return true;                                                            // 2. URL canonique
    if (k.title_norm === norm && (k.bank ?? k.feed) === (feed.bank ?? feed.id)) return true;          // 3. titre normalisé
    if (Math.abs(k.t - t) <= NEAR_MS && nearDuplicate(k.title, title)) return true;                   // 4. quasi-doublon
  }
  return false;
}

export interface NewsItem {
  id: number; feed: string; source: string; kind: string; bank: string | null; title: string; summary: string | null; url: string | null;
  category: string; urgent: boolean; rule: string | null; rules_version: string; figure: Record<string, string | null> | null;
  published_ms: number | null; published_raw: string | null; received_ms: number; backfill: boolean; lang: 'en';
}

async function getState<T>(rest: Rest, key: string): Promise<T | null> {
  const rows = await rest.select<{ value: T }>('p1_state', { select: 'value', key: `eq.${key}`, limit: '1' });
  return rows[0]?.value ?? null;
}

async function putState(rest: Rest, entries: [string, unknown][], now: number): Promise<void> {
  if (entries.length) await rest.upsert('p1_state', entries.map(([key, value]) => ({ key, value: value as Json, updated_ms: now })), 'key');
}

const fresh = (): FeedStatus => ({ status: 'ok', last_ok_ms: null, last_error: null, blocked_until: null, etag: null, last_modified: null,
  polls: 0, items: 0, noise: 0, first_done: false });

/** Banques dont une décision (événement Fort de l'agenda) tombe entre T-1 min et T+10 min. */
export function fastBanks(events: Record<string, unknown>[], now: number): Set<string> {
  const out = new Set<string>();
  for (const ev of events) {
    const t = ev.time_ms;
    if (typeof t !== 'number' || ev.impact !== 'High' || !(now >= t - MIN && now <= t + 10 * MIN)) continue;
    if (!/rate|statement|decision|minutes|policy|OCR|press conference/i.test(String(ev.title ?? ''))) continue;
    for (const f of FEEDS) if (f.currency && f.currency === ev.currency && f.bank) out.add(f.bank);
  }
  return out;
}

class NewsRun {
  known: Known[] = [];
  status: Record<string, FeedStatus> = {};
  added: NewsItem[] = [];
  published = 0;              // titres de added déjà écrits dans p1_state
  actuals: string[] = [];     // réels de l'agenda rattachés pendant ce passage (T-048)
  problems: string[] = [];
  constructor(readonly deps: NewsDeps) {}

  async load(): Promise<void> {
    const { rest, now } = this.deps;
    this.status = (await getState<Record<string, FeedStatus>>(rest, 'news:feeds')) ?? {};
    for (const f of FEEDS) this.status[f.id] = { ...fresh(), ...this.status[f.id] };
    const rows = await rest.select<{ id: number; feed: string; native_id: string | null; url: string | null; title: string;
      title_norm: string; published_ms: number | null; received_ms: number }>('news_items', {
      select: 'id,feed,native_id,url,title,title_norm,published_ms,received_ms', received_ms: `gte.${now() - KEEP_DAYS * 86_400_000}`,
      order: 'received_ms.desc', limit: '5000' });
    this.known = rows.map((r) => ({ id: r.id, feed: r.feed, native_id: r.native_id, url: r.url, title: r.title, title_norm: r.title_norm,
      bank: FEEDS.find((f) => f.id === r.feed)?.bank ?? null, t: r.published_ms ?? r.received_ms }));
  }

  duplicate(feed: Feed, nativeId: string | null, url: string | null, title: string, norm: string, t: number): boolean {
    return isDuplicate(this.known, feed, nativeId, url, title, norm, t);
  }

  async poll(feed: Feed): Promise<void> {
    const { now } = this.deps;
    const st = this.status[feed.id];
    if (st.blocked_until && now() < st.blocked_until) return;
    st.polls++;
    const headers: Record<string, string> = { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5' };
    if (st.etag) headers['If-None-Match'] = st.etag;
    if (st.last_modified) headers['If-Modified-Since'] = st.last_modified;
    let r: NewsHttpResponse;
    try {
      r = await this.deps.fetch(feed.url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (e) {
      Object.assign(st, { status: 'erreur', last_error: `réseau : ${(e as Error).name}` });
      return;
    }
    if (r.status === 304) { Object.assign(st, { status: 'ok', last_ok_ms: now(), last_error: null }); return; }
    if (r.status === 403 || r.status === 429) {
      Object.assign(st, { status: 'bloqué', last_error: `HTTP ${r.status} : pause d’une heure, aucun contournement`, blocked_until: now() + BLOCK_MS });
      return;
    }
    if (r.status !== 200) { Object.assign(st, { status: 'erreur', last_error: `HTTP ${r.status}` }); return; }
    const received = now();
    let items;
    try {
      items = parseFeed(new Uint8Array(await r.arrayBuffer()), r.headers.get('content-type'));
    } catch (e) {
      Object.assign(st, { status: 'erreur', last_error: `flux illisible : ${(e as Error).message}`.slice(0, 200) });
      return;
    }
    Object.assign(st, { status: 'ok', last_ok_ms: received, last_error: null, blocked_until: null,
      etag: r.headers.get('etag'), last_modified: r.headers.get('last-modified') });
    const firstPass = !st.first_done;
    const rows: Row[] = [];
    const pending: Omit<NewsItem, 'id'>[] = [];
    for (const raw of items) {
      const title = cleanTitle(feed, raw.title);
      if (feed.id === 'financialjuice' && FJ_NOISE.test(title)) { st.noise++; continue; }
      const published = parseFeedDate(raw.date_raw, feed);
      const t = published ?? received;
      if (received - t > KEEP_DAYS * 86_400_000) continue;
      const url = canonicalUrl(raw.link);
      const nativeId = raw.guid?.slice(0, 300) ?? null;
      const norm = normTitle(title);
      if (this.duplicate(feed, nativeId, url, title, norm, t)) continue;
      const c = classify(feed, title, published);
      const summary = raw.summary && raw.summary !== title ? raw.summary.slice(0, SUMMARY_MAX) : null;
      const item = { feed: feed.id, source: feed.source, kind: feed.kind, bank: feed.bank, title, summary, url, category: c.category,
        urgent: c.urgent, rule: c.rule, rules_version: RULES_VERSION, figure: c.figure, published_ms: published,
        published_raw: raw.date_raw, received_ms: received, backfill: firstPass || received - t > BACKFILL_MS, lang: 'en' as const };
      pending.push(item);
      rows.push({ feed: item.feed, source: item.source, kind: item.kind, native_id: nativeId, url, title, title_norm: norm,
        numbers: numbersOf(title), summary, category: c.category, urgent: c.urgent, rule: c.rule, rules_version: RULES_VERSION,
        figure: c.figure as Json, published_ms: published, published_raw: raw.date_raw, received_ms: received, backfill: item.backfill });
      this.known.push({ id: -1, feed: feed.id, native_id: nativeId, url, title, title_norm: norm, bank: feed.bank, t });
    }
    st.first_done = true;
    if (!rows.length) return;
    const made = await this.deps.rest.insertIgnore<{ id: number; url: string | null; title: string }>('news_items', rows, 'url', 'id,url,title');
    for (const m of made) {
      const p = pending.find((x) => x.url === m.url && x.title === m.title);
      if (p) this.added.push({ ...p, id: m.id });
    }
    st.items += made.length;
  }

  /** Écrit les titres pas encore publiés et l'état des flux ; annonce (alertes) ceux qui ne sont pas un arriéré. */
  async flush(): Promise<void> {
    const { rest, now } = this.deps;
    const t = now();
    const fresh = this.added.slice(this.published);
    this.published = this.added.length;
    const entries: [string, unknown][] = fresh.map((i) => [`news:item:${i.id}`, i]);
    const anyOk = FEEDS.some((f) => this.status[f.id].status === 'ok');
    const prev = await getState<FeedState>(rest, 'feed:news');
    const errors = FEEDS.filter((f) => this.status[f.id].status !== 'ok').map((f) => `${f.id} : ${this.status[f.id].last_error}`);
    entries.push(['feed:news', anyOk ? feedOk(NEWS_FEED as Parameters<typeof feedOk>[0], prev, t)
      : feedFail(NEWS_FEED as Parameters<typeof feedFail>[0], prev, errors.join(' ; ') || 'aucun flux lu')]);
    entries.push(['news:feeds', this.status]);
    await putState(rest, entries, t);
    if (fresh.some((i) => i.figure)) {
      try {
        const linked = await linkActuals(rest, t);
        this.actuals.push(...linked);
        // Cloche du calendrier : le réel tiré du fil part tout de suite.
        if (linked.length) await fireEventWatch(this.deps as unknown as AlertDeps);
      } catch (e) {
        this.problems.push(`réels : ${(e as Error).message}`.slice(0, 200));
      }
    }
    const live = fresh.filter((i) => !i.backfill);
    if (!live.length) return;
    try {
      await fireNewsAlerts(this.deps as unknown as AlertDeps, live);
    } catch (e) {
      this.problems.push(`alertes : ${(e as Error).message}`.slice(0, 200));
    }
  }
}

/**
 * Réel des événements de l'agenda (T-048) : chiffres structurés de FinancialJuice des 36
 * dernières heures rattachés aux deux dernières semaines publiées. Idempotent : une clé
 * calendar:actual:<événement> déjà écrite n'est jamais remplacée (première lecture gardée).
 */
export async function linkActuals(rest: Rest, now: number): Promise<string[]> {
  const figs = await rest.select<FigureItem>('news_items', {
    select: 'id,title,published_ms,received_ms,figure', feed: 'eq.financialjuice', figure: 'not.is.null',
    received_ms: `gte.${now - 36 * 3_600_000}`, order: 'received_ms.asc', limit: '1000' });
  if (!figs.length) return [];
  const weeks = await rest.select<{ value: { events?: { id: string; title: string; currency: string; time_ms: number | null; forecast_raw: string | null }[] } }>(
    'p1_state', { select: 'value', key: 'like.calendar:week:*', order: 'key.desc', limit: '2' });
  const events = weeks.flatMap((w) => w.value.events ?? []);
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const f of figs) {
    const ev = matchFigure(f, events);
    if (!ev || seen.has(ev.id)) continue;
    seen.add(ev.id);
    rows.push({ key: `calendar:actual:${ev.id}`, value: actualFor(f, ev) as unknown as Json, updated_ms: now });
  }
  if (!rows.length) return [];
  const made = await rest.insertIgnore<{ key: string }>('p1_state', rows, 'key', 'key');
  return made.map((m) => m.key);
}

/** Tâche « news », chaque minute. */
export async function runNews(deps: NewsDeps): Promise<Record<string, unknown>> {
  const { rest, now } = deps;
  const start = now();
  const run = new NewsRun(deps);
  await run.load();
  await Promise.all(FEEDS.map((f) => run.poll(f)));
  // Fenêtre d'une décision : relecture rapprochée des flux de la banque concernée.
  const weeks = await rest.select<{ value: { events?: Record<string, unknown>[] } }>('p1_state', {
    select: 'value', key: 'like.calendar:week:*', order: 'key.desc', limit: '1' });
  const banks = fastBanks(weeks[0]?.value.events ?? [], now());
  let fastPolls = 0;
  if (banks.size) {
    const lock = await rest.insertIgnore('p1_state', [{ key: `lock:news-fast:${Math.floor(start / MIN)}`, value: { at: start }, updated_ms: start }], 'key', 'key');
    if (lock.length) {
      const feeds = FEEDS.filter((f) => f.bank && banks.has(f.bank));
      while (now() - start < FAST_BUDGET_MS) {
        await deps.sleep(FAST_EVERY_MS);
        await Promise.all(feeds.map((f) => run.poll(f)));
        fastPolls++;
        // Un titre lu pendant la fenêtre part tout de suite (écran, alertes), sans attendre la fin de la minute.
        if (run.added.length > run.published) await run.flush();
      }
    }
  }
  await run.flush();
  // Filet : rattachement relancé à chaque passage (agenda republié entre-temps, chiffre déjà lu).
  try {
    run.actuals.push(...await linkActuals(rest, now()));
  } catch (e) {
    run.problems.push(`réels : ${(e as Error).message}`.slice(0, 200));
  }
  // Ménage : titres de plus de 3 jours retirés de l'état publié (la table les garde).
  await rest.remove('p1_state', { key: 'like.news:item:*', updated_ms: `lt.${now() - 3 * 86_400_000}` });
  await rest.remove('p1_state', { key: 'like.lock:news-fast:*', updated_ms: `lt.${now() - 3_600_000}` });
  return { job: 'news', ok: FEEDS.some((f) => run.status[f.id].status === 'ok'), added: run.added.length, problems: run.problems,
    actuals: run.actuals,
    urgent: run.added.filter((i) => i.urgent && !i.backfill).map((i) => i.title), fast: [...banks], fast_polls: fastPolls,
    feeds: Object.fromEntries(FEEDS.map((f) => [f.id, run.status[f.id].status === 'ok' ? 'ok' : run.status[f.id].last_error])) };
}
