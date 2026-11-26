// Écrans de P7 (T-075) : saisonnalité, heatmap technique, indicateurs, options BTC, recherche
// bancaire. Données servies par une fausse route /api/p1/analysis, construites par nos propres
// calculs (seasonality, ta, options) sur des séries connues ; « — » motivés ; 390 px sans
// défilement horizontal.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { snapshotOptions, type SummaryRow } from '../src/analysis/options';
import { seasonality, type Bar } from '../src/analysis/seasonality';
import { snapshot } from '../src/analysis/ta';

const NOW = Date.parse('2026-11-26T10:00:00Z');
const DAY = 86_400_000;
const daily: Bar[] = Array.from({ length: 2_400 }, (_, i) => { const t = Date.parse('2020-01-01T00:00:00Z') + i * DAY, c = 100 * (1 + 0.3 * Math.sin(i / 40)) + i / 10; return { t, o: c * 0.995, h: c * 1.01, l: c * 0.99, c }; });
const hourly: Bar[] = Array.from({ length: 2_000 }, (_, i) => { const t = NOW - (2_000 - i) * 3_600_000; return { t, o: 100, h: 101, l: 99, c: 100 + Math.sin(i) }; });
const fx = JSON.parse(readFileSync(new URL('../src/analysis/fixtures/deribit-btc-2026-11-25.json', import.meta.url), 'utf8')) as { summary_ts: number; rows: SummaryRow[] };
const opt = snapshotOptions(fx.rows, 59_886.62, 54.92, fx.summary_ts);
const cell = (tf: string, bars: Bar[]) => ({ tf, snap: snapshot(bars, 252), reason: null, bars: bars.length, last_t: bars.at(-1)!.t });
const VALUES: Record<string, unknown> = {
  'season:BTC': seasonality('BTC', 'BTC/USDT', 'OKX (BTC-USDT, bougies UTC)', daily, hourly, NOW),
  'season:SPY': seasonality('SPY', 'SPY (substitut du S&P 500)', 'Tiingo, cours ajustés', daily, [], NOW),
  tech: { tfs: ['1H', '4H', '1D', '1W'], computed_ms: NOW, assets: [
    { asset: 'BTC', label: 'BTC/USDT', source: 'OKX, bougies publiques', closes: daily.slice(-120).map((b) => [b.t, b.c]), cells: ['1H', '4H', '1D', '1W'].map((tf) => cell(tf, daily)) },
    { asset: 'EURUSD', label: 'EUR/USD', source: 'Tiingo FX', closes: [], cells: ['1H', '4H', '1D', '1W'].map((tf) => ({ tf, snap: null, reason: 'historique non collecté : l’offre gratuite de Tiingo sert déjà la watchlist (T-051)', bars: 0, last_t: null })) },
  ] },
  options: { ...opt, at: NOW - 60_000, source: 'Deribit' },
  'options-history': { computed_ms: NOW, dvol: Array.from({ length: 200 }, (_, i) => [NOW - (200 - i) * 3_600_000, 50 + Math.sin(i / 10)]), points: [
    { t: NOW - 7_200_000, index: 60_000, dvol: 54, atm30: 50, rr25: -2, bf25: 1, pcr: 0.6 }, { t: NOW - 3_600_000, index: 60_100, dvol: 55, atm30: 51, rr25: -1.5, bf25: 1, pcr: 0.6 }] },
  research: { source: 'ING THINK', url: 'https://think.ing.com/rss/', fetched_ms: NOW, ok: true, error: null, items: [
    { id: 'https://think.ing.com/articles/a/', title: 'FX Daily: Full EMFX unwind underway', link: 'https://think.ing.com/articles/a/', summary: 'Emerging market currencies are under pressure.', topic: 'FX', published_ms: NOW - 3_600_000, seen_ms: NOW } ] },
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.route('**/api/p1/analysis?*', (r) => {
    const key = new URL(r.request().url()).searchParams.get('key')!;
    const value = VALUES[key] ?? null;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, value, updated_ms: value ? NOW - 60_000 : null, computed_ms: NOW }) });
  });
});

test('Saisonnalité : mois, heures de Paris, ETF sans horaire motivé', async ({ page }) => {
  await page.goto('/saisonnalite');
  await expect(page.getByTestId('season-months').locator('tbody tr')).toHaveCount(12);
  await expect(page.getByTestId('season-hours').locator('tbody tr')).toHaveCount(24);
  await expect(page.locator('[data-screen="season"]')).toContainText('MAJ');
  await page.getByRole('button', { name: 'SPY' }).click();
  await expect(page.locator('[data-screen="season"]')).toContainText('pas de bougies horaires gratuites');
  await page.getByRole('button', { name: 'ETH' }).click();
  await expect(page.locator('[data-screen="season"]')).toContainText('pas encore calculé');
});

test('Heatmap technique : tendances, « — » motivés, lien vers les indicateurs', async ({ page }) => {
  await page.goto('/heatmap-technique');
  const t = page.getByTestId('techmap');
  await expect(t.locator('tbody tr')).toHaveCount(2);
  await expect(t.locator('tbody tr').nth(0).locator('.cell')).toHaveCount(4);
  await expect(t.locator('tbody tr').nth(1).locator('.an-na').first()).toHaveAttribute('title', /T-051/);
  await t.getByRole('link', { name: 'BTC/USDT' }).click();
  await expect(page).toHaveURL(/indicateurs\?actif=BTC/);
  await expect(page.getByTestId('indicators').locator('tbody tr')).toHaveCount(4);
  await expect(page.getByTestId('indicators-signals').locator('li')).toHaveCount(5);
});

test('Options BTC : indicateurs à 30 jours, structure par terme, échéance choisie', async ({ page }) => {
  await page.goto('/options');
  await expect(page.getByTestId('options-kpis')).toContainText('54,9');            // DVOL
  await expect(page.getByTestId('options-term').locator('tbody tr')).toHaveCount(3);
  await page.getByTestId('options-term').locator('tbody tr').nth(2).getByRole('button').click();
  await expect(page.getByTestId('options-term').locator('tbody tr').nth(2)).toHaveClass(/an-sel/);
  await expect(page.locator('[data-screen="options"]')).toContainText('Historique · 90 jours');
});

test('Recherche bancaire : titre, lien vers ING, résumé', async ({ page }) => {
  await page.goto('/recherche');
  const link = page.getByTestId('research-list').getByRole('link', { name: 'FX Daily: Full EMFX unwind underway' });
  await expect(link).toHaveAttribute('href', 'https://think.ing.com/articles/a/');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByTestId('research-list')).toContainText('Emerging market currencies');
});

for (const path of ['/saisonnalite', '/heatmap-technique', '/indicateurs', '/options', '/recherche']) {
  test(`${path} à 390 px : aucun défilement horizontal`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await page.waitForTimeout(600);
    const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw).toBeLessThanOrEqual(w);
  });
}
