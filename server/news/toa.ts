// Messages de Tree of Alpha (T-021, T-072) → titres du fil d'actus, au même format que les RSS
// (supabase/functions/p1-jobs/news.ts). Format relevé sur 3 jours (20–23/11/2026,
// docs/exploration-p1.md) : JSON sans clé, `_id`, `time` (ms), `title`, `body`, `link` ou `url`,
// `suggestions` (cryptos citées) ; `type` direct ou telegram pour un message de compte (le titre
// est alors le compte : « The Block (@TheBlockCo) »), `source` Blogs, usGov ou Proposals pour un
// article (le titre commence par le site : « CNBC: … »). Blogs et usGov : 5 s de délai (gratuit).

import { canonicalUrl, classify, normTitle, numbersOf, type Category, type Feed } from '../../supabase/functions/p1-jobs/news_rules';

export const TOA_WS = 'wss://news.treeofalpha.com/ws';
export const TOA_FEED: Feed = { id: 'treeofalpha', bank: null, currency: null, source: 'Tree of Alpha', url: TOA_WS, kind: 'agence', tz: 'UTC' };
export const TITLE_MAX = 300;
export const SUMMARY_MAX = 600;

export interface ToaRaw {
  _id?: string; time?: number | string; title?: string; body?: string; en?: string; link?: string; url?: string;
  type?: string; source?: string; delay?: number; suggestions?: unknown[]; symbols?: unknown[];
}

export interface ToaItem {
  native_id: string | null; url: string | null; title: string; title_norm: string; numbers: string; summary: string | null;
  source: string; category: Category; urgent: boolean; rule: string | null; published_ms: number | null; received_ms: number;
  type: string; delayed_ms: number | null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Un message de Tree of Alpha, ou null s'il n'a rien à afficher (accusés, messages vides). */
export function normalizeToa(raw: ToaRaw, received: number): ToaItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type ?? raw.source ?? 'autre');
  const post = type === 'direct' || type === 'telegram';
  const account = post ? String(raw.title ?? '').replace(/\s*\((?:@|t\.me\/)[^)]*\)\s*$/, '').trim() : '';
  const body = String(raw.body ?? '').trim();
  const first = body.split('\n').map((s) => s.trim()).find(Boolean) ?? '';
  const title = clip(post ? (first ? `${account || 'Compte'}: ${first}` : account) : String(raw.title ?? raw.en ?? '').trim(), TITLE_MAX);
  if (!title) return null;
  const site = post ? account : (/^([A-Za-z0-9 .&'’-]{2,30}):\s/.exec(title)?.[1] ?? type);
  const published = Number(raw.time);
  const c = classify(TOA_FEED, title, Number.isFinite(published) ? published : null);
  const coins = (Array.isArray(raw.suggestions) && raw.suggestions.length > 0) || (Array.isArray(raw.symbols) && raw.symbols.length > 0);
  const category: Category = c.category === 'general' && (coins || type === 'Proposals') ? 'crypto' : c.category;
  return {
    native_id: raw._id ? String(raw._id).slice(0, 300) : null,
    url: canonicalUrl(raw.link ?? raw.url ?? null),
    title, title_norm: normTitle(title), numbers: numbersOf(title),
    summary: post && body.length > first.length ? clip(body, SUMMARY_MAX) : null,
    source: `Tree of Alpha · ${site || type}`, category, urgent: false, rule: c.rule,
    published_ms: Number.isFinite(published) ? published : null, received_ms: received, type,
    delayed_ms: typeof raw.delay === 'number' ? raw.delay : null,
  };
}
