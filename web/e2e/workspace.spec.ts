// Espace de travail (dockview) : bouton « Personnaliser », modèle par défaut, ajout d'un écran,
// mise en page enregistrée et reprise après rechargement, panneaux liés par l'actif, 390 px.
import { expect, test } from '@playwright/test';
import { seasonality, type Bar } from '../src/analysis/seasonality';
import { snapshot } from '../src/analysis/ta';

const NOW = Date.parse('2026-11-26T10:00:00Z');
const DAY = 86_400_000;
const daily: Bar[] = Array.from({ length: 900 }, (_, i) => { const c = 100 + i / 5 + 10 * Math.sin(i / 30); return { t: Date.parse('2024-01-01T00:00:00Z') + i * DAY, o: c, h: c * 1.01, l: c * 0.99, c }; });
const tech = { tfs: ['1H', '4H', '1D', '1W'], computed_ms: NOW, assets: ['BTC', 'ETH'].map((a) => ({ asset: a, label: `${a}/USDT`, source: 'OKX', closes: [],
  cells: ['1H', '4H', '1D', '1W'].map((tf) => ({ tf, snap: snapshot(daily, 252), reason: null, bars: 900, last_t: NOW })) })) };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/p1/analysis?*', (r) => {
    const key = new URL(r.request().url()).searchParams.get('key')!;
    const value = key === 'tech' ? tech : key.startsWith('season:') ? seasonality(key.slice(7), key.slice(7), 'test', daily, [], NOW) : null;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, value, updated_ms: NOW, computed_ms: NOW }) });
  });
});

test('Personnaliser ouvre l’espace ; modèle par défaut ; ajouter, enregistrer, recharger', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Personnaliser l’espace de travail' }).click();
  await expect(page).toHaveURL(/\/espace$/);
  const tabs = page.locator('.dv-tab');
  await expect(tabs).toHaveCount(4);                                   // modèle « Séance BTC »
  await expect(page.locator('.dv-tab').filter({ hasText: 'Microstructure BTC' })).toHaveCount(1);
  await page.getByLabel('Écran').selectOption('techmap');
  await page.getByRole('button', { name: 'Ajouter' }).click();
  await expect(tabs).toHaveCount(5);
  await page.getByLabel('Nom').fill('Ma séance');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.locator('.ws-msg')).toContainText('« Ma séance » enregistrée');
  await page.reload();
  await expect(page.locator('.dv-tab')).toHaveCount(5);                // disposition en cours reprise
  await page.getByRole('button', { name: 'Vider' }).click();
  await expect(page.locator('.dv-tab')).toHaveCount(0);
  await page.getByLabel('Ouvrir une mise en page').selectOption('Ma séance');
  await expect(page.locator('.dv-tab')).toHaveCount(5);
});

test('panneaux liés : l’actif choisi s’applique aux indicateurs et à la saisonnalité', async ({ page }) => {
  await page.goto('/espace');
  await page.getByLabel('Ouvrir un modèle').selectOption('tech');
  await expect(page.locator('.dv-tab')).toHaveCount(3);
  const ind = page.locator('[data-screen="indicators"]');
  const season = page.locator('[data-screen="season"]');
  await expect(ind.getByTestId('indicators')).toBeVisible();
  await page.getByTestId('ws-asset').selectOption('ETH');
  await expect(page.locator('.subheader select').first()).toHaveValue('ETH');
  await expect(page.getByRole('button', { name: 'ETH', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-screen="techmap"]').getByRole('button', { name: 'BTC/USDT' }).click();
  await expect(page.getByTestId('ws-asset')).toHaveValue('BTC');
  await expect(page.getByRole('button', { name: 'BTC', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(season).toBeVisible();
});

test('390 px : liste des écrans, aucun défilement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/espace');
  await expect(page.locator('[data-screen="workspace"]')).toContainText('se compose sur un écran large');
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(w);
});
