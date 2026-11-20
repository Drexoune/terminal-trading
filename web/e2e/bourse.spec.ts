// Module Bourse (B0) : connexion par mot de passe, écran Sources, section du
// menu et commande BSRC, 1 440 et 390 px. Les routes /api/bourse/* sont
// simulées dans le navigateur : ni Supabase ni mot de passe réel.

import { expect, test, type Page, type Route } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ART = fileURLToPath(new URL('./__artifacts__/', import.meta.url));

const SOURCES = {
  generated_at: '2026-11-19T06:50:00Z',
  jobs: [
    { job: 'ecb-fx', label: 'Cours de référence BCE', source: 'BCE', next_run: '2026-11-19T16:30:00Z',
      last_run: { job: 'ecb-fx', started_at: '2026-11-18T16:30:00Z', finished_at: '2026-11-18T16:30:02Z', ok: true, error: null, rows: 20, requests: 1, note: 'dernier fixing 2026-11-18' } },
    { job: 'us-close', label: 'Clôtures US', source: 'Massive', next_run: '2026-11-20T06:15:00Z', last_run: null },
    { job: 'eu-close', label: 'Clôtures européennes', source: 'Alpha Vantage', next_run: '2026-11-20T06:30:00Z',
      last_run: { job: 'eu-close', started_at: '2026-11-19T06:45:00Z', finished_at: '2026-11-19T06:45:20Z', ok: false, error: 'PAEEM.PAR : Invalid API call.', rows: 600, requests: 7, note: 'quota atteint' } },
    { job: 'ref-sec', label: 'Sociétés américaines', source: 'SEC', next_run: '2026-11-22T05:00:00Z', last_run: null },
  ],
  quota: { source: 'Alpha Vantage', day: '2026-11-19', used: 7, max: 20 },
  fx: { pair: 'EUR/USD', per_eur: '1.0989', value_date: '2026-11-18', received_at: '2026-11-18T16:30:02Z', source: 'BCE' },
  listings: [
    { id: 1, name: 'Amundi PEA Nasdaq-100 UCITS ETF Acc', isin: 'FR0011871110', kind: 'etf', symbol: 'PUST', currency: 'EUR',
      price_source: 'alphavantage', source_symbol: 'PUST.PAR', pea_eligible: true, pea_reason: 'ETF de la table des fonds éligibles',
      last: { value_date: '2026-11-18', close: '97.6700', currency: 'EUR', source: 'Alpha Vantage', received_at: '2026-11-19T06:30:10Z' } },
    { id: 2, name: 'Air Liquide', isin: 'FR0000120073', kind: 'action', symbol: 'AI', currency: 'EUR',
      price_source: 'alphavantage', source_symbol: 'AI.PAR', pea_eligible: null, pea_reason: 'pays du siège inconnu', last: null },
  ],
};

/** Faux /api/bourse : session fermée jusqu'au bon mot de passe. */
async function fakeBourse(page: Page, opts: { configured?: boolean } = {}) {
  let open = false;
  const posts: unknown[] = [];
  await page.route('**/api/bourse/**', async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/bourse/', '');
    const reply = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === 'session' && req.method() === 'GET') {
      return reply(200, opts.configured === false
        ? { authenticated: false, configured: false, reason: 'BOURSE_SESSION_SECRET absente ou trop courte (32 caractères au moins)' }
        : { authenticated: open, configured: true, expires_at: open ? '2026-12-19T10:00:00Z' : null });
    }
    if (path === 'session' && req.method() === 'POST') {
      posts.push(req.postDataJSON());
      expect(req.headers()['content-type']).toBe('application/json');
      if ((req.postDataJSON() as { password: string }).password !== 'bon mot de passe') return reply(401, { detail: 'mot de passe refusé' });
      open = true;
      return reply(200, { authenticated: true, expires_at: '2026-12-19T10:00:00Z' });
    }
    if (path === 'session' && req.method() === 'DELETE') { open = false; return reply(200, { authenticated: false }); }
    if (!open) return reply(401, { detail: 'session requise' });
    if (path === 'sources') return reply(200, SOURCES);
    return reply(404, { detail: 'route inconnue' });
  });
  return { posts };
}

