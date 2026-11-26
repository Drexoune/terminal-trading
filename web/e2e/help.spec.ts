// Aide (case explicative et bulles « i ») : case ouverte par défaut et repliable (mémorisé), bulle
// au survol, au clavier (Échap ferme) et au toucher ; microstructure : bulles demandées ; 390 px.
import { expect, test } from '@playwright/test';

test('case explicative : ouverte, repliable, mémorisée', async ({ page }) => {
  await page.goto('/microstructure');
  const guide = page.getByRole('region', { name: 'Explication de la page' });
  await expect(guide).toContainText('À quoi sert cette page');
  await expect(guide).toContainText('liquidations');
  await page.getByRole('button', { name: 'Guide' }).click();
  await expect(guide).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Explication de la page' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Guide' }).click();
  await expect(page.getByRole('region', { name: 'Explication de la page' })).toBeVisible();
});

test('microstructure : bulles du carnet, de la carte, du CVD, des liquidations, du funding et de l’OI', async ({ page }) => {
  await page.goto('/microstructure');
  for (const name of ['Carte de profondeur', 'Liquidité au repos', 'Achats agressifs', 'Ventes agressives', 'Carnet d’ordres', 'Déséquilibre du carnet',
    'CVD spot et perpétuel', 'CVD perpétuel', 'CVD spot', 'Liquidations', 'Liquidation', 'Funding et open interest', 'Funding', 'Open interest', 'Prime perp / spot']) {
    await expect(page.getByRole('button', { name: `Explication : ${name}`, exact: true }).first(), name).toBeAttached();
  }
  const btn = page.getByRole('button', { name: 'Explication : Liquidations', exact: true });
  await btn.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText('une par seconde');
  await expect(tip).toContainText('En pratique');
  await page.mouse.move(0, 0);
  await expect(tip).toHaveCount(0);
  await page.getByRole('button', { name: 'Explication : Funding', exact: true }).focus();
  await expect(page.getByRole('tooltip')).toContainText('les longs paient les shorts');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('chaque écran du menu a sa case explicative', async ({ page }) => {
  for (const path of ['/', '/calendrier', '/taux', '/risque', '/options', '/track-record', '/assistant', '/alertes']) {
    await page.goto(path);
    await expect(page.getByRole('region', { name: 'Explication de la page' }), path).toContainText('Comment s’en servir');
  }
});

test('390 px : bulle ouverte au toucher, dans la fenêtre, sans défilement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/microstructure');
  const btn = page.getByRole('button', { name: 'Explication : Prime perp / spot', exact: true });
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  const box = await page.getByRole('tooltip').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(w);
});
