// Analyses de P7 sur la machine Oracle (T-075), service terminal-analysis :
//
// - saisonnalité (chaque nuit, et au démarrage) : BTC et ETH (OKX, quotidien et horaire), QQQ et
//   SPY (Tiingo ajusté, quotidien), lus dans bt_candles ; calcul web/src/analysis/seasonality.ts ;
// - heatmap technique et indicateurs (chaque heure, 2 min après la clôture) : bougies publiques
//   d'OKX (1H, 4H, 1D, 1W) pour BTC et ETH, bt_candles quotidien (semaine agrégée) pour QQQ et
//   SPY ; calcul web/src/analysis/ta.ts ;
// - recherche bancaire (toutes les 15 min) : flux RSS public d'ING THINK, en lecture seule pour
//   Clément (titre, lien, résumé d'ING, date, thème ; jamais le texte de l'article).
//
// Résultats dans p1_state (analysis:season:<actif>, analysis:tech, research:ing ; non diffusés),
// lus par /api/p1/analysis. Secrets : /etc/terminal/bt.env (SUPABASE_URL, SUPABASE_SECRET_KEY).
// État sans secret : /var/lib/terminal-analysis/status.json.

import { pathToFileURL } from 'node:url';
import { createRest, type Json, type Rest } from '../../supabase/functions/p1-jobs/rest';
import { parseFeed, parseFeedDate } from '../../supabase/functions/p1-jobs/news_rules';
import type { FetchLike as PgFetch } from '../../supabase/functions/okx-collector/postgrest';
import { seasonality, type Bar } from '../../web/src/analysis/seasonality';
import { snapshot, type Ohlc, type Snapshot } from '../../web/src/analysis/ta';
import { saveJson } from '../micro/persist';

export const CHECK_MS = 60_000;
export const SEASON_EVERY_MS = 20 * 3_600_000;
export const RESEARCH_EVERY_MS = 15 * 60_000;
export const OKX = 'https://www.okx.com';
export const ING_RSS = 'https://think.ing.com/rss/';
export const UA = 'TERMINAL/0.1 (terminal personnel, lecture seule)';
const DAY = 86_400_000;
const PAGE = 1000;

export const SEASON_ASSETS = [
  { asset: 'BTC', label: 'BTC/USDT', source: 'OKX (BTC-USDT, bougies UTC)', hourly: true },
  { asset: 'ETH', label: 'ETH/USDT', source: 'OKX (ETH-USDT, bougies UTC)', hourly: true },
  { asset: 'QQQ', label: 'QQQ (substitut du Nasdaq 100)', source: 'Tiingo, cours ajustés', hourly: false },
  { asset: 'SPY', label: 'SPY (substitut du S&P 500)', source: 'Tiingo, cours ajustés', hourly: false },
];
export const TFS = ['1H', '4H', '1D', '1W'] as const;
export type Tf = typeof TFS[number];
const OKX_BAR: Record<Tf, string> = { '1H': '1H', '4H': '4H', '1D': '1Dutc', '1W': '1Wutc' };
/** Fenêtre du plus haut sur environ un an, par unité de temps. */
export const HIGH_WINDOW: Record<Tf, number> = { '1H': 300, '4H': 300, '1D': 252, '1W': 52 };
export const TECH_ASSETS = [
  { asset: 'BTC', label: 'BTC/USDT', kind: 'okx' as const, code: 'BTC-USDT', source: 'OKX, bougies publiques' },
  { asset: 'ETH', label: 'ETH/USDT', kind: 'okx' as const, code: 'ETH-USDT', source: 'OKX, bougies publiques' },
  { asset: 'QQQ', label: 'QQQ (Nasdaq 100)', kind: 'daily' as const, code: 'QQQ', source: 'Tiingo, clôtures ajustées' },
  { asset: 'SPY', label: 'SPY (S&P 500)', kind: 'daily' as const, code: 'SPY', source: 'Tiingo, clôtures ajustées' },
  { asset: 'EURUSD', label: 'EUR/USD', kind: 'none' as const, code: '', source: 'Tiingo FX' },
  { asset: 'USDJPY', label: 'USD/JPY', kind: 'none' as const, code: '', source: 'Tiingo FX' },
  { asset: 'XAUUSD', label: 'Or (XAU/USD)', kind: 'none' as const, code: '', source: 'Tiingo FX' },
];
const NO_FX = 'historique non collecté : l’offre gratuite de Tiingo sert déjà la watchlist (T-051)';
const NO_INTRADAY = 'pas de bougies intrajournalières gratuites pour les ETF (T-051)';

export interface TechCell { tf: Tf; snap: Snapshot | null; reason: string | null; bars: number; last_t: number | null }
export interface TechAsset { asset: string; label: string; source: string; cells: TechCell[]; closes: [number, number][] }
export interface ResearchItem { id: string; title: string; link: string; summary: string | null; topic: string | null; published_ms: number | null; seen_ms: number }

