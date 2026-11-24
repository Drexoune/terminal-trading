// Backtest, recherche autonome (S4, T-064) : plan, suivi d'une recherche en cours (hors échantillon
// masqué), rapport d'une recherche finie, rejeu dans le navigateur (même empreinte), « Charger »
// ouvre un essai dans l'éditeur et lance le backtest, 1440 px et 390 px sans défilement horizontal.
// La recherche simulée est calculée par le vrai moteur (research-core) sur 799 bougies BTC réelles.

import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildReport, DEFAULT_THRESHOLDS, evaluate, sliceMarket, type AttemptRow, type LoopSpec } from '../src/backtest/research-core';
import { knownById } from '../src/backtest/strategies';

const ART = fileURLToPath(new URL('./__artifacts__/', import.meta.url));
mkdirSync(ART, { recursive: true });
const BTC = JSON.parse(readFileSync(new URL('../src/backtest/fixtures/okx-btc-1d-2024-09-16_2026-11-23.json', import.meta.url), 'utf8')) as
  { t: number; o: number; h: number; l: number; c: number }[];
const COLS = { t: BTC.map((b) => b.t), o: BTC.map((b) => b.o), h: BTC.map((b) => b.h), l: BTC.map((b) => b.l), c: BTC.map((b) => b.c) };
const ID = '0a0b0c0d-1111-4222-8333-444455556666';
const SMA = knownById('sma_cross')!.source;

const SPEC: LoopSpec & { period: string; is_share: number } = {
  v: 1, title: 'Croisement de moyennes', markets: [{ asset: 'BTC', tf: '1D', from: BTC[0].t, to: BTC[BTC.length - 1].t, split: BTC[559].t }],
  mode: 'thresholds', thresholds: { ...DEFAULT_THRESHOLDS, min_trades: 5, sharpe: 0.5, t_stat: 0.5, dsr: 0.5, max_dd_pct: 40, profit_factor: 1 }, firm: null,
  oos_min_ratio: 0.5, settings: { capital: 10_000, commissionPct: 0.05, slippageTicks: 1, qtyPct: 100, margin: false },
  max_attempts: 50, max_gemini: 12, rewrite_every: 5, seed: 42, start: { kind: 'code', title: 'Croisement de moyennes', code: SMA, inputs: {} }, goal: '',
  period: 'all', is_share: 0.7,
};

/** Quatre essais réels : départ et trois variantes de paramètres. */
async function attempts(): Promise<AttemptRow[]> {
  const data = [sliceMarket(SPEC.markets[0], COLS)];
  const prior: (number | null)[][] = [[]];
  const rows: AttemptRow[] = [];
  const variants: [AttemptRow['kind'], Record<string, unknown>, string | null][] = [['start', {}, null], ['params', { fastLen: 12 }, 'fastLen = 12'],
    ['params', { fastLen: 12, slowLen: 70 }, 'slowLen = 70'], ['params', { fastLen: 30 }, 'fastLen = 30']];
  for (const [i, [kind, inputs, change]] of variants.entries()) {
    const e = await evaluate(SMA, inputs, data, SPEC, prior);
    if (!e.ok) throw new Error(e.error);
    e.sr_bars.forEach((s, k) => prior[k].push(s));
    rows.push({ n: i + 1, kind, parent: i ? 1 : null, title: 'Croisement de moyennes', code: SMA, inputs, change, gemini_calls: 0, ok: true, error: null,
      score: e.score, is_pass: e.is_pass, oos_pass: e.is_pass ? e.oos_pass : null, detail: e.per, sr_bars: e.sr_bars, ms: e.ms });
  }
  return rows;
}

