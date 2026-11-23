// Alertes et squawk (E4, plan P1 § 10 et § 11) : la fausse passerelle fait tourner le vrai
// moteur d'alertes (base jetable, Telegram simulé). Chaîne complète : règle créée dans
// l'écran /alertes -> trade qui franchit le niveau -> alerte à l'écran, pastille de la cloche,
// message Telegram -> acquittement. Plus l'écran Squawk et le bouton « Activer voix et son ».

import { expect, test, type APIRequestContext } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GW = 'http://127.0.0.1:8790';
const ART = fileURLToPath(new URL('./__artifacts__/', import.meta.url));
mkdirSync(ART, { recursive: true });
const ORIGIN = { origin: 'http://127.0.0.1:5174' };

async function cleanup(request: APIRequestContext) {
  const state = await (await request.get(`${GW}/api/alerts`)).json() as { rules: { id: number; kind: string }[] };
  for (const r of state.rules.filter((x) => x.kind === 'price')) {
    await request.delete(`${GW}/api/alerts/rules/${r.id}`, { headers: ORIGIN });
  }
  await request.post(`${GW}/api/alerts/ack`, { headers: ORIGIN, data: {} });
}

test.afterEach(async ({ request }) => cleanup(request));

test('Vue d’ensemble : règles par défaut armées dans « Alertes actives »', async ({ page }) => {
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Alertes actives' });
  await expect(panel.locator('li')).toHaveCount(2, { timeout: 15_000 });
  await expect(panel).toContainText('Chiffre publié : tous les indicateurs suivis');
  await expect(panel).toContainText('avant une publication captée');
  await expect(panel.locator('[data-testid="alert-state"]').first()).toHaveText('Armée');
  await expect(page.locator('[data-testid="bell-badge"]')).toHaveCount(0);
});

test('règle de prix : création, franchissement, cloche, Telegram, acquittement', async ({ page, request }) => {
  await page.goto('/alertes');
  const form = page.getByRole('region', { name: 'Nouvelle règle' });
  await expect(form).toBeVisible({ timeout: 15_000 });
  await form.getByLabel(/^Niveau/).fill('500 000');
  await form.getByLabel('Sens').selectOption('hausse');
  await form.getByRole('button', { name: 'Créer la règle' }).click();
  await expect(form.getByRole('status')).toHaveText('Règle créée et armée.');
  const rules = page.getByRole('region', { name: 'Règles' });
  const row = rules.locator('[data-testid="alert-rule"]', { hasText: 'BTC franchit 500' });
  await expect(row).toContainText('Armée');

  await request.post(`${GW}/test/trade?px=499990`);
  await request.post(`${GW}/test/trade?px=500010`);

  const events = page.getByRole('region', { name: 'Déclenchements' });
  const ev = events.locator('[data-testid="alert-event"]', { hasText: 'franchit 500' });
  await expect(ev).toContainText('BTC-USDT perp franchit 500 000 à la hausse', { timeout: 5_000 });
  await expect(ev).toContainText('Telegram : envoyé');
  await expect(row).toContainText('Déclenchée');
  await expect(row.getByRole('button', { name: 'Réarmer' })).toBeVisible();
  await expect(page.locator('[data-testid="bell-badge"]')).toBeVisible();
  const sent = (await (await request.get(`${GW}/test/telegram`)).json()).sent as string[];
  // Format français : espace fine insécable entre milliers (U+202F), que \s reconnaît.
  expect(sent.some((m) => /franchit 500\s000 à la hausse/.test(m) && m.includes('(Paris)'))).toBe(true);

  // La cloche liste l'alerte ; « Tout acquitter » éteint la pastille.
  await page.locator('[data-testid="bell"]').click();
  const pop = page.getByRole('dialog', { name: 'Dernières alertes' });
  await expect(pop).toContainText('franchit 500');
  await expect(page.locator('body header')).not.toContainText(/périmé/i, { timeout: 10_000 });  // horloge calée
  writeFileSync(`${ART}Alertes-1440.png`, await page.screenshot({ fullPage: true }));
  await pop.getByRole('button', { name: 'Tout acquitter' }).click();
  await expect(page.locator('[data-testid="bell-badge"]')).toHaveCount(0);
  await expect(ev).toContainText('acquittée');
});

test('formulaire : saisie incomplète refusée avec sa raison', async ({ page }) => {
  await page.goto('/alertes');
  const form = page.getByRole('region', { name: 'Nouvelle règle' });
  await form.getByRole('button', { name: 'Créer la règle' }).click();
  await expect(form.getByRole('alert')).toHaveText('Prix : saisir un niveau positif.');
});

test('Squawk : écran, réglages, bouton de la barre du haut', async ({ page }) => {
  await page.goto('/squawk');
  await expect(page.getByRole('region', { name: 'Réglages de cet appareil' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Dernières annonces' })).toContainText('Rien d’annoncé');
  const button = page.locator('[data-testid="voice-button"]');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Couper voix et son' })).toBeVisible();
});

test('390 px : écrans Alertes et Squawk sans défilement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, name] of [['/alertes', 'Alertes'], ['/squawk', 'Squawk']] as const) {
    await page.goto(path);
    await expect(page.locator('section').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    writeFileSync(`${ART}${name}-390.png`, await page.screenshot({ fullPage: true }));
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
