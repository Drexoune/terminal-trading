// @vitest-environment node
// Tree of Alpha (T-072) : messages réels relevés le 20/11/2026 (5 types) → titres du fil d'actus ;
// doublons par la fonction partagée avec les RSS.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isDuplicate, type Known } from '../../supabase/functions/p1-jobs/news';
import { normalizeToa, TOA_FEED, type ToaRaw } from './toa';

const FX = JSON.parse(readFileSync(new URL('./fixtures/toa.json', import.meta.url), 'utf8')) as { t_recv_ms: number; raw: ToaRaw }[];
const byType = (t: string) => FX.filter((x) => (x.raw.type ?? x.raw.source) === t);

describe('normalisation', () => {
  it('tweet : « compte : première ligne », corps en résumé, lien sans fragment, crypto citée', () => {
    const m = byType('direct')[0];
    const it = normalizeToa(m.raw, m.t_recv_ms)!;
    expect(it.title.startsWith('The Block: THE BLOCK: HeartSciences shareholders approved')).toBe(true);
    expect(it.source).toBe('Tree of Alpha · The Block');
    expect(it.url).toBe('https://x.com/TheBlockCo/status/2123793913278349448');
    expect(it.native_id).toBe('2123793913278349448');
    expect(it.category).toBe('crypto');
    expect(it.summary).toContain('Fortitude controls more than 60 MW');
    expect(it.published_ms).toBe(1795186902380);
  });
  it('article : titre tel quel, site lu dans le titre, délai de 5 s noté', () => {
    const m = byType('Blogs')[0];
    const it = normalizeToa(m.raw, m.t_recv_ms)!;
    expect(it.title).toBe('CNBC: Bitcoin selloff: Crypto is failing the \'digital gold\' test again as it sinks with stocks');
    expect(it.source).toBe('Tree of Alpha · CNBC');
    expect(it.delayed_ms).toBe(5000);
    expect(it.summary).toBeNull();
  });
  it('les 5 types donnent un titre, une source et une heure ; jamais urgent', () => {
    for (const m of FX) {
      const it = normalizeToa(m.raw, m.t_recv_ms);
      expect(it, JSON.stringify(m.raw).slice(0, 120)).not.toBeNull();
      expect(it!.title.length).toBeGreaterThan(5);
      expect(it!.title.length).toBeLessThanOrEqual(300);
      expect(it!.source.startsWith('Tree of Alpha · ')).toBe(true);
      expect(it!.published_ms).not.toBeNull();
      expect(it!.urgent).toBe(false);
    }
    expect(normalizeToa(byType('telegram')[0].raw, 0)!.source).toBe('Tree of Alpha · Pavel Durov');
    expect(normalizeToa(byType('Proposals')[0].raw, 0)!.category).toBe('crypto');
  });
  it('messages vides ignorés', () => {
    expect(normalizeToa({}, 0)).toBeNull();
    expect(normalizeToa({ type: 'direct', title: '', body: '' }, 0)).toBeNull();
  });
});

describe('doublons (fonction partagée avec les RSS)', () => {
  it('identifiant natif, URL, titre normalisé', () => {
    const it = normalizeToa(byType('Blogs')[0].raw, 0)!;
    const known: Known[] = [{ id: 1, feed: 'treeofalpha', native_id: it.native_id, url: null, title: 'x', title_norm: 'x', bank: null, t: 0 }];
    expect(isDuplicate(known, TOA_FEED, it.native_id, null, it.title, it.title_norm, it.published_ms!)).toBe(true);
    const byUrl: Known[] = [{ id: 2, feed: 'financialjuice', native_id: null, url: it.url, title: 'y', title_norm: 'y', bank: null, t: 0 }];
    expect(isDuplicate(byUrl, TOA_FEED, 'autre', it.url, it.title, it.title_norm, it.published_ms!)).toBe(true);
    expect(isDuplicate([], TOA_FEED, it.native_id, it.url, it.title, it.title_norm, it.published_ms!)).toBe(false);
  });
});
