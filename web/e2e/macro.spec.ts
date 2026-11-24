// Écran Macro (P3, M5) : pas de maquette (design system, T-033). Contrôles : indicateurs des États-Unis
// avec leur source, « — » avec la raison, historique de l'indicateur choisi, onglets, et 390 px sans
// défilement horizontal. Données fictives de la fausse passerelle.

import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ART = fileURLToPath(new URL('./__artifacts__/', import.meta.url));
mkdirSync(ART, { recursive: true });

test('Macro : indicateurs, sources, « — » avec la raison, historique', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/macro');
  await expect(page.getByTestId('mc-cpi')).toContainText('3,7 %', { timeout: 15_000 });
  await expect(page.getByTestId('mc-policy')).toContainText('4,00 %');
  await expect(page.getByRole('region', { name: 'Historique' })).toContainText('Historique · IPC sur un an');
  await expect(page.locator('.mc-line')).toBeVisible();
  await page.getByRole('group', { name: 'Économie' }).getByRole('button', { name: 'NZD' }).click();
  await expect(page).toHaveURL(/eco=NZD/);
  await expect(page.getByTestId('mc-retail').getByLabel(/Indisponible : série absente/)).toBeVisible();
  await page.getByTestId('mc-unemployment').click();
  await expect(page.getByRole('region', { name: 'Historique' })).toContainText('Historique · Taux de chômage');
  writeFileSync(`${ART}Macro-app.png`, await page.screenshot({ fullPage: true }));
});

test('Macro à 390 px : aucun défilement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/macro');
  await expect(page.getByTestId('mc-cpi')).toContainText('3,7 %', { timeout: 15_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  writeFileSync(`${ART}Macro-390.png`, await page.screenshot({ fullPage: true }));
  expect(overflow).toBe(0);
});
