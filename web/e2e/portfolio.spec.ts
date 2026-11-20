// Module Bourse (B1) : écran Portefeuille (PTF) sur un portefeuille synthétique
// (api/_tests/portfolio-fixture.ts, aucune donnée réelle), import à blanc avec
// erreurs, 1 440 et 390 px. Les routes /api/bourse/* sont simulées.

import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ART = fileURLToPath(new URL('./__artifacts__/', import.meta.url));
const FIX = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/portfolio.json', import.meta.url)), 'utf-8'));
const XLSX = fileURLToPath(new URL('../src/bourse/fixtures/import-exemple.xlsx', import.meta.url));

async function fakeBourse(page: Page) {
  const imports: { dry: boolean; rows: unknown[] }[] = [];
  await page.route('**/api/bourse/**', async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/bourse/', '');
    const reply = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === 'session') return reply(200, { authenticated: true, configured: true, expires_at: '2026-12-19T10:00:00Z' });
    if (path === 'portfolio') return reply(200, FIX.report);
    if (path === 'transactions') return reply(200, FIX.transactions);
    if (path === 'import' && req.method() === 'POST') {
      const body = req.postDataJSON() as { dry: boolean; rows: unknown[] };
      imports.push(body);
      return reply(422, { envelope: 'PEA · XTB', rows: 2, preview: [], warnings: [],
        errors: [{ line: 3, message: 'titre inconnu du référentiel : FR0000120271 · TTE · XPAR — ajouter d’abord sa cotation' }] });
    }
    return reply(404, { detail: 'route inconnue' });
  });
  return { imports };
}

test('Portefeuille : synthèse, lignes, performance, allocation, risques, opérations (1 440 px)', async ({ page }) => {
  await fakeBourse(page);
  await page.goto('/bourse/portefeuille');
  await expect(page.locator('.subheader h1')).toHaveText('Bourse · Portefeuille');
  const valo = page.getByRole('region', { name: 'Valorisation' });
  await expect(valo.getByText('Valeur totale')).toBeVisible();
  await expect(valo.getByText(/€$/).first()).toBeVisible();
  const lines = page.getByRole('region', { name: 'Lignes' });
  await expect(lines.locator('tbody tr')).toHaveCount(4);   // 3 lignes et les liquidités
  await expect(lines.getByText('Apple')).toBeVisible();
  const perf = page.getByRole('region', { name: 'Performance' });
  await expect(perf.getByRole('img', { name: /Indice de performance/ })).toBeVisible();
  await expect(perf.locator('tr', { hasText: '3 mois' }).getByLabel('Indisponible : historique plus court que la période')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Risques' }).getByLabel(/Indisponible : historique trop court/).first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Allocation' }).getByText('Non ventilé').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Opérations' }).locator('tbody tr')).toHaveCount(9);
  // Enveloppes : Total, PEA, CTO.
  await expect(page.getByRole('button', { name: 'CTO · Courtier' })).toBeVisible();
  writeFileSync(`${ART}Bourse-Portefeuille-1440.png`, await page.screenshot({ fullPage: true }));
});

test('import : lecture du .xlsx dans le navigateur, erreurs du serveur ligne par ligne, rien d’importé', async ({ page }) => {
  const { imports } = await fakeBourse(page);
  await page.goto('/bourse/portefeuille');
  await page.getByRole('button', { name: 'Importer un fichier' }).click();
  await page.getByLabel('Fichier').setInputFiles(XLSX);
  await expect(page.getByText(/Ligne 3 : titre inconnu du référentiel/)).toBeVisible();
  expect(imports).toHaveLength(1);
  expect(imports[0].dry).toBe(true);
  expect(imports[0].rows).toHaveLength(3);
  expect(imports[0].rows[1]).toMatchObject({ Type: 'Achat', ISIN: 'FR0000120271', 'Quantité': 3 });
  await expect(page.getByRole('button', { name: /^Importer \d+ opération/ })).toHaveCount(0);
});

test('390 px : pas de défilement horizontal (portefeuille)', async ({ page }) => {
  await fakeBourse(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/bourse/portefeuille');
  await expect(page.getByRole('region', { name: 'Lignes' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  writeFileSync(`${ART}Bourse-Portefeuille-390.png`, await page.screenshot({ fullPage: true }));
  expect(overflow).toBeLessThanOrEqual(0);
});
