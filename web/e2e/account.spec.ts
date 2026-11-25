// Compte (P6, S5) : Track record (session et journal simulés), calculateur de risque (calcul local),
// règles d'une société de financement, 390 px sans défilement horizontal.
import { expect, test } from '@playwright/test';

const NOW = Date.parse('2026-11-25T20:00:00Z');
const trades = [
  { id: 2, opened_ms: NOW - 7_200_000, closed_ms: NOW - 3_600_000, asset: 'BTC', side: 'long', qty: 0.5, entry: 60000, exit: 61000, stop: 59500, fees: 20, setup: 'cassure', notes: null },
  { id: 1, opened_ms: NOW - 9_000_000, closed_ms: NOW - 8_000_000, asset: 'BTC', side: 'short', qty: 0.5, entry: 61000, exit: 61500, stop: 61400, fees: 20, setup: null, notes: null },
  { id: 3, opened_ms: NOW - 600_000, closed_ms: null, asset: 'ETH', side: 'long', qty: 2, entry: 3000, exit: null, stop: 2950, fees: 0, setup: null, notes: null },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/bourse/session', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: true, configured: true, expires_at: null }) }));
  await page.route('**/api/bourse/journal*', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(r.request().method() === 'GET' ? { trades, computed_ms: NOW } : { ok: true }) }));
});

test('Track record : statistiques calculées, journal, trade ouvert', async ({ page }) => {
  await page.goto('/track-record');
  const stats = page.getByTestId('track-stats');
  await expect(stats).toContainText('+210,00');                    // 480 − 270
  await expect(stats).toContainText('50,0');                       // 1 gain sur 2 clos
  await expect(page.getByTestId('track-table').locator('tbody tr')).toHaveCount(3);
  await expect(page.getByTestId('track-table')).toContainText('Ouvert');
});

test('Calculateur : taille, levier, perte au stop ; règle FTMO franchie signalée', async ({ page }) => {
  await page.goto('/calculateur');
  await page.getByLabel('Instrument').selectOption('autre');
  await page.getByLabel('Prix d’entrée').fill('60000');
  await page.getByLabel('Stop', { exact: true }).fill('59500');
  const res = page.getByTestId('calc-result');
  await expect(res).toContainText('0,2000');                       // 100 $ de risque / 500 $
  await expect(res).toContainText('100,00');
  await page.getByLabel('Société de financement').selectOption('ftmo2_p1');
  await page.getByLabel('Capital ($)').fill('100000');
  await page.getByLabel('Résultat du jour ($)').fill('-4500');
  await expect(page.getByTestId('calc-firm')).toContainText('règle franchie au stop');
});

for (const path of ['/track-record', '/calculateur']) {
  test(`${path} à 390 px : aucun défilement horizontal`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await page.waitForTimeout(500);
    const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw).toBeLessThanOrEqual(w);
  });
}
