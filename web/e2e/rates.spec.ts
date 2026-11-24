// Écran Taux (P2, R3) contre la maquette Taux, à 1 440 px : géométrie des repères (±2 px ; hauteur
// des panneaux exclue, elle suit le contenu), données fictives de la fausse passerelle (chiffres de
// la maquette), futures « — » avec leur raison, onglets, et 390 px sans défilement horizontal.

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
  'onglets': '[role="group"][aria-label="Banque centrale"]',
  'trajectoire implicite': 'section[aria-label="Trajectoire implicite"]',
  'prochaine réunion': 'section[aria-label="Prochaine réunion"]',
  'évolution des probabilités': 'section[aria-label="Évolution des probabilités"]',
  'comités et votes': 'section[aria-label="Comités et votes"]',
};

test('Taux : géométrie conforme à la maquette (x, y, largeur ±2 px)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1302 });
  await page.goto(`file://${ROOT}design/maquettes/html/Taux.html`);
  await page.evaluate(() => document.fonts.ready);
  const ref = await measure(page, LANDMARKS);
  await page.goto('/taux');
  await expect(page.locator('.rt-key')).toHaveText('4,00 %', { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  const got = await measure(page, LANDMARKS);
  const { diffs, missing } = compare(ref, got, 2, ['x', 'y', 'w']);
  writeFileSync(`${ART}Taux-geometry.json`, JSON.stringify({ ref, got, diffs }, null, 1));
  writeFileSync(`${ART}Taux-app.png`, await page.screenshot({ fullPage: true }));
  expect(missing, 'repères absents').toEqual([]);
  expect(diffs, JSON.stringify(diffs, null, 1)).toEqual([]);
});

test('Taux : chiffres de la démonstration, futures « — », onglets et comités', async ({ page }) => {
  await page.goto('/taux');
  await expect(page.locator('.rt-key')).toHaveText('4,00 %', { timeout: 15_000 });
  await expect(page.getByText('Fourchette 3,75 – 4,00 %')).toBeVisible();
  const path = page.getByRole('region', { name: 'Trajectoire implicite' });
  await expect(path).toContainText('Fin de période 4,42 %');
  await expect(path).toContainText('DÉC. 27');
  const next = page.getByRole('region', { name: 'Prochaine réunion' });
  await expect(next).toContainText('FOMC · 28/10/2026');
  await expect(next).toContainText('Écart max 2,4 pts · seuil 5');
  await expect(next.locator('[data-outcome="hold"]')).toContainText('86,5');
  await expect(next.getByLabel(/Indisponible : aucun flux gratuit de futures/).first()).toBeVisible();
  const hist = page.getByRole('region', { name: 'Évolution des probabilités' });
  await expect(hist).toContainText('NFP 02/10');
  await expect(hist).toContainText('IPC 15/10');
  const cm = page.getByRole('region', { name: 'Comités et votes' });
  await expect(cm.getByTestId('cm-FED')).toContainText('9–3 · 3 pour le statu quo');
  await expect(cm.getByTestId('cm-BCE')).toContainText('Non publié');
  await page.getByRole('group', { name: 'Banque centrale' }).getByRole('button', { name: 'BCE' }).click();
  await expect(page).toHaveURL(/banque=BCE/);
  await expect(page.locator('.subheader h1')).toHaveText('Probabilités de taux · BCE');
  await expect(page.getByRole('region', { name: 'Prochaine réunion' }).getByLabel(/Indisponible : marché non coté chez Kalshi/).first()).toBeVisible();
  await expect(cm.getByTestId('cm-BCE')).toHaveClass(/rt-cm--on/);
});

test('Taux à 390 px : aucun défilement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/taux');
  await expect(page.locator('.rt-key')).toHaveText('4,00 %', { timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Évolution des probabilités' })).toContainText('NFP');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  writeFileSync(`${ART}Taux-390.png`, await page.screenshot({ fullPage: true }));
  expect(overflow).toBe(0);
});
