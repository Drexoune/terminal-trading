// Capture à l'heure H (E3, plan P1 § 13) : la fausse passerelle publie un chiffre capté
// pendant que le terminal est ouvert ; le bandeau doit l'afficher, et l'heure d'affichage
// renvoyée par le front (op « displayed », horloge de la passerelle) doit tomber moins
// d'une seconde après la publication sur le bus.

import { expect, test } from '@playwright/test';

const GW = 'http://127.0.0.1:8790';

test.afterEach(async ({ request }) => {
  await request.delete(`${GW}/test/release`);
});

test('chiffre capté affiché en moins d’une seconde, heure d’affichage renvoyée', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="release-banner"]')).toHaveCount(0);
  // Connexion établie et horloge calée (premier pong) avant la publication.
  await page.waitForTimeout(1500);
  const res = await request.post(`${GW}/test/release?delay_ms=1500`);
  expect(res.ok()).toBeTruthy();

  const banner = page.locator('[data-testid="release-banner"]');
  await expect(banner).toBeVisible({ timeout: 5_000 });
  await expect(banner).toContainText('Productivity and Costs (révisé)');
  await expect(banner.locator('[data-testid="release-figure"]')).toContainText('4,1');
  await expect(banner).toContainText('prév. 4,0');

  let state: { bus_ms: number | null; displays: Record<string, number> } = { bus_ms: null, displays: {} };
  await expect.poll(async () => {
    state = await (await request.get(`${GW}/test/release`)).json();
    return Object.keys(state.displays).length;
  }, { timeout: 5_000 }).toBe(1);
  const shown = state.displays['release:us-prod-qq:2026-Q3:Revised'];
  const delay = shown - (state.bus_ms ?? 0);
  console.log(`bus → affichage : ${delay} ms`);
  expect(delay).toBeGreaterThanOrEqual(-50);   // horloges recalées par ping/pong
  expect(delay).toBeLessThan(1000);
});

test('390 px : le bandeau ne crée aucun défilement horizontal', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForTimeout(1000);
  await request.post(`${GW}/test/release?delay_ms=300`);
  await expect(page.locator('[data-testid="release-banner"]')).toBeVisible({ timeout: 5_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
