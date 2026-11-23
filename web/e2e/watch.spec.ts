// Markets Watch (T-051, T-052) : pas de maquette (design system, T-033). Contrôles : 9 actifs avec
// leur source, lignes sans source avec leur raison (futures, DXY), watchlist de la Vue d'ensemble
// remplie, 390 px sans défilement horizontal. Données fictives de la fausse passerelle.

import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ART = fileURLToPath(new URL('./__artifacts__/', import.meta.url));
mkdirSync(ART, { recursive: true });

test('Markets Watch : 9 actifs avec cours, futures et DXY « — » avec leur raison', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/markets-watch');
  await expect(page.getByTestId('mw-eurusd')).toContainText('1,1642', { timeout: 15_000 });
  await expect(page.getByTestId('mw-us10y')).toContainText('+3,2');
  await expect(page.getByTestId('mw-us10y')).toContainText('pb');
  await expect(page.getByTestId('mw-pust')).toContainText('51,62');
  await expect(page.getByText('9/9 actifs avec cours')).toBeVisible();
  await expect(page.getByLabel(/indice propriétaire de l’ICE/).first()).toBeVisible();
  await expect(page.getByLabel(/aucune source gratuite pour les futures/).first()).toBeVisible();
  writeFileSync(`${ART}MarketsWatch-app.png`, await page.screenshot({ fullPage: true }));
});

test('Vue d’ensemble : watchlist remplie, Dollar (Fed) à la place du DXY', async ({ page }) => {
  await page.goto('/');
  const wl = page.getByRole('region', { name: 'Watchlist' });
  await expect(wl).toContainText('1,1642', { timeout: 15_000 });
  await expect(wl).toContainText('Dollar (Fed)');
  await expect(wl).not.toContainText('DXY');
});

test('Markets Watch à 390 px : aucun défilement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/markets-watch');
  await expect(page.getByTestId('mw-eurusd')).toBeVisible({ timeout: 15_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  writeFileSync(`${ART}MarketsWatch-390.png`, await page.screenshot({ fullPage: true }));
  expect(overflow).toBe(0);
});
