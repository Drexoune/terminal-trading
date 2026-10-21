// Comparaison de chaque écran à sa maquette, à 1440 px :
//  1. géométrie des repères mesurée sur la maquette HTML et sur l'application (±2 px, bloquant) ;
//  2. écart en pixels contre le PNG (pixelmatch), indicatif, avec image d'écart et côte à côte ;
//  3. aucune barre de défilement horizontale à 390 px.
// Les artefacts sont écrits dans e2e/__artifacts__/ pour la revue visuelle.

import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { MAIN_LANDMARKS, compare, measure } from './geometry';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ART = fileURLToPath(new URL('./__artifacts__/', import.meta.url));
mkdirSync(ART, { recursive: true });

const mockupHtml = (name: string) => `file://${ROOT}design/maquettes/html/${name}.html`;
const mockupPng = (name: string) => `${ROOT}design/maquettes/png/${name}.png`;

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

/** Attend que la passerelle de démo ait servi le prix et la synchro d'horloge. */
async function waitForLive(page: Page) {
  await expect(page.getByTestId('btc-last')).toHaveText(/\d/, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: /OKX \d+/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.chart-empty')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(1_500); // bandes et sparklines positionnées
}

function pixelReport(name: string, shot: Buffer) {
  const ref = PNG.sync.read(readFileSync(mockupPng(name)));
  const got = PNG.sync.read(shot);
  const w = ref.width;
  const h = Math.min(ref.height, got.height);
  const crop = (img: PNG) => {
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(img, out, 0, 0, Math.min(w, img.width), h, 0, 0);
    return out;
  };
  const a = crop(ref);
  const b = crop(got);
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(a.data, b.data, diff.data, w, h, { threshold: 0.15 });
  const side = new PNG({ width: w * 2 + 8, height: h });
  PNG.bitblt(a, side, 0, 0, w, h, 0, 0);
  PNG.bitblt(b, side, 0, 0, w, h, w + 8, 0);
  writeFileSync(`${ART}${name}-app.png`, shot);
  writeFileSync(`${ART}${name}-diff.png`, PNG.sync.write(diff));
  writeFileSync(`${ART}${name}-side-by-side.png`, PNG.sync.write(side));
  return { differentPixels: n, ratio: n / (w * h), refHeight: ref.height, appHeight: got.height };
}

test('Vue d’ensemble : géométrie conforme à Main (±2 px)', async ({ page }) => {
  await page.goto(mockupHtml('Main'));
  await settle(page);
  const ref = await measure(page, MAIN_LANDMARKS);

  await page.goto('/');
  await waitForLive(page);
  const got = await measure(page, MAIN_LANDMARKS);
  const result = compare(ref, got, 2);
  const shot = await page.screenshot({ fullPage: true });
  const pixels = pixelReport('Main', shot);
  writeFileSync(`${ART}Main-geometry.json`, JSON.stringify({ ref, got, ...result, pixels }, null, 1));

  expect(result.missing, 'repères absents').toEqual([]);
  expect(result.diffs, JSON.stringify(result.diffs, null, 1)).toEqual([]);
});

test('Design system : géométrie conforme à DesignSystem (±2 px)', async ({ page }) => {
  const landmarks = {
    'en-tête': 'body header',
    couleurs: 'section[aria-labelledby="ds-col"]',
    typographie: 'section[aria-labelledby="ds-typo"]',
    composants: 'section[aria-labelledby="ds-comp"]',
  };
  await page.goto(mockupHtml('DesignSystem'));
  await settle(page);
  const ref = await measure(page, landmarks);
  await page.goto('/design-system');
  await settle(page);
  const got = await measure(page, landmarks);
  const result = compare(ref, got, 2);
  const pixels = pixelReport('DesignSystem', await page.screenshot({ fullPage: true }));
  writeFileSync(`${ART}DesignSystem-geometry.json`, JSON.stringify({ ref, got, ...result, pixels }, null, 1));
  expect(result.missing).toEqual([]);
  expect(result.diffs, JSON.stringify(result.diffs, null, 1)).toEqual([]);
});

for (const path of ['/', '/graphiques', '/taux', '/design-system']) {
  test(`390 px : pas de défilement horizontal sur ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await settle(page);
    await page.waitForTimeout(1_000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (path === '/') writeFileSync(`${ART}Main-390.png`, await page.screenshot({ fullPage: true }));
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
