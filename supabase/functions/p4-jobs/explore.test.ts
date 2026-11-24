// @vitest-environment node
// Sonde S0 de p4-jobs : lecture des réponses réelles du 24/11/2026 (OKX, Binance, CFTC, Bank
// Participation Report, FRED), une ligne par source, clé Tiingo jamais recopiée, appel protégé.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fredLast } from '../p3-jobs/explore.ts';
import { bprMonths, explore, listSpan, okxSpan, scrub, type ExploreDeps } from './explore.ts';
import { createHandler } from './handler.ts';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const KEY = 'tiingo-cle-de-test-123456';

describe('lecture des réponses réelles', () => {
  it('OKX : bougies quotidiennes, la plus récente en tête', () => {
    const s = okxSpan(fx('okx-candles-btc-2026-11-24.json'));
    expect(s.code).toBe('0');
    expect(s.count).toBe(100);
    expect((s.newest as string[])[0]).toBe(String(Date.UTC(2026, 10, 24)));
  });
  it('Binance : 500 points horaires, du plus ancien au plus récent', () => {
    const s = listSpan(fx('binance-global-account-btc-2026-11-24.json'));
    expect(s.count).toBe(500);
    expect((s.first as { timestamp: number }).timestamp).toBeLessThan((s.last as { timestamp: number }).timestamp);
  });
  it('CFTC : rapport TFF au mardi 17/11 ; mois du Bank Participation Report', () => {
    const rows = JSON.parse(fx('cftc-tff-futures-2026-11-24.json')) as { report_date_as_yyyy_mm_dd: string }[];
    expect(rows[0].report_date_as_yyyy_mm_dd).toBe('2026-11-17T00:00:00.000');
    expect(bprMonths(fx('cftc-bpr-index-2026-11-24.html')).slice(-2)).toEqual(['2026-10', '2026-11']);
  });
  it('FRED : dernières dates du VIX et du reverse repo', () => {
    expect(fredLast(fx('fred-vixcls-2026-11-24.csv'))).toBe('2026-11-20');
    expect(fredLast(fx('fred-rrpontsyd-2026-11-24.csv'))).toBe('2026-11-23');
  });
  it('clé Tiingo retirée de tout texte', () => {
    const env = (n: string) => (n === 'TIINGO_API_KEY' ? KEY : undefined);
    expect(scrub(`Authorization: Token ${KEY} ; url?token=${KEY}`, env)).toBe('Authorization: Token <clé> ; url?token=<clé>');
  });
});

describe('sonde S0', () => {
  const deps = (status: number, key = KEY, seen: string[] = []): ExploreDeps => {
    let t = 0;
    return {
      now: () => 1_795_500_000_000, perf: () => (t += 5), sleep: async () => {},
      env: (n) => (n === 'TIINGO_API_KEY' ? key || undefined : n === 'SB_REGION' ? 'eu-central-2' : undefined),
      fetch: async (url, init) => {
        seen.push(`${url} ${JSON.stringify(init?.headers ?? {})}`);
        return {
          status, headers: { get: (k: string) => (k === 'cf-ray' ? 'abc-AMS' : null) },
          text: async () => status !== 200 ? `refus ${KEY}`
            : url.includes('fred') ? fx('fred-vixcls-2026-11-24.csv') : url.includes('okx.com') ? fx('okx-candles-btc-2026-11-24.json')
            : url.includes('bybit') ? fx('bybit-account-ratio-btc-2026-11-24.json') : url.includes('cftc.gov/Market') ? fx('cftc-bpr-index-2026-11-24.html')
            : url.includes('premiumIndex') ? '{"lastFundingRate":"0.00004574","time":1795523070000}'
            : url.includes('cftc') ? fx('cftc-tff-futures-2026-11-24.json') : '[{"date":"2026-11-20T00:00:00.000Z","close":1}]',
        };
      },
    };
  };
  const LABELS = ['fred-vix', 'fred-rrp', 'cboe-vix', 'tiingo-eod-spy', 'tiingo-eod-tlt', 'tiingo-eod-cper', 'tiingo-eod-gld', 'tiingo-fx-audjpy',
    'okx-candles-btc', 'okx-ratio-btc', 'okx-funding-btc', 'cftc-tff', 'cftc-bpr', 'binance-ratio-btc', 'binance-funding-btc', 'bybit-ratio-btc'];
  type Report = { ok: boolean; region: string; lines: { label: string; status: number | null; extract: unknown; error?: string }[] };

  it('une ligne par source, rien d’écrit, clé envoyée en en-tête seulement', async () => {
    const seen: string[] = [];
    const r = await explore(deps(200, KEY, seen)) as Report;
    expect(r.ok).toBe(true);
    expect(r.region).toBe('eu-central-2');
    expect(r.lines.map((l) => l.label)).toEqual(LABELS);
    expect(r.lines.find((l) => l.label === 'cftc-bpr')!.extract).toEqual({ last_months: ['2026-10', '2026-11'] });
    expect(seen.filter((s) => s.includes(KEY)).every((s) => s.includes('api.tiingo.com') && !s.split(' ')[0].includes(KEY))).toBe(true);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
  it('refus visible, clé absente du rapport', async () => {
    const r = await explore(deps(403)) as Report;
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
  it('sans clé Tiingo : lignes Tiingo en erreur, sans requête', async () => {
    const seen: string[] = [];
    const r = await explore(deps(200, '', seen)) as Report;
    expect(r.lines.filter((l) => l.label.startsWith('tiingo')).every((l) => l.error === 'TIINGO_API_KEY absente des secrets')).toBe(true);
    expect(seen.some((s) => s.includes('tiingo'))).toBe(false);
  });
  it('appel protégé par x-jobs-secret, tâche connue seulement', async () => {
    const secret = 's'.repeat(40);
    const h = createHandler((n) => (n === 'P1_JOBS_SECRET' ? secret : undefined), { ...deps(200), run: async () => ({ ok: true }) });
    const post = (job: string, s = secret) => h(new Request(`https://x/p4-jobs?job=${job}`, { method: 'POST', headers: { 'x-jobs-secret': s } }));
    expect((await post('explore')).status).toBe(200);
    expect((await post('explore', 'faux')).status).toBe(401);
    expect((await post('inconnue')).status).toBe(400);
  });
});
