// Porte P0 en direct, dans le mode du front lancé (E2E_MODE, « local » par défaut) :
//   Mode Local  : E2E_LIVE=1 E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/live.spec.ts
//                 (python scripts/dev.py déjà lancé : passerelle + front)
//   Mode Online : E2E_LIVE=1 E2E_MODE=online E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/live.spec.ts
//                 (python scripts/dev.py --mode online déjà lancé : front + /api/*, OKX lu par le navigateur)
// Derrière un proxy sortant : ajouter E2E_PROXY=<adresse du proxy>.

import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ART = fileURLToPath(new URL('./__artifacts__/', import.meta.url));

test.skip(!process.env.E2E_LIVE, 'test en direct : E2E_LIVE=1 avec la vraie passerelle');

test('BTC en direct, latence affichée, flux connectés', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  const price = page.getByTestId('btc-last');
  await expect(price).toHaveText(/^\d[\d ]*,\d$/, { timeout: 20_000 });

  // Le prix doit bouger : on relève les valeurs affichées pendant 60 s au plus.
  const seen = new Set<string>();
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000 && seen.size < 3) {
    seen.add((await price.textContent()) ?? '');
    await page.waitForTimeout(500);
  }
  expect(seen.size, `prix affichés : ${[...seen].join(' | ')}`).toBeGreaterThan(1);

  const latency = page.getByRole('button', { name: /^OKX \d+\s?ms$/i });
  await expect(latency).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.chart-empty')).toHaveCount(0, { timeout: 20_000 });
  // En Mode Online, pas de passerelle : le navigateur lit OKX directement.
  const online = process.env.E2E_MODE === 'online';
  await expect(page.locator('.feedbar__mode')).toHaveText(online ? 'Mode Online' : 'Mode Local');
  for (const feed of online ? ['OKX WS', 'OKX bougies'] : ['Passerelle', 'OKX WS', 'OKX bougies']) {
    await expect(page.locator('.feedbar').getByTitle(`${feed} : connecté`)).toBeVisible();
  }
  await latency.hover();
  const report = {
    prices: [...seen],
    latency: await latency.textContent(),
    breakdown: await page.locator('#latency-tip').innerText(),
    clocks: await page.locator('.clocks').innerText(),
    utc: await page.locator('.utc').innerText(),
    subheader: await page.locator('.subheader h1').innerText(),
  };
  const tag = online ? 'online' : 'local';
  writeFileSync(`${ART}live-report-${tag}.json`, JSON.stringify(report, null, 1));
  await page.screenshot({ path: `${ART}live-Main-${tag}.png`, fullPage: true });
  expect(errors, 'erreurs dans la page pendant le flux en direct').toEqual([]);
});
