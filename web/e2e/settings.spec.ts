// Écran Paramètres : accès (avatar, commande SET), bascule de mode, persistance
// sur l'appareil, retour des données de la passerelle de démo, 390 px.
// Le mode par défaut des tests est « local » vers la passerelle de démo (:8790).

import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ART = fileURLToPath(new URL('./__artifacts__/', import.meta.url));
// Domaine réservé (.invalid) : adresse acceptée par la validation, jamais résolue.
const TOUR_URL = 'https://tour.tailnet.invalid';

const radio = (page: Page, label: string) => page.getByRole('radio', { name: label, exact: true });
const applyButton = (page: Page) => page.getByRole('button', { name: 'Appliquer', exact: true });

test('l’avatar ouvre les paramètres, sans toucher au menu latéral', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('btc-last')).toHaveText(/\d/, { timeout: 15_000 });
  const avatar = page.getByRole('link', { name: 'Paramètres du terminal' });
  await expect(avatar).toHaveText('C');
  const before = await page.locator('body header').boundingBox();
  await avatar.click();
  await expect(page).toHaveURL(/\/parametres$/);
  await expect(page.locator('.subheader h1')).toHaveText('Paramètres · Mode de fonctionnement');
  await expect(radio(page, 'Mode Local')).toBeChecked();
  await expect(page.locator('.mode-card[data-mode="local"]')).toContainText('Actif');
  // Hauteur de la barre du haut inchangée ; aucune entrée du menu n'est marquée active.
  expect((await page.locator('body header').boundingBox())?.height).toBe(before?.height);
  await expect(page.locator('nav[aria-label="Navigation principale"] a')).toHaveCount(24);
  await expect(page.locator('nav [aria-current="page"]')).toHaveCount(0);
  await expect(avatar).toHaveAttribute('aria-current', 'page');
});

test('la commande SET de la palette ouvre les paramètres', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav [aria-current="page"]')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('BTC GP, USD ECO, FED WIRP…').fill('SET');
  await expect(page.locator('.palette__item[data-selected="true"]')).toContainText('SET');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/parametres$/);
  await expect(page.getByRole('group', { name: 'Mode de fonctionnement' })).toBeVisible();
});

test('Mode Tour : adresse refusée, puis appliquée et conservée ; retour au Mode Local', async ({ page }) => {
  await page.goto('/parametres');
  const apply = applyButton(page);
  await expect(apply).toBeDisabled(); // rien n'a changé

  await radio(page, 'Mode Tour').check();
  const tourUrl = page.getByLabel('Adresse de la passerelle de la tour');
  // Tour sans adresse : erreur affichée, Appliquer bloqué.
  await expect(page.locator('#gateway-tour-error')).toContainText('adresse vide');
  await expect(apply).toBeDisabled();

  // http hors de cette machine : refusé (tailscale serve fournit le https).
  await tourUrl.fill('http://tour.tailnet.ts.net');
  await expect(page.locator('#gateway-tour-error')).toContainText('http n’est accepté que vers cette machine');
  await expect(tourUrl).toHaveAttribute('aria-invalid', 'true');
  await expect(apply).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Tester le Mode Tour' })).toBeDisabled();

  await tourUrl.fill(`${TOUR_URL}/`);
  await expect(page.locator('#gateway-tour-error')).toHaveCount(0);
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.locator('.settings__hint')).toContainText('Mode Tour appliqué et enregistré sur cet appareil');
  await expect(apply).toBeDisabled();
  await expect(page.locator('.feedbar__mode')).toHaveText('Mode Tour');
  await expect(page.locator('.subheader').getByText('Mode Tour', { exact: true })).toBeVisible();

  // Tester une tour injoignable : « Injoignable : raison », sans attendre plus de 5 s.
  await page.getByRole('button', { name: 'Tester le Mode Tour' }).click();
  await expect(page.locator('.mode-card[data-mode="tour"] .probe')).toContainText('Injoignable : ', { timeout: 8_000 });

  // Le choix survit au rechargement (stockage de l'appareil), adresse normalisée.
  await page.reload();
  await expect(radio(page, 'Mode Tour')).toBeChecked();
  await expect(page.getByLabel('Adresse de la passerelle de la tour')).toHaveValue(TOUR_URL);
  await expect(page.locator('.feedbar__mode')).toHaveText('Mode Tour');

  // Vue d'ensemble en Mode Tour (tour injoignable) : aucune donnée de la passerelle locale.
  await page.getByRole('link', { name: /vue d’ensemble/i }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('btc-last').locator('.missing')).toBeVisible();
  await expect(page.locator('.feedbar').getByTitle(/^Passerelle : déconnecté/)).toBeVisible({ timeout: 15_000 });

  // Retour au Mode Local, sans recharger la page : le flux redémarre et le prix revient.
  await page.getByRole('link', { name: 'Paramètres du terminal' }).click();
  await radio(page, 'Mode Local').check();
  await expect(page.getByLabel('Adresse de la passerelle du Mac')).toHaveValue('http://127.0.0.1:8790');
  await applyButton(page).click();
  await expect(page.locator('.feedbar__mode')).toHaveText('Mode Local');
  await page.getByRole('link', { name: /vue d’ensemble/i }).first().click();
  await expect(page.getByTestId('btc-last')).toHaveText(/\d/, { timeout: 15_000 });
  await expect(page.locator('.chart-empty')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.subheader')).toContainText('Démo · tests · Mode Local');
  await expect(page.locator('.feedbar').getByTitle('Passerelle : connecté')).toBeVisible({ timeout: 15_000 });
});