export interface AnalysisDeps {
  rest: Rest; fetch: (url: string, init?: RequestInit) => Promise<Response>; now: () => number;
  writeStatus?: (s: Record<string, unknown>) => void;
}

/** Bougies OKX : [ts, o, h, l, c, …, confirm], la plus récente en tête ; bougie en cours exclue. */
export function okxBars(body: unknown): Ohlc[] {
  const data = (body as { code?: string; data?: unknown[][] }).data;
  if (!Array.isArray(data)) throw new Error(`OKX : réponse illisible (${JSON.stringify(body).slice(0, 120)})`);
  return data.filter((r) => r[8] === '1').map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }))
    .filter((b) => [b.o, b.h, b.l, b.c].every(Number.isFinite)).sort((a, b) => a.t - b.t);
}

/** Semaines (lundi 00:00 UTC) agrégées depuis le quotidien ; semaine en cours incluse. */
export function weekly(daily: Ohlc[]): Ohlc[] {
  const out = new Map<number, Ohlc>();
  for (const b of daily) {
    const d = new Date(b.t), wd = (d.getUTCDay() + 6) % 7;
    const k = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - wd * DAY;
    const w = out.get(k);
    if (!w) out.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c });
    else { w.h = Math.max(w.h, b.h); w.l = Math.min(w.l, b.l); w.c = b.c; }
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

const strip = (s: string | null) => (s ? s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&rsquo;/g, '’').replace(/\s+/g, ' ').trim() : null);

