// Backtest (section Backtest, S1) : /api/backtest/candles servi par le jeu réel de 799 bougies
// quotidiennes BTC/USDT (OKX). Stratégie connue lancée dans le Web Worker, 8 tuiles notées dans
// l'ordre E → S, journal, erreur de syntaxe avec sa ligne dans l'éditeur, 390 px sans défilement.

import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ART = fileURLToPath(new URL('./__artifacts__/', import.meta.url));
mkdirSync(ART, { recursive: true });
const BTC = JSON.parse(readFileSync(new URL('../src/backtest/fixtures/okx-btc-1d-2024-09-16_2026-11-23.json', import.meta.url), 'utf8')) as
  { t: number; o: number; h: number; l: number; c: number }[];

async function mockCandles(page: Page) {
  await page.route('**/api/backtest/candles**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    configured: true, asset: 'BTC', tf: '1D', label: 'BTC/USDT', source: 'OKX', aggregated: null, n: BTC.length,
    t: BTC.map((b) => b.t), o: BTC.map((b) => b.o), h: BTC.map((b) => b.h), l: BTC.map((b) => b.l), c: BTC.map((b) => b.c), v: BTC.map(() => 0),
    series: { first: '2024-09-16T00:00:00Z', last: '2026-11-23T00:00:00Z', complete: true, error: null },
    feed: { name: 'bt-candles', status: 'connected', last_message_ms: Date.now() - 300_000, last_error: null, late_after_ms: 7_200_000, stale_after_ms: 108_000_000 },
    computed_ms: Date.now(),
  }) }));
}

test('Backtest : stratégie connue, tuiles notées E → S, journal', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await mockCandles(page);
  await page.goto('/backtest');
  await expect(page.getByRole('region', { name: 'Données et simulation' })).toContainText('799 bougies', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Lancer le backtest' }).click();
  const bento = page.getByRole('list', { name: 'Mesures notées' });
  await expect(bento.getByRole('listitem')).toHaveCount(8, { timeout: 30_000 });
  const grades = await bento.locator('[data-grade]').evaluateAll((els) => els.map((e) => e.getAttribute('data-grade')));
  expect(grades.join('')).toBe('EDCBBAAS');
  await expect(page.getByTestId('tile-winrate')).toContainText('Taux de réussite');
  await expect(page.getByTestId('tile-dsr')).toContainText('N = 1 essai');
  await expect(page.getByRole('region', { name: 'Journal des transactions' })).toContainText('16 trades');
  // Diagnostics (S2) : Monte Carlo, sociétés de financement, coupure dans et hors échantillon.
  await expect(page.getByTestId('mc-ruin')).toHaveText(/%$/);
  const firms = page.getByRole('region', { name: 'Sociétés de financement' });
  for (const id of ['ftmo2_p1', 'ftmo2_p2', 'ftmo1', 'lucid25']) await expect(firms.getByTestId(`firm-${id}`)).toContainText(/Réussi|Échoué|En cours/);
  await expect(firms).toContainText('LucidFlex 25K');
  await expect(firms).toContainText('consolidation non officielle');
  const sample = page.getByRole('region', { name: 'Dans et hors échantillon' });
  await expect(sample.getByTestId('split-sharpe')).toBeVisible();
  await sample.getByLabel('Part de la période dans l’échantillon').fill('50');
  await expect(sample).toContainText('Coupure : 50 %');
  writeFileSync(`${ART}Backtest-app.png`, await page.screenshot({ fullPage: true }));
  // Deuxième variante : N = 2 essais pour le Sharpe déflaté.
  await page.getByRole('region', { name: 'Paramètres' }).getByLabel('Moyenne rapide').fill('10');
  await page.getByRole('button', { name: 'Lancer le backtest' }).click();
  await expect(page.getByTestId('tile-dsr')).toContainText('N = 2 essais', { timeout: 30_000 });
});

test('Backtest : éditeur, erreur de syntaxe avec sa ligne', async ({ page }) => {
  await mockCandles(page);
  await page.goto('/backtest');
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Éditeur' }).click();
  const code = page.getByLabel('Code Pine Script de la stratégie');
  await expect(code).toBeVisible();
  await code.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('//@version=6\nstrategy("x")\nx = ta.sma(close\n');
  await expect(page.getByRole('region', { name: 'Données et simulation' })).toContainText('799 bougies', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Lancer le backtest' }).click();
  await expect(page.getByRole('alert')).toContainText('Le script ne s’exécute pas', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Aller à la ligne 4/ })).toBeVisible();
});

test('Backtest à 390 px : aucun défilement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCandles(page);
  await page.goto('/backtest');
  await expect(page.getByRole('region', { name: 'Données et simulation' })).toContainText('799 bougies', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Lancer le backtest' }).click();
  await expect(page.getByRole('list', { name: 'Mesures notées' }).getByRole('listitem')).toHaveCount(8, { timeout: 30_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  writeFileSync(`${ART}Backtest-390.png`, await page.screenshot({ fullPage: true }));
  expect(overflow).toBe(0);
});
