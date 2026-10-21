import { expect, test } from '@playwright/test';

test('chaque bouton a un nom accessible ; les icônes sont décoratives', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('btc-last')).toHaveText(/\d/, { timeout: 15_000 });
  const unnamed = await page.locator('button').evaluateAll((bs) => bs
    .filter((b) => !(b.getAttribute('aria-label') || b.textContent?.trim()))
    .map((b) => b.outerHTML.slice(0, 80)));
  expect(unnamed).toEqual([]);
  const svgNotHidden = await page.locator('svg.ic').evaluateAll((s) => s
    .filter((x) => x.getAttribute('aria-hidden') !== 'true').length);
  expect(svgNotHidden).toBe(0);
});

test('menu : entrée active marquée, bascules de période avec aria-pressed', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav [aria-current="page"]')).toHaveText('Vue d’ensemble');
  const group = page.getByRole('group', { name: 'Période' });
  await expect(group.getByRole('button', { name: '1 J' })).toHaveAttribute('aria-pressed', 'true');
  await group.getByRole('button', { name: '5 J' }).click();
  await expect(group.getByRole('button', { name: '5 J' })).toHaveAttribute('aria-pressed', 'true');
});

test('une valeur absente affiche « — » et sa raison, jamais un chiffre de maquette', async ({ page }) => {
  await page.goto('/');
  const row = page.getByRole('row', { name: /^NASDAQ 100 Future/ });
  await expect(row.locator('.missing').first()).toHaveAttribute('title', /source à choisir/);
  await expect(row).not.toContainText('27 612');
});
