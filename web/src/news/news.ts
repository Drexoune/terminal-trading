// Fil d'actus (E6/O6) : titres publiés par la tâche « news » de Supabase (clés news:item:<id>,
// état des flux news:feeds), arrivés par /api/p1/state et Realtime. Logique pure, testée.
// Titres et résumés dans leur langue d'origine, marqués « VO » (T-019).

import { zonedParts } from '../lib/time';

export type NewsCategory = 'banque-centrale' | 'macro' | 'crypto' | 'matieres-premieres' | 'general';

export interface NewsItem {
  id: number;
  feed: string;
  source: string;
  kind: 'officielle' | 'agence';
  bank: string | null;
  title: string;
  summary: string | null;
  url: string | null;
  category: NewsCategory;
  urgent: boolean;
  rule: string | null;
  rules_version: string;
  figure: { name: string; actual: string | null; forecast: string | null; previous: string | null; revised: string | null } | null;
  published_ms: number | null;
  published_raw: string | null;
  received_ms: number;
  backfill: boolean;
  lang: string;
}

export interface FeedStatus { status: 'ok' | 'erreur' | 'bloqué'; last_ok_ms: number | null; last_error: string | null; items: number; noise: number }

export const CATEGORIES: { value: NewsCategory | 'tout'; label: string }[] = [
  { value: 'tout', label: 'Tout' },
  { value: 'banque-centrale', label: 'Banque centrale' },
  { value: 'macro', label: 'Macro' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'matieres-premieres', label: 'Matières premières' },
];

export const CATEGORY_LABEL: Record<NewsCategory, string> = {
  'banque-centrale': 'Banque centrale', macro: 'Macro', crypto: 'Crypto', 'matieres-premieres': 'Matières premières', general: 'Général',
};

export const KIND_LABEL: Record<NewsItem['kind'], string> = { officielle: 'Publication officielle', agence: 'Fil d’agence' };

/** Heure qui classe un titre : celle de la source, sinon celle de la lecture. */
export const itemTime = (i: NewsItem) => i.published_ms ?? i.received_ms;

export function sortNews(items: NewsItem[]): NewsItem[] {
  return [...items].sort((a, b) => itemTime(b) - itemTime(a) || b.id - a.id);
}

const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

export function filterNews(items: NewsItem[], category: NewsCategory | 'tout', text: string): NewsItem[] {
  const q = fold(text.trim());
  return items.filter((i) => (category === 'tout' || i.category === category)
    && (!q || fold(`${i.title} ${i.source} ${i.summary ?? ''}`).includes(q)));
}

/** Titres urgents (règles « décision » et chiffres majeurs), arriérés exclus, les plus récents d'abord. */
export function urgentNews(items: NewsItem[], n = 4): NewsItem[] {
  return sortNews(items.filter((i) => i.urgent && !i.backfill)).slice(0, n);
}

/** Titres du jour (Paris) : compteur du sous-en-tête. */
export function todayCount(items: NewsItem[], now: number): number {
  const p = zonedParts(now, 'Europe/Paris');
  return items.filter((i) => {
    const q = zonedParts(itemTime(i), 'Europe/Paris');
    return q.y === p.y && q.m === p.m && q.d === p.d;
  }).length;
}

/** Date courte à Paris : « 20/11/2026 ». */
export function fmtDateParis(ms: number): string {
  const p = zonedParts(ms, 'Europe/Paris');
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`;
}

/** Délai entre l'heure de la source et la lecture, en clair (« lu 42 s après »). */
export function readDelay(i: NewsItem): string | null {
  if (i.published_ms === null) return null;
  const d = Math.round((i.received_ms - i.published_ms) / 1000);
  if (d < 0) return 'heure de la source postérieure à la lecture';
  if (d < 120) return `lu ${d} s après publication`;
  if (d < 7200) return `lu ${Math.round(d / 60)} min après publication`;
  return 'lu plus de 2 h après publication (arriéré)';
}
