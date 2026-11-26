// Écrans de P4 (S4) : Sentiment de risque contre la maquette Risque à 1 440 px (géométrie ±2 px,
// hauteur exclue), source et fraîcheur sur chaque panneau des cinq écrans (porte de P4), et
// 390 px sans défilement horizontal. Données fictives de la fausse passerelle (sentiment_demo.py).

import { hideGuides } from './geometry';
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
  'indice composite': 'section[aria-label="Indice de sentiment"]',
  'composantes': 'section[aria-label="Composantes"]',
  'historique': 'section[aria-label="Historique de l’indice"]',
  'graphique actions': 'section[aria-label="S&P 500"], section[aria-label="SPY"]',
  'graphique VIX': 'section[aria-label="VIX"]',
};

test('Risque : géométrie conforme à la maquette (x, y, largeur ±2 px)', async ({ page }) => {
  await hideGuides(page);                                   // la maquette n'a pas de case explicative
  await page.setViewportSize({ width: 1440, height: 1258 });
  await page.goto(`file://${ROOT}design/maquettes/html/Risque.html`);
  await page.evaluate(() => document.fonts.ready);
  const ref = await measure(page, LANDMARKS);
  await page.goto('/risque');
  await expect(page.locator('.rk-big')).toHaveText('30', { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  const got = await measure(page, LANDMARKS);
  const { diffs, missing } = compare(ref, got, 2, ['x', 'y', 'w']);
  writeFileSync(`${ART}Risque-geometry.json`, JSON.stringify({ ref, got, diffs }, null, 1));
  writeFileSync(`${ART}Risque-app.png`, await page.screenshot({ fullPage: true }));
  expect(missing, 'repères absents').toEqual([]);
  expect(diffs, JSON.stringify(diffs, null, 1)).toEqual([]);
});

test('Risque : indice, variations, composantes avec source et date, moyenne', async ({ page }) => {
  await page.goto('/risque');
  await expect(page.locator('.rk-big')).toHaveText('30', { timeout: 15_000 });
  const comp = page.getByRole('region', { name: 'Indice de sentiment' });
  await expect(comp).toContainText('RISK-OFF');
  await expect(comp).toContainText('1 S ▼ 31 · était 61');
  await expect(comp).toContainText('1 M ▼ 17 · était 47');
  await expect(page.getByTestId('rk-vix')).toContainText('20,0');
  await expect(page.getByTestId('rk-vix')).toContainText('Cboe (FRED en repli) · 19/10');
  await expect(page.getByTestId('rk-trend')).toContainText('+1,58 %');
  await expect(page.getByTestId('rk-stocks_bonds')).toContainText('+5,63 pts');
  await expect(page.getByTestId('rk-copper_gold')).toContainText('59');
  await expect(page.locator('.rk-avg-v')).toHaveText('30');
  await expect(page.getByRole('region', { name: 'SPY' })).toContainText('7 659,44');
  await expect(page.getByRole('region', { name: 'SPY' })).toContainText('Tiingo');
  await expect(page.getByRole('region', { name: 'VIX' })).toContainText('19,99');
  await page.getByRole('group', { name: 'Période' }).getByRole('button', { name: '1 M' }).click();
  await expect(page.getByRole('group', { name: 'Période' }).getByRole('button', { name: '1 M' })).toHaveAttribute('aria-pressed', 'true');
});

const SCREENS: [string, string, RegExp][] = [
  ['/risque', '.rk-big', /Cboe, Tiingo, OKX, FRED · relevé/],
  ['/cot', '[data-screen="cot"] .pn', /CFTC · relevé/],
  ['/positions-banques', '[data-screen="banks"] .pn', /CFTC BPR · relevé.*CFTC TFF · relevé/],
  ['/sentiment-retail', '[data-screen="retail"] .pn', /Binance, OKX, Bybit · relevé/],
  ['/liquidite', '[data-screen="liquidity"] .pn', /FRED · relevé/],
];

for (const [path, ready, fresh] of SCREENS) {
  test(`${path} : source et fraîcheur affichées, 390 px sans défilement horizontal`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator(ready).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.subheader')).toContainText(fresh);
    for (const pn of await page.locator('main section.pn').all()) {
      await expect(pn.locator('[data-fresh]').first(), await pn.getAttribute('aria-label') ?? '').toBeVisible();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    writeFileSync(`${ART}${path.slice(1)}-390.png`, await page.screenshot({ fullPage: true }));
    expect(overflow).toBe(0);
  });
}
