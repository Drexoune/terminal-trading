// Récap de session (P6, S4) : fiche d'une séance (réponse simulée de /api/p1/recaps), lecture
// « à vérifier » et puces-sources, faits liés à leur écran, lecture automatique sans texte ;
// 390 px sans défilement horizontal.
import { expect, test } from '@playwright/test';

const T = Date.parse('2026-11-25T21:00:00Z');
const facts = [
  { id: 'F1', label: 'Séance New York du 2026-11-25', value: '15:30–22:00 (Paris)', source: 'terminal', at_ms: T, href: '/recap' },
  { id: 'F2', label: 'BTC-USDT perp · variation sur la séance', value: '+0,50 %', source: 'OKX (calcul du terminal)', at_ms: T, href: '/graphiques' },
  { id: 'F3', label: 'Liquidations BTC sur la séance', value: 'longs 3,0 M$, shorts 120,2 k$ (Binance et OKX : minimums)', source: 'OKX, Binance, Bybit', at_ms: T, href: '/microstructure' },
];
const recaps = [
  { key: 'recap:2026-11-25:ny', session: 'ny', label: 'New York', date: '2026-11-25', from: T - 23_400_000, to: T, facts, text: 'Le BTC gagne +0,50 % sur la séance.', sources: ['F2'], reason: null, model: 'gemini', generated_ms: T + 300_000 },
  { key: 'recap:2026-11-25:london', session: 'london', label: 'Londres', date: '2026-11-25', from: T - 36_000_000, to: T - 5_400_000, facts, text: null, sources: [], reason: 'plafond de 6 récaps par jour atteint (offre gratuite) : faits seuls', model: null, generated_ms: T },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/p1/recaps', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, recaps, computed_ms: T }) }));
});

test('Récap : lecture contrôlée et sourcée, faits liés, lecture automatique', async ({ page }) => {
  await page.goto('/recap');
  const cards = page.getByTestId('recap-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Le BTC gagne +0,50 % sur la séance.');
  await expect(page.getByRole('region', { name: 'Récap New York 2026-11-25' })).toContainText('Lecture Gemini · à vérifier');
  await expect(cards.first().locator('.rc-srcs a')).toHaveText([/^BTC-USDT perp · variation sur la/]);   // puce tronquée, libellé entier au survol
  await expect(cards.first().getByRole('link', { name: 'Liquidations BTC sur la séance' })).toHaveAttribute('href', '/microstructure');
  await expect(page.getByRole('region', { name: 'Récap Londres 2026-11-25' })).toContainText('Lecture automatique');
  await expect(cards.nth(1)).toContainText('plafond de 6 récaps par jour atteint');
});

test('Récap à 390 px : aucun défilement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/recap');
  await expect(page.getByTestId('recap-card')).toHaveCount(2);
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(w);
});
