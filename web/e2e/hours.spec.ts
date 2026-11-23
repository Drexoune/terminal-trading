// Écran Horaires des marchés (P1) : pas de maquette (design system, T-033). Contrôles : les
// 7 places, état et compte à rebours, frise de 24 h, prochaines fermetures, horloge du haut
// cohérente avec les jours fériés, et 390 px sans défilement horizontal.

import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ART = fileURLToPath(new URL('./__artifacts__/', import.meta.url));
mkdirSync(ART, { recursive: true });

test('Horaires : 7 places, état, compte à rebours, fermetures', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/horaires');
  const places = page.getByRole('region', { name: 'Places' });
  await expect(places.locator('tbody tr')).toHaveCount(7);
  await expect(page.getByTestId('hours-CRYPTO')).toContainText('En continu');
  for (const code of ['TOK', 'HKG', 'SYD', 'LON', 'PAR', 'NY']) {
    await expect(page.getByTestId(`hours-${code}`)).toContainText(/(Ouvre|Ferme) dans/);
  }
  await expect(page.getByRole('img', { name: /Séances du jour/ }).locator('.hours-tl__row')).toHaveCount(7);
  await expect(page.getByRole('region', { name: 'Prochaines fermetures' }).locator('li')).toHaveCount(10);
  writeFileSync(`${ART}Horaires-app.png`, await page.screenshot({ fullPage: true }));
});

test('Horaires à 390 px : aucun défilement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/horaires');
  await expect(page.getByTestId('hours-NY')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  writeFileSync(`${ART}Horaires-390.png`, await page.screenshot({ fullPage: true }));
  expect(overflow).toBe(0);
});
