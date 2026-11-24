// Heatmap fondamentale (P3, M5) contre la maquette Heatmap, à 1 440 px : géométrie des repères
// (±2 px ; hauteur des panneaux exclue), données fictives de la fausse passerelle (chiffres de la
// maquette), sélection d'une devise, paire et lecture citée, et 390 px sans défilement horizontal.

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
  'classement relatif': 'section[aria-label="Classement relatif"]',
  'fiche devise': 'section[aria-label="Fiche devise"]',
  'matrice fondamentale': 'section[aria-label="Matrice fondamentale"]',
  'lecture fondamentale': 'section[aria-label="Lecture fondamentale"]',
  'comparateur de paire': 'section[aria-label="Comparateur de paire"]',
};

test('Heatmap : géométrie conforme à la maquette (x, y, largeur ±2 px)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1281 });
  await page.goto(`file://${ROOT}design/maquettes/html/Heatmap.html`);
  await page.evaluate(() => document.fonts.ready);
  const ref = await measure(page, LANDMARKS);
  await page.goto('/heatmap?devise=JPY');
  await expect(page.locator('.hm-key')).toHaveText('1,25 %', { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  const got = await measure(page, LANDMARKS);
  const { diffs, missing } = compare(ref, got, 2, ['x', 'y', 'w']);
  writeFileSync(`${ART}Heatmap-geometry.json`, JSON.stringify({ ref, got, diffs }, null, 1));
  writeFileSync(`${ART}Heatmap-app.png`, await page.screenshot({ fullPage: true }));
  expect(missing, 'repères absents').toEqual([]);
  expect(diffs, JSON.stringify(diffs, null, 1)).toEqual([]);
});

test('Heatmap : classement, matrice, paire JPY / USD, lecture citée, outil de contexte', async ({ page }) => {
  await page.goto('/heatmap?devise=JPY');
  const rank = page.getByRole('region', { name: 'Classement relatif' });
  await expect(rank.locator('.hm-rk').first()).toContainText('AUD', { timeout: 15_000 });
  await expect(rank.locator('.hm-rk').first()).toContainText('+58');
  await expect(page.getByRole('region', { name: 'Fiche devise' })).toContainText('JPY · Banque du Japon');
  await expect(page.getByRole('region', { name: 'Fiche devise' })).toContainText('Dernier mouvement · HIKE');
  await expect(page.getByTestId('mx-JPY')).toContainText('1,25 %');
  const pairPanel = page.getByRole('region', { name: 'Comparateur de paire' });
  await expect(pairPanel).toContainText('Paire JPY / USD');
  await expect(pairPanel).toContainText('−2,75');
  await expect(pairPanel).toContainText('Les fondamentaux favorisent l’USD');
  await expect(page.getByRole('region', { name: 'Lecture fondamentale' })).toContainText('JPY : biais bearish, score relatif −65');
  await expect(page.getByText('Outil de contexte · non démontré')).toBeVisible();
  await rank.getByRole('button', { name: /USD/ }).click();
  await expect(page).not.toHaveURL(/devise=/);
  await expect(page.getByRole('region', { name: 'Comparateur de paire' })).toContainText('Paire USD / EUR');
});

test('Heatmap à 390 px : aucun défilement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/heatmap?devise=JPY');
  await expect(page.locator('.hm-key')).toHaveText('1,25 %', { timeout: 15_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  writeFileSync(`${ART}Heatmap-390.png`, await page.screenshot({ fullPage: true }));
  expect(overflow).toBe(0);
});
