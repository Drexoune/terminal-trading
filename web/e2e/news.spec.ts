// Écran Fil d'actus (E6/O6) contre la maquette Actus, à 1 440 px : géométrie des repères
// (±2 px ; hauteur exclue, elle suit le nombre de titres), titres de démonstration de la fausse
// passerelle, filtres, lecture, panneau « Titres urgents », et 390 px sans défilement horizontal.

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
  'entrée active du menu': 'nav [aria-current="page"]',
  'sous-en-tête': 'main > div:first-child',
  'fil d’actus': 'section[aria-label="Fil d’actus"]',
  'article': 'section[aria-label="Article"]',
  'assistant': 'section[aria-label="Assistant"]',
};

test('Actus : géométrie conforme à la maquette (x, y, largeur ±2 px)', async ({ page }) => {
  await page.goto(`file://${ROOT}design/maquettes/html/Actus.html`);
  await page.evaluate(() => document.fonts.ready);
  const ref = await measure(page, LANDMARKS);
  await page.goto('/actus');
  await expect(page.locator('.news-row').first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  const got = await measure(page, LANDMARKS);
  const { diffs, missing } = compare(ref, got, 2, ['x', 'y', 'w']);
  writeFileSync(`${ART}Actus-geometry.json`, JSON.stringify({ ref, got, diffs }, null, 1));
  writeFileSync(`${ART}Actus-app.png`, await page.screenshot({ fullPage: true }));
  expect(missing, 'repères absents').toEqual([]);
  expect(diffs, JSON.stringify(diffs, null, 1)).toEqual([]);
});

test('Actus : titres en VO, filtres, lecture avec heures de la source et de lecture', async ({ page }) => {
  await page.goto('/actus');
  const list = page.getByRole('list', { name: 'Titres' });
  await expect(list.locator('.news-row')).toHaveCount(8, { timeout: 15_000 });
  await expect(list.locator('.news-row').first()).toContainText('Spot bitcoin ETFs');
  await expect(page.getByRole('region', { name: 'Article' })).toContainText('Spot bitcoin ETFs');
  await page.getByRole('group', { name: 'Catégories' }).getByRole('button', { name: 'Banque centrale' }).click();
  await expect(list.locator('.news-row')).toHaveCount(2);
  await list.locator('.news-row', { hasText: 'Statement on Monetary Policy' }).click();
  const article = page.getByRole('region', { name: 'Article' });
  await expect(article.getByRole('heading', { name: 'Statement on Monetary Policy' })).toBeVisible();
  await expect(article).toContainText('Fort impact');
  await expect(article).toContainText('Lu par Supabase');
  await expect(article).toContainText('decision:BOJ');
  await page.getByRole('group', { name: 'Catégories' }).getByRole('button', { name: 'Tout' }).click();
  await page.getByPlaceholder('Filtrer les titres…').fill('cpi');
  await expect(list.locator('.news-row')).toHaveCount(1);
  await list.locator('.news-row').first().click();
  await expect(article.getByLabel('Chiffre publié')).toContainText('0.3%');
  await expect(article.getByLabel(/aucun résumé dans le flux/)).toBeVisible();
});

test('Vue d’ensemble : Titres urgents = 4 derniers titres à fort impact', async ({ page }) => {
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Titres urgents' });
  await expect(panel.locator('li')).toHaveCount(3, { timeout: 15_000 });
  await expect(panel.locator('li').first()).toContainText('Statement on Monetary Policy');
});

test('Actus à 390 px : aucun défilement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/actus');
  await expect(page.locator('.news-row').first()).toBeVisible({ timeout: 15_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  writeFileSync(`${ART}Actus-390.png`, await page.screenshot({ fullPage: true }));
  expect(overflow).toBe(0);
});
