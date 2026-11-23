import { describe, expect, it } from 'vitest';
import { filterNews, readDelay, sortNews, todayCount, urgentNews, type NewsItem } from './news';

const T = Date.UTC(2026, 11, 10, 13, 30);
const item = (id: number, over: Partial<NewsItem> = {}): NewsItem => ({
  id, feed: 'financialjuice', source: 'FinancialJuice', kind: 'agence', bank: null, title: `Titre ${id}`, summary: null, url: null,
  category: 'general', urgent: false, rule: null, rules_version: 'r1-x', figure: null, published_ms: T - id * 60_000,
  published_raw: null, received_ms: T, backfill: false, lang: 'en', ...over });

describe('fil d’actus : logique de l’écran', () => {
  it('tri par heure de la source, filtre par catégorie et texte sans accents', () => {
    const items = [item(3), item(1, { category: 'banque-centrale', title: 'Réserve fédérale : décision' }), item(2, { published_ms: null })];
    expect(sortNews(items).map((i) => i.id)).toEqual([2, 1, 3]);
    expect(filterNews(items, 'banque-centrale', '').map((i) => i.id)).toEqual([1]);
    expect(filterNews(items, 'tout', 'reserve FED').map((i) => i.id)).toEqual([1]);
  });

  it('urgents : jamais un arriéré ; compteur du jour à Paris', () => {
    const items = [item(1, { urgent: true }), item(2, { urgent: true, backfill: true }), item(3), item(4, { published_ms: T - 86_400_000 })];
    expect(urgentNews(items).map((i) => i.id)).toEqual([1]);
    expect(todayCount(items, T)).toBe(3);
  });

  it('délai de lecture lisible', () => {
    expect(readDelay(item(0, { published_ms: T - 42_000 }))).toBe('lu 42 s après publication');
    expect(readDelay(item(0, { published_ms: T - 600_000 }))).toBe('lu 10 min après publication');
    expect(readDelay(item(0, { published_ms: null }))).toBeNull();
  });
});
