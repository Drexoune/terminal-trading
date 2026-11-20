// Écran Calendrier (E2) contre la maquette Calendrier, à 1 440 px : géométrie des
// repères (±2 px ; hauteur des panneaux exclue, elle suit le nombre d'événements),
// semaine de démonstration de la fausse passerelle, filtres, fiche, et 390 px
// sans défilement horizontal. Panneau « Prochains événements » de la Vue d'ensemble.

import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compare, measure } from './geometry';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ART = fileURLToPath(new URL('./__artifacts__/', import.meta.url));
mkdirSync(ART, { recursive: true });

const LANDMARKS = {
  'barre du haut': 'body header',
  'menu latéral': 'nav[aria-label="Navigation principale"]',
  'sous-en-tête': 'main > div:first-child',
  'semaine précédente': 'button[aria-label="Semaine précédente"]',
  'semaine suivante': 'button[aria-label="Semaine suivante"]',
  'publications de la semaine': 'section[aria-label="Publications de la semaine"]',
  'fiche indicateur': 'section[aria-label^="Fiche indicateur"]',
  'réaction du BTC': 'section[aria-label="Réaction du BTC"]',
};

test('Calendrier : géométrie conforme à la maquette (x, y, largeur ±2 px)', async ({ page }) => {
  await page.goto(`file://${ROOT}design/maquettes/html/Calendrier.html`);
  await page.evaluate(() => document.fonts.ready);
  const ref = await measure(page, LANDMARKS);
  await page.goto('/calendrier');
  await expect(page.locator('.cal-row').first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  const got = await measure(page, LANDMARKS);
  const { diffs, missing } = compare(ref, got, 2, ['x', 'y', 'w']);
  writeFileSync(`${ART}Calendrier-geometry.json`, JSON.stringify({ ref, got, diffs }, null, 1));
  writeFileSync(`${ART}Calendrier-app.png`, await page.screenshot({ fullPage: true }));
  expect(missing, 'repères absents').toEqual([]);
  expect(diffs, JSON.stringify(diffs, null, 1)).toEqual([]);
});

test('Calendrier : semaine, jours à Paris, filtres, fiche, réel « — » avec sa raison', async ({ page }) => {
  await page.goto('/calendrier');
  const table = page.getByRole('region', { name: 'Publications de la semaine' });
  await expect(table.locator('.cal-row')).toHaveCount(14, { timeout: 15_000 });
  await expect(page.locator('.subheader h1')).toHaveText('Calendrier économique · Semaine 43');
  await expect(page.getByText('Heure de Paris · UTC+2')).toBeVisible();
  await expect(table.getByText('lundi 19 octobre')).toBeVisible();
  await expect(table.getByText('mardi 20 octobre').locator('..').getByText('Aujourd’hui')).toBeVisible();
  const row = table.locator('.cal-row', { hasText: 'CPI y/y' }).first();
  await expect(row).toContainText('14:30');
  await expect(row.getByLabel(/Indisponible : (pas encore publié|chiffre réel non capté)/)).toBeVisible();
  // Filtre devise : GBP seul.
  for (const c of ['USD', 'EUR', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY']) {
    await page.getByRole('group', { name: 'Devises' }).getByRole('button', { name: c }).click();
  }
  await expect(table.locator('.cal-row')).toHaveCount(2);
  await page.getByPlaceholder('Rechercher un indicateur…').fill('claimant');
  await expect(table.locator('.cal-row')).toHaveCount(1);
  await table.locator('.cal-row').first().click();
  await expect(page.getByRole('region', { name: /^Fiche indicateur Claimant Count Change/ })).toBeVisible();
});

test('Vue d’ensemble : prochains événements depuis l’agenda', async ({ page }) => {
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Prochains événements' });
  await expect(panel.locator('li')).toHaveCount(5, { timeout: 15_000 });
  // Horloge de démonstration : 20/10/2026 13:36 UTC ; l'IPC canadien (14:30 Paris) est passé.
  await expect(panel.locator('li').first()).toContainText('GBP · mer. 21 oct. · 08:00');
  await expect(panel.locator('li').first()).toContainText('Demain');
});

test('390 px : pas de défilement horizontal (calendrier)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/calendrier');
  await expect(page.locator('.cal-row').first()).toBeVisible({ timeout: 15_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  writeFileSync(`${ART}Calendrier-390.png`, await page.screenshot({ fullPage: true }));
  expect(overflow).toBeLessThanOrEqual(0);
});
