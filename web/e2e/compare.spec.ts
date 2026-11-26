// Comparer deux actifs (1 an) et onglets Nasdaq 100 des pages BTC : séries quotidiennes simulées
// (/api/p1/daily), mesures affichées, choix dans l'adresse, « — » motivés, 390 px.
import { expect, test } from '@playwright/test';

const DAY = 86_400_000;
const series = (asset: string) => {
  const n = 380, start = Date.parse('2025-11-10T00:00:00Z');
  const k = { BTC: 0.0015, QQQ: 0.0008, VXN: 0, VIX: 0 }[asset] ?? 0.0005;
  const base = { BTC: 60_000, QQQ: 500, VXN: 24, VIX: 18 }[asset] ?? 100;
  return Array.from({ length: n }, (_, i) => {
    const c = base * (1 + k * i + 0.02 * Math.sin(i / 7 + (asset === 'BTC' ? 0 : 1)));
    return { d: new Date(start + i * DAY).toISOString().slice(0, 10), o: c * 0.995, h: c * 1.01, l: c * 0.99, c };
  });
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/p1/daily?*', (r) => {
    const asset = new URL(r.request().url()).searchParams.get('asset')!;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, asset, label: asset, source: 'test', points: series(asset), computed_ms: Date.now() }) });
  });
});

test('Comparer : BTC contre QQQ par défaut, mesures, inversion, choix gardé dans l’adresse', async ({ page }) => {
  await page.goto('/comparer');
  const stats = page.getByTestId('cmp-stats');
  await expect(stats.locator('tbody tr')).toHaveCount(2);
  await expect(stats.locator('tbody tr').first()).toContainText('Bitcoin');
  await expect(page.getByTestId('cmp-corr')).toContainText(/\d,\d\d/);
  await page.getByRole('button', { name: 'Inverser A et B' }).click();
  await expect(page).toHaveURL(/a=QQQ&b=BTC/);
  await expect(stats.locator('tbody tr').first()).toContainText('Nasdaq 100');
  await page.getByTestId('cmp-b').selectOption('GLD');
  await expect(page).toHaveURL(/b=GLD/);
});

test('onglets Nasdaq 100 : Graphiques, Microstructure, Options', async ({ page }) => {
  await page.goto('/graphiques');
  await page.getByRole('button', { name: 'Nasdaq 100' }).click();
  await expect(page).toHaveURL(/marche=nasdaq/);
  await expect(page.getByRole('img', { name: 'Bougies quotidiennes du QQQ sur un an' })).toBeVisible();
  await page.goto('/microstructure?marche=nasdaq');
  await expect(page.getByTestId('nq-missing').locator('tbody tr')).toHaveCount(5);
  await expect(page.getByTestId('nq-missing')).toContainText('Liquidations');
  await page.getByRole('button', { name: 'BTC', exact: true }).click();
  await expect(page.locator('[data-screen="micro"]')).toBeVisible();
  await page.goto('/options?marche=nasdaq');
  await expect(page.getByTestId('nq-vxn')).toContainText('VXN');
  await expect(page.locator('[data-screen="options-nasdaq"]')).toContainText('aucune source gratuite autorisée');
});

for (const path of ['/comparer', '/graphiques?marche=nasdaq', '/microstructure?marche=nasdaq', '/options?marche=nasdaq']) {
  test(`${path} à 390 px : aucun défilement horizontal`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await page.waitForTimeout(700);
    const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw).toBeLessThanOrEqual(w);
  });
}
