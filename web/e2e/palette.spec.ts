import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav [aria-current="page"]')).toBeVisible();
});

test('Ctrl K ouvre la palette, BTC GP mène au graphique', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder('BTC GP, USD ECO, FED WIRP…');
  await expect(input).toBeFocused();
  await input.fill('btc gp');
  await expect(page.locator('.palette__item[data-selected="true"]')).toContainText('BTC GP');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/graphiques$/);
  await expect(page.locator('.palette')).toHaveCount(0);
  await expect(page.locator('nav [aria-current="page"]')).toHaveText('Graphiques');
});

test('« / » ouvre la palette, navigation au clavier et Échap', async ({ page }) => {
  await page.locator('body').click();
  await page.keyboard.press('/');
  const input = page.getByPlaceholder('BTC GP, USD ECO, FED WIRP…');
  await expect(input).toBeFocused();
  await input.fill('USD ECO');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/calendrier$/);
  await page.keyboard.press('/');
  await expect(input).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.palette')).toHaveCount(0);
});

test('chaque écran du menu a une commande qui y mène', async ({ page }) => {
  const links = await page.locator('nav[aria-label="Navigation principale"] a').evaluateAll(
    (as) => as.map((a) => (a as HTMLAnchorElement).pathname));
  expect(links.length).toBe(24);
  for (const [cmd, path] of [['FED WIRP', '/taux'], ['JPY FA', '/heatmap'], ['BTC BOOK', '/microstructure'], ['HOME', '/']]) {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder('BTC GP, USD ECO, FED WIRP…').fill(cmd);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}$`));
  }
});

test('la barre de commande du haut ouvre aussi la palette', async ({ page }) => {
  await page.getByPlaceholder('Commande ou ticker…').click();
  await expect(page.getByPlaceholder('BTC GP, USD ECO, FED WIRP…')).toBeFocused();
});