/** Éléments du flux d'ING : titre, lien, résumé d'ING (600 caractères au plus), thème, date. */
export function researchItems(xml: string, now: number): ResearchItem[] {
  return parseFeed(xml).filter((i) => i.link).map((i) => {
    const summary = strip(i.summary);
    return {
      id: (i.link ?? '').replace(/#.*$/, ''), title: strip(i.title) ?? '', link: (i.link ?? '').trim(),
      summary: summary ? (summary.length > 600 ? `${summary.slice(0, 599)}…` : summary) : null,
      topic: strip(i.category), published_ms: parseFeedDate(i.date_raw, { tz: 'UTC', labelLies: false }), seen_ms: now,
    };
  }).filter((i) => i.title && /^https:\/\/think\.ing\.com\//.test(i.link));
}

/** Fusion avec les éléments déjà gardés (même lien = même élément, première vue conservée), 60 plus récents. */
export function mergeResearch(prev: ResearchItem[], fresh: ResearchItem[]): ResearchItem[] {
  const m = new Map(prev.map((i) => [i.id, i]));
  for (const i of fresh) { const old = m.get(i.id); m.set(i.id, old ? { ...i, seen_ms: old.seen_ms } : i); }
  return [...m.values()].sort((a, b) => (b.published_ms ?? b.seen_ms) - (a.published_ms ?? a.seen_ms)).slice(0, 60);
}

export class AnalysisService {
  status: Record<string, unknown> = {};
  lastSeason = 0; lastTechHour = -1; lastResearch = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly d: AnalysisDeps) {}

  start(): void { void this.tick(); this.timer = setInterval(() => { void this.tick(); }, CHECK_MS); }
  stop(): void { if (this.timer) clearInterval(this.timer); }

  private async put(key: string, value: unknown): Promise<void> {
    await this.d.rest.upsert('p1_state', [{ key, value: value as Json, updated_ms: this.d.now() }], 'key');
  }

  private async getJson(url: string): Promise<unknown> {
    const r = await this.d.fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status} sur ${new URL(url).host}`);
    return r.json();
  }

  /** Bougies de bt_candles depuis `fromMs`, par pages de 1 000 (clé : ts). */
  async candles(asset: string, tf: '1D' | '1H', fromMs: number): Promise<Bar[]> {
    const out: Bar[] = [];
    let after = new Date(fromMs).toISOString();
    for (;;) {
      const rows = await this.d.rest.select<{ ts: string; open: number; high: number; low: number; close: number }>('bt_candles', {
        select: 'ts,open,high,low,close', asset: `eq.${asset}`, tf: `eq.${tf}`, ts: `gt.${after}`, order: 'ts.asc', limit: String(PAGE) });
      for (const r of rows) out.push({ t: Date.parse(r.ts), o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close) });
      if (rows.length < PAGE) return out;
      after = rows[rows.length - 1].ts;
    }
  }

  async seasonPass(): Promise<void> {
    const now = this.d.now(), done: string[] = [];
    for (const a of SEASON_ASSETS) {
      const daily = await this.candles(a.asset, '1D', 0);
      const hourly = a.hourly ? await this.candles(a.asset, '1H', 0) : [];
      if (!daily.length) continue;
      await this.put(`analysis:season:${a.asset}`, seasonality(a.asset, a.label, a.source, daily, hourly, now));
      done.push(`${a.asset} ${daily.length} j / ${hourly.length} h`);
    }
    this.lastSeason = now;
    this.status.season = { at: now, done };
  }

  async techPass(): Promise<void> {
    const now = this.d.now(), assets: TechAsset[] = [];
    for (const a of TECH_ASSETS) {
      const cells: TechCell[] = [];
      let closes: [number, number][] = [];
      if (a.kind === 'okx') {
        for (const tf of TFS) {
          try {
            const bars = okxBars(await this.getJson(`${OKX}/api/v5/market/candles?instId=${a.code}&bar=${OKX_BAR[tf]}&limit=300`));
            cells.push({ tf, snap: snapshot(bars, HIGH_WINDOW[tf]), reason: bars.length < 200 ? `${bars.length} bougies seulement (EMA 200 incomplète)` : null, bars: bars.length, last_t: bars.at(-1)?.t ?? null });
            if (tf === '1D') closes = bars.slice(-120).map((b) => [b.t, b.c]);
          } catch (e) { cells.push({ tf, snap: null, reason: `OKX injoignable : ${(e as Error).message}`, bars: 0, last_t: null }); }
        }
      } else if (a.kind === 'daily') {
        const daily = await this.candles(a.code, '1D', now - 9 * 365 * DAY);
        const w = weekly(daily);
        for (const tf of TFS) {
          const bars = tf === '1D' ? daily : tf === '1W' ? w : [];
          cells.push({ tf, snap: bars.length ? snapshot(bars, HIGH_WINDOW[tf]) : null, reason: bars.length ? null : NO_INTRADAY, bars: bars.length, last_t: bars.at(-1)?.t ?? null });
        }
        closes = daily.slice(-120).map((b) => [b.t, b.c]);
      } else {
        for (const tf of TFS) cells.push({ tf, snap: null, reason: NO_FX, bars: 0, last_t: null });
      }
      assets.push({ asset: a.asset, label: a.label, source: a.source, cells, closes });
    }
    await this.put('analysis:tech', { assets, tfs: TFS, computed_ms: now });
    this.lastTechHour = Math.floor(now / 3_600_000);
    this.status.tech = { at: now, assets: assets.length };
  }

  async researchPass(): Promise<void> {
    const now = this.d.now();
    const prev = await this.d.rest.select<{ value: { items?: ResearchItem[] } }>('p1_state', { select: 'value', key: 'eq.research:ing', limit: '1' });
    const old = prev[0]?.value.items ?? [];
    let fresh: ResearchItem[] = [], error: string | null = null;
    try {
      const r = await this.d.fetch(ING_RSS, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml;q=0.9' }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fresh = researchItems(await r.text(), now);
      if (!fresh.length) throw new Error('flux vide ou illisible');
    } catch (e) { error = (e as Error).message; }
    await this.put('research:ing', { source: 'ING THINK (flux RSS public)', url: ING_RSS, items: mergeResearch(old, fresh), fetched_ms: now, ok: !error, error });
    this.lastResearch = now;
    this.status.research = { at: now, ok: !error, error, fresh: fresh.length };
  }

  async tick(): Promise<void> {
    const now = this.d.now();
    const run = async (name: string, f: () => Promise<void>) => {
      try { await f(); } catch (e) { this.status[`${name}_error`] = `${new Date(now).toISOString()} ${(e as Error).message}`.slice(0, 300); console.error(`analyse ${name}`, e); }
    };
    if (now - this.lastResearch >= RESEARCH_EVERY_MS) await run('research', () => this.researchPass());
    const hour = Math.floor(now / 3_600_000);
    if (hour !== this.lastTechHour && now % 3_600_000 >= 2 * 60_000) await run('tech', () => this.techPass());
    if (now - this.lastSeason >= SEASON_EVERY_MS) await run('season', () => this.seasonPass());
    this.d.writeStatus?.({ at: now, ...this.status });
  }
}

// Lancement par systemd (deploy/oracle/terminal-analysis.service).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = (n: string) => process.env[n];
  const url = env('SUPABASE_URL'), key = env('SUPABASE_SECRET_KEY');
  if (!url || !key) { console.error('analyse : SUPABASE_URL ou SUPABASE_SECRET_KEY absente de /etc/terminal/bt.env'); process.exit(2); }
  const s = new AnalysisService({
    rest: createRest(url, key, ((u: string, i?: RequestInit) => fetch(u, i)) as unknown as PgFetch),
    fetch: (u, i) => fetch(u, i), now: () => Date.now(),
    writeStatus: (v) => { try { saveJson(env('ANALYSIS_STATUS') ?? '/var/lib/terminal-analysis/status.json', v); } catch { /* état seulement */ } },
  });
  s.start();
  console.log('analyse : service démarré');
  process.on('SIGTERM', () => { console.log('analyse : SIGTERM'); s.stop(); setTimeout(() => process.exit(0), 500); });
}