test('menu : section Bourse, commande BSRC dans la palette', async ({ page }) => {
  await fakeBourse(page);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  // Section repliée par défaut : le menu garde les mesures de la maquette.
  const toggle = nav.getByRole('button', { name: 'Bourse' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(nav.getByRole('link', { name: 'Sources' })).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.getByRole('link', { name: 'Sources' })).toHaveAttribute('href', '/bourse/sources');
  await toggle.click();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('BTC GP, USD ECO, FED WIRP…').fill('BSRC');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/bourse\/sources$/);
  await expect(page.locator('.subheader h1')).toHaveText('Bourse · Sources');
  // Sur un écran Bourse, la section s'ouvre et l'entrée est marquée active.
  await expect(nav.getByRole('link', { name: 'Sources' })).toHaveAttribute('aria-current', 'page');
});

test('connexion : mot de passe refusé, puis accepté ; Sources affichées ; déconnexion', async ({ page }) => {
  const { posts } = await fakeBourse(page);
  await page.goto('/bourse/sources');
  const field = page.getByLabel('Mot de passe');
  await expect(field).toHaveAttribute('type', 'password');
  await field.fill('faux');
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await expect(page.getByRole('alert')).toHaveText('Mot de passe refusé.');
  await expect(field).toHaveValue('');
  await field.fill('bon mot de passe');
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await expect(page.locator('[data-screen="bourse-sources"]')).toBeVisible();
  expect(posts).toEqual([{ password: 'faux' }, { password: 'bon mot de passe' }]);

  // Données : formats français, « — » avec raison, clôture absente, échec visible.
  await expect(page.getByText('1,0989')).toBeVisible();
  await expect(page.getByText('7 / 20')).toBeVisible();
  const pust = page.locator('tr', { hasText: 'PUST.PAR' });
  await expect(pust).toContainText('97,67 EUR');
  await expect(pust).toContainText('18/11/2026');
  await expect(pust).toContainText('19/11 07:30');
  const ai = page.locator('tr', { hasText: 'AI.PAR' });
  await expect(ai.getByLabel('Indisponible : aucune clôture relevée')).toBeVisible();
  await expect(ai.getByLabel('Indisponible : pays du siège inconnu')).toBeVisible();
  await expect(page.locator('tr', { hasText: 'Clôtures européennes' })).toContainText('Échec');
  await expect(page.locator('tr', { hasText: 'Clôtures US' }).getByLabel('Indisponible : jamais lancé')).toBeVisible();
  writeFileSync(`${ART}Bourse-Sources-1440.png`, await page.screenshot({ fullPage: true }));

  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByLabel('Mot de passe')).toBeVisible();
});

test('module non configuré : « — » et la raison, pas de formulaire', async ({ page }) => {
  await fakeBourse(page, { configured: false });
  await page.goto('/bourse/sources');
  await expect(page.getByLabel(/Indisponible : module Bourse non configuré/)).toBeVisible();
  await expect(page.getByLabel('Mot de passe')).toHaveCount(0);
});

test('écrans à venir : étape affichée, aucune donnée', async ({ page }) => {
  await page.goto('/bourse/action');
  await expect(page.getByText('Cet écran arrive en B2. Aucune donnée n’est affichée d’ici là.')).toBeVisible();
});

for (const step of ['login', 'sources'] as const) {
  test(`390 px : pas de défilement horizontal (${step})`, async ({ page }) => {
    await fakeBourse(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/bourse/sources');
    if (step === 'sources') {
      await page.getByLabel('Mot de passe').fill('bon mot de passe');
      await page.getByRole('button', { name: 'Ouvrir' }).click();
      await expect(page.locator('[data-screen="bourse-sources"]')).toBeVisible();
    } else {
      await expect(page.getByLabel('Mot de passe')).toBeVisible();
    }
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    writeFileSync(`${ART}Bourse-${step}-390.png`, await page.screenshot({ fullPage: true }));
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
