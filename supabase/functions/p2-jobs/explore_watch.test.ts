// @vitest-environment node
// Sonde de la watchlist (T-005) : une ligne par requête, clés jamais dans le rapport, absence de clé dite.
import { describe, expect, it } from 'vitest';
import type { ExploreDeps } from './explore.ts';
import { exploreWatch, scrub, specs } from './explore_watch.ts';

const KEYS: Record<string, string> = { TIINGO_API_KEY: 'tiingo-secret-123', MASSIVE_API_KEY: 'massive-secret-456', ALPHA_VANTAGE_API_KEY: 'alpha-secret-789' };

describe('sonde de la watchlist', () => {
  it('22 requêtes, 2 seulement vers Alpha Vantage ; clés retirées des réponses', async () => {
    let t = 0;
    const urls: string[] = [];
    const deps: ExploreDeps = {
      env: (k) => KEYS[k], now: () => 0, perf: () => (t += 10), sleep: async (ms) => { t += ms; },
      fetch: async (url) => { urls.push(url); return { status: 200, headers: { get: () => null },
        text: async () => `{"note":"echo apikey=alpha-secret-789 tiingo-secret-123"}` }; },
    };
    const r = await exploreWatch(deps);
    const lines = r.lines as { source: string; excerpt: string }[];
    expect(lines).toHaveLength(22);
    expect(urls.filter((u) => u.includes('alphavantage'))).toHaveLength(2);
    expect(JSON.stringify(r)).not.toMatch(/secret-/);
    expect(lines[0].excerpt).toContain('apikey=<clé>');
  });

  it('clé absente : la requête n’est pas faite, la raison est donnée', () => {
    const s = specs(() => undefined);
    expect(s.filter((x) => x.skip).map((x) => x.skip)).toContain('MASSIVE_API_KEY absente');
    expect(s.filter((x) => !x.skip).every((x) => x.source === 'stooq' || x.source === 'fred')).toBe(true);
    expect(scrub('token=abc&x=1', () => undefined)).toBe('token=<clé>&x=1');
  });
});
