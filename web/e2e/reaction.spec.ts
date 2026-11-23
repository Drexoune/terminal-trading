// Suites de la capture (E3) : réaction du BTC de −5 à +30 min et révision lue par l'API v1,
// sur l'écran Calendrier. La fausse passerelle publie une réaction de démonstration
// (POST /test/reaction) ; DELETE la retire et rétablit la semaine de la maquette.

import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GW = 'http://127.0.0.1:8790';
const ART = fileURLToPath(new URL('./__artifacts__/', import.meta.url));
mkdirSync(ART, { recursive: true });

test.afterEach(async ({ request }) => {
  await request.delete(`${GW}/test/reaction`);
});

test('sans réaction enregistrée : « — » et la raison', async ({ page }) => {
  await page.goto('/calendrier');
  const panel = page.getByRole('region', { name: 'Réaction du BTC' });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('[data-testid="cal-btc-line"]')).toHaveCount(0);
  await expect(panel).toContainText('—');
});

test('réaction du BTC et révision affichées pour la publication choisie', async ({ page, request }) => {
  await page.goto('/calendrier');
  await expect(page.locator('.cal-row').first()).toBeVisible({ timeout: 15_000 });
  expect((await request.post(`${GW}/test/reaction`)).ok()).toBeTruthy();
  const table = page.getByRole('region', { name: 'Publications de la semaine' });
  await table.locator('.cal-row', { hasText: 'Chicago Fed' }).first().click();

  const panel = page.getByRole('region', { name: 'Réaction du BTC' });
  await expect(panel.locator('[data-testid="cal-btc-change"]')).toHaveText('−0,93 %');
  await expect(panel.locator('[data-testid="cal-btc-change"]')).toHaveClass(/tone-down/);
  await expect(panel.locator('[data-testid="cal-btc-line"]')).toHaveCount(1);
  await expect(panel.locator('[data-testid="cal-btc-caption"]'))
    .toContainText('BTC-USDT perp OKX DÉMO, du 19/10/2026 14:25 au 15:00 (heure de Paris)');
  await expect(panel).toContainText('Publication');

  const card = page.getByRole('region', { name: /^Fiche indicateur/ });
  await expect(card.locator('[data-testid="cal-card-revision"]')).toHaveText('révisé à 3,8 % (API v1 du BLS, lu le 19/10/2026)');
  await expect(card.locator('.cal-card__big')).toHaveText('3,7 %');  // la première publication reste

  // Horloge calée sur la fausse passerelle (premier pong) avant la capture : sinon les données
  // de démonstration du 20/10 paraissent périmées à l'heure réelle.
  await expect(page.locator('body header')).not.toContainText(/périmé/i, { timeout: 10_000 });
  // Le panneau garde la hauteur de la maquette (185 px au moins), rien ne déborde.
  const box = await panel.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(185);
  writeFileSync(`${ART}Calendrier-reaction.png`, await page.screenshot({ fullPage: true }));
});

test('390 px : réaction du BTC sans défilement horizontal', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/calendrier');
  await expect(page.locator('.cal-row').first()).toBeVisible({ timeout: 15_000 });
  await request.post(`${GW}/test/reaction`);
  await page.locator('.cal-row', { hasText: 'Chicago Fed' }).first().click();
  const panel = page.getByRole('region', { name: 'Réaction du BTC' });
  await expect(panel.locator('[data-testid="cal-btc-line"]')).toHaveCount(1);
  await panel.scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  writeFileSync(`${ART}Calendrier-reaction-390.png`, await panel.screenshot());
  expect(overflow).toBeLessThanOrEqual(0);
});