test('Tester le Mode Local : passerelle de démo joignable', async ({ page }) => {
  await page.goto('/parametres');
  await page.getByRole('button', { name: 'Tester le Mode Local' }).click();
  await expect(page.locator('.mode-card[data-mode="local"] .probe'))
    .toContainText(/Joignable · \d+\s?ms · 127\.0\.0\.1:8790/, { timeout: 8_000 });
});

test('accessibilité : radios, champs étiquetés, boutons nommés, un seul bouton or', async ({ page }) => {
  await page.goto('/parametres');
  await expect(page.getByRole('radio')).toHaveCount(3);
  for (const label of ['Mode Online', 'Mode Local', 'Mode Tour']) await expect(radio(page, label)).toBeVisible();
  const unlabeled = await page.locator('main input').evaluateAll((inputs) => inputs
    .filter((i) => !(i as HTMLInputElement).labels?.length && !i.getAttribute('aria-label'))
    .map((i) => i.outerHTML.slice(0, 80)));
  expect(unlabeled).toEqual([]);
  const unnamed = await page.locator('button, a').evaluateAll((els) => els
    .filter((b) => !(b.getAttribute('aria-label') || b.textContent?.trim()))
    .map((b) => b.outerHTML.slice(0, 80)));
  expect(unnamed).toEqual([]);
  await expect(page.locator('main .btn--primary')).toHaveCount(1);
  // Au clavier : les flèches parcourent le groupe radio.
  await radio(page, 'Mode Local').focus();
  await page.keyboard.press('ArrowDown');
  await expect(radio(page, 'Mode Tour')).toBeChecked();
});

test('390 px : pas de défilement horizontal sur /parametres', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/parametres');
  await page.evaluate(() => document.fonts.ready);
  await radio(page, 'Mode Tour').check();
  await page.getByLabel('Adresse de la passerelle de la tour').fill('http://tour.tailnet.ts.net');
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  writeFileSync(`${ART}Settings-390.png`, await page.screenshot({ fullPage: true }));
  expect(overflow).toBeLessThanOrEqual(0);
});

test('1440 px : capture de revue', async ({ page }) => {
  await page.goto('/parametres');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: 'Tester le Mode Local' }).click();
  await expect(page.locator('.mode-card[data-mode="local"] .probe')).toContainText('Joignable', { timeout: 8_000 });
  await radio(page, 'Mode Tour').check();
  await page.waitForTimeout(300);
  writeFileSync(`${ART}Settings-1440.png`, await page.screenshot({ fullPage: true }));
});