async function mock(page: Page, status: 'running' | 'done') {
  const rows = await attempts();
  const best = rows.reduce((b, a) => ((a.score ?? 0) > (b.score ?? 0) ? a : b));
  const report = status === 'done' ? buildReport(SPEC, rows, 'done', 'budget de 4 essais atteint', 0) : null;
  const loop = { id: ID, created_at: '2026-11-24T17:00:00Z', updated_at: '2026-11-24T17:04:00Z', status, title: SPEC.title, attempts: rows.length, gemini_calls: 0,
    best_score: best.score, best_n: best.n, verdict: report?.verdict ?? null, note: status === 'done' ? 'budget de 4 essais atteint' : null,
    next_run_at: '2026-11-24T17:05:00Z', finished_at: status === 'done' ? '2026-11-24T17:04:00Z' : null, max_attempts: 50, max_gemini: 12, markets: SPEC.markets };
  const shown = rows.map((a) => ({ ...a, created_at: '2026-11-24T17:01:00Z', oos_reasons: null, ...(status === 'running' ? { oos_pass: null } : {}) }));
  await page.route('**/api/bourse/session', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: true, configured: true, expires_at: null }) }));
  await page.route('**/api/backtest/loops', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ loops: [loop], computed_ms: Date.now() }) }));
  await page.route('**/api/backtest/loop?**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({
    loop: { ...loop, spec: SPEC, report }, attempts: shown, oos_hidden: status === 'running', computed_ms: Date.now() }) }));
  await page.route('**/api/backtest/candles**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    configured: true, asset: 'BTC', tf: '1D', label: 'BTC/USDT', source: 'OKX', aggregated: null, n: BTC.length, ...COLS, v: BTC.map(() => 0),
    series: { first: '2024-09-16T00:00:00Z', last: '2026-11-23T00:00:00Z', complete: true, error: null },
    feed: { name: 'bt-candles', status: 'connected', last_message_ms: Date.now() - 300_000, last_error: null, late_after_ms: 7_200_000, stale_after_ms: 108_000_000 },
    computed_ms: Date.now() }) }));
  return { rows, report };
}

const open = async (page: Page) => {
  await page.goto('/backtest');
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Recherche autonome' }).click();
};

test('Recherche en cours : plan, progression, hors échantillon masqué', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { rows } = await mock(page, 'running');
  await open(page);
  await expect(page.getByRole('region', { name: 'Plan de recherche' })).toContainText('Hybride · Gemini gratuit');
  const view = page.getByRole('region', { name: 'Suivi de la recherche' });
  await expect(view).toContainText(`${rows.length} / 50`);
  await expect(view).toContainText('en cours');
  await expect(view.getByTestId('loop-attempts').locator('tbody tr')).toHaveCount(rows.length);
  await expect(view).toContainText('Meilleur essai');
  if (rows.some((a) => a.is_pass)) await expect(view.getByTestId('loop-attempts')).toContainText('masqué');
  await expect(view.getByTestId('loop-attempts')).not.toContainText(/réussi.*échoué|échoué.*réussi/);
  writeFileSync(`${ART}Backtest-recherche.png`, await page.screenshot({ fullPage: true }));
});

test('Recherche finie : rapport, rejeu identique, « Charger » lance le backtest', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { report } = await mock(page, 'done');
  await open(page);
  const rep = page.getByTestId('loop-report');
  await expect(rep).toContainText(`empreinte ${report!.fingerprint}`);
  await rep.getByRole('button', { name: 'Rejouer le rapport' }).click();
  await expect(page.getByTestId('replay-result')).toContainText(`Empreinte identique (${report!.fingerprint})`, { timeout: 30_000 });
  await page.getByTestId('loop-attempts').getByRole('button', { name: 'Charger' }).first().click();
  await expect(page.getByLabel('Code Pine Script de la stratégie')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Mesures notées' }).getByRole('listitem')).toHaveCount(8, { timeout: 30_000 });
  await expect(page.getByRole('region', { name: 'Paramètres' }).getByLabel('Moyenne rapide')).toHaveValue('30');
});

test('Recherche autonome à 390 px : aucun défilement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, 'done');
  await open(page);
  await expect(page.getByTestId('loop-report')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  writeFileSync(`${ART}Backtest-recherche-390.png`, await page.screenshot({ fullPage: true }));
  expect(overflow).toBe(0);
});
