// Microstructure BTC (P5, S3) : écran contre la maquette Microstructure à 1 440 px, 390 px sans
// défilement horizontal, et flux coupé visible (porte de P5 : aucune interruption non signalée).
// Les WebSockets des plateformes sont remplacées par de faux serveurs qui rejouent les messages
// réels relevés le 24/11/2026 (web/src/micro/fixtures) ; le REST est servi par des réponses de
// même forme. Rien ne sort vers les plateformes pendant le test.

import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compare, measure } from './geometry';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ART = fileURLToPath(new URL('./__artifacts__/', import.meta.url));
mkdirSync(ART, { recursive: true });

type Fx = Record<string, unknown[]>;
const fx = (v: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../src/micro/fixtures/${v}.json`, import.meta.url)), 'utf8')) as Fx;
const OKX = fx('okx'), BN = fx('binance'), BY = fx('bybit'), HL = fx('hyperliquid'), CB = fx('coinbase');

const LANDMARKS = {
  'sous-en-tête': 'main > div:first-child',
  'carte de profondeur': 'section[aria-label="Carte de profondeur"]',
  'carnet': 'section[aria-label="Carnet d’ordres"]',
  'cvd': 'section[aria-label="CVD spot et perpétuel"]',
  'liquidations': 'section[aria-label="Liquidations"]',
  'funding': 'section[aria-label="Funding et open interest"]',
};

/** Faux serveurs WebSocket et REST ; `cut` coupe une plateforme (connexions refusées). */
async function fakeVenues(page: Page) {
  const cut = new Set<string>();
  const open = new Map<string, WebSocketRoute>();
  const timers: ReturnType<typeof setInterval>[] = [];
  const now = () => Date.now();
  const s = (x: unknown) => JSON.stringify(x);
  // Binance : diffs continus après les 5 relevés réels.
  const diffs = BN['binance__btcusdt-depth-100ms'] as { data: { U: number; u: number; pu: number } }[];
  const first = diffs[0].data;
  const t0 = Date.now();                                    // liquidations rattrapées : heures fixes (doublons écartés)
  const bybitSnap = (BY['bybit__orderbook.1000.BTCUSDT__snapshot'][0] as { data: { b: string[][]; a: string[][] } }).data;

  await page.routeWebSocket(/^wss:\/\/(wseea\.okx\.com|fstream\.binance\.com|stream\.binance\.com|stream\.bybit\.com|api\.hyperliquid\.xyz|ws-feed\.exchange\.coinbase\.com)/, (ws) => {
    const url = ws.url();
    const venue = url.includes('okx') ? 'okx' : url.includes('binance') ? 'binance' : url.includes('bybit') ? 'bybit' : url.includes('hyperliquid') ? 'hyperliquid' : 'coinbase';
    open.set(url, ws);
    // Plateforme coupée : plus aucun message (ni réponse, ni pong). Fermer la route ne parvient pas
    // aux WebSockets ouvertes dans un worker ; le silence est d'ailleurs la panne la plus courante.
    const send = ws.send.bind(ws);
    ws.send = (m: string) => { if (!cut.has(venue)) send(m); };
    let tick: () => void = () => {};
    if (url.includes('wseea.okx.com')) {
      ws.onMessage((m) => {
        if (m === 'ping') { ws.send('pong'); return; }
        ws.send(s({ event: 'subscribe', arg: { channel: 'books', instId: 'BTC-USDT-SWAP' } }));
        ws.send(s(OKX['okx__books__BTC-USDT-SWAP__snapshot'][0]));
        for (const k of ['okx__funding-rate__BTC-USDT-SWAP__', 'okx__open-interest__BTC-USDT-SWAP__', 'okx__mark-price__BTC-USDT-SWAP__', 'okx__index-tickers__BTC-USDT__']) ws.send(s(OKX[k][0]));
      });
      let i = 0;
      tick = () => { const t = OKX['okx__trades__BTC-USDT-SWAP__'] as { arg: unknown; data: Record<string, unknown>[] }[]; const m = t[i++ % t.length]; ws.send(s({ ...m, data: m.data.map((d) => ({ ...d, ts: String(now()), tradeId: String(1e9 + i) })) })); };
    } else if (url.includes('fstream.binance.com/public')) {
      for (const d of diffs) ws.send(s(d));
      let u = (diffs[diffs.length - 1]).data.u;
      tick = () => { ws.send(s({ stream: 'btcusdt@depth@100ms', data: { e: 'depthUpdate', E: now(), T: now(), U: u + 1, u: u + 10, pu: u, b: [], a: [] } })); u += 10; };
    } else if (url.includes('fstream.binance.com/market')) {
      ws.send(s(BN['binance-market__btcusdt-markPrice-1s'][0]));
      let a = 5e9;
      tick = () => { for (const m of BN['binance-market__btcusdt-aggTrade'] as { stream: string; data: Record<string, unknown> }[]) ws.send(s({ ...m, data: { ...m.data, a: a++, T: now() } })); };
    } else if (url.includes('stream.binance.com')) {
      let a = 6e9;
      tick = () => { for (const m of BN['binance-spot__btcusdt-aggTrade'] as { stream: string; data: Record<string, unknown> }[]) ws.send(s({ ...m, data: { ...m.data, a: a++, T: now() } })); };
    } else if (url.includes('bybit')) {
      ws.onMessage((m) => {
        const r = JSON.parse(String(m)) as { op: string };
        if (r.op === 'ping') { ws.send(s({ op: 'pong' })); return; }
        ws.send(s({ op: r.op, success: true }));
        if (r.op !== 'subscribe') return;
        ws.send(s(BY['bybit__orderbook.1000.BTCUSDT__snapshot'][0]));
        ws.send(s(BY['bybit__tickers.BTCUSDT__snapshot'][0]));
      });
      tick = () => { for (const m of BY['bybit__publicTrade.BTCUSDT__snapshot'] as { data: Record<string, unknown>[] }[]) ws.send(s({ ...m, data: m.data.map((d) => ({ ...d, T: now() })) })); };
    } else if (url.includes('hyperliquid')) {
      ws.onMessage((m) => {
        const r = JSON.parse(String(m)) as { method: string };
        if (r.method === 'ping') { ws.send(s({ channel: 'pong' })); return; }
        ws.send(s({ channel: 'subscriptionResponse', data: r }));
      });
      tick = () => {
        for (const m of [...HL['hyperliquid__l2Book'], ...HL['hyperliquid__activeAssetCtx']]) ws.send(s(m));
        for (const m of HL['hyperliquid__trades'] as { data: Record<string, unknown>[] }[]) ws.send(s({ ...m, data: m.data.map((d) => ({ ...d, time: now() })) }));
      };
    } else {
      ws.onMessage(() => { ws.send(s(CB['coinbase__subscriptions'][0])); });
      let id = 2e9;
      tick = () => { for (const m of CB['coinbase__match'] as Record<string, unknown>[]) ws.send(s({ ...m, trade_id: id++, time: new Date().toISOString() })); };
    }
    const t = setInterval(() => { if (open.get(url) === ws) tick(); }, 1_000);
    timers.push(t);
    ws.onClose(() => { if (open.get(url) === ws) open.delete(url); clearInterval(t); });
  });

  await page.route(/^https:\/\/(fapi\.binance\.com|api\.binance\.com|api\.bybit\.com|www\.okx\.com)\//, async (route) => {
    const u = route.request().url();
    let body: unknown = {};
    if (u.includes('/klines')) {
      const from = Number(/startTime=(\d+)/.exec(u)?.[1]), to = Number(/endTime=(\d+)/.exec(u)?.[1]);
      const rows = [];
      for (let t = from, k = 0; t <= to && t + 60_000 <= now(); t += 60_000, k++) {
        const v = 100 + 40 * Math.sin(k / 9), buy = u.includes('fapi') ? v * (0.52 + 0.06 * Math.sin(k / 30)) : v * (0.49 - 0.04 * Math.sin(k / 30));
        rows.push([t, '1', '1', '1', '1', v.toFixed(3), t + 59_999, '0', 1, buy.toFixed(3), '0', '0']);
      }
      body = rows;
    } else if (u.includes('fapi/v1/depth')) body = { lastUpdateId: first.u, E: now(), T: now(), bids: bybitSnap.b, asks: bybitSnap.a };
    else if (u.includes('openInterestHist')) body = Array.from({ length: 30 }, (_, i) => ({ symbol: 'BTCUSDT', sumOpenInterest: String(93_000 + i * 100), sumOpenInterestValue: '0', timestamp: Math.floor(now() / 3_600_000) * 3_600_000 - (29 - i) * 3_600_000 }));
    else if (u.includes('fapi/v1/openInterest')) body = { symbol: 'BTCUSDT', openInterest: '97155.986', time: now() };
    else if (u.includes('fundingInfo')) body = [];
    else if (u.includes('bybit.com/v5/market/open-interest')) body = { retCode: 0, retMsg: 'OK', result: { list: Array.from({ length: 30 }, (_, i) => ({ openInterest: String(68_000 - i * 50), timestamp: String(Math.floor(now() / 3_600_000) * 3_600_000 - i * 3_600_000) })) } };
    else if (u.includes('books-full')) body = { code: '0', msg: '', data: [{ ts: String(now()), ...(OKX['okx__books__BTC-USDT-SWAP__snapshot'][0] as { data: { bids: string[][]; asks: string[][] }[] }).data[0] }] };
    else if (u.includes('liquidation-orders')) body = { code: '0', msg: '', data: [{ instId: 'BTC-USDT-SWAP', details: [
      { posSide: 'long', side: 'sell', sz: '120000', bkPx: '59650', ts: String(t0 - 20 * 60_000) },
      { posSide: 'short', side: 'buy', sz: '2500', bkPx: '59720', ts: String(t0 - 5 * 60_000) }] }] };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });

  return {
    cut: (venue: string) => { cut.add(venue); },
    restore: (venue: string) => { cut.delete(venue); },
    stop: () => timers.forEach(clearInterval),
  };
}

async function openLive(page: Page) {
  const v = await fakeVenues(page);
  await page.goto('/microstructure?microInline=1');
  await expect(page.getByTestId('mc-last')).toHaveText(/\d/, { timeout: 20_000 });
  await expect(page.locator('section[aria-label="Carte de profondeur"] canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('mc-cvd-sentence')).toBeVisible({ timeout: 20_000 });
  // Garde-fou : le prix vient des relevés du 24/11/2026 (≈ 59 700 $), jamais du marché réel.
  const px = Number((await page.getByTestId('mc-last').innerText()).replace(/[\s\u202f\u00a0]/g, '').replace(',', '.'));
  expect(px, 'flux réels joints au lieu des faux serveurs').toBeGreaterThan(59_600);
  expect(px).toBeLessThan(59_850);
  return v;
}

test('Microstructure : géométrie conforme à la maquette (x, largeur ; y de la première rangée ±2 px)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1547 });
  await page.goto(`file://${ROOT}design/maquettes/html/Microstructure.html`);
  await page.evaluate(() => document.fonts.ready);
  const ref = await measure(page, LANDMARKS);
  const v = await openLive(page);
  await page.evaluate(() => document.fonts.ready);
  const got = await measure(page, LANDMARKS);
  // Chaque panneau porte en plus sa source et sa fraîcheur (règle du projet) : les hauteurs, et donc
  // le y des rangées suivantes, s'écartent de la maquette. x et largeur restent bloquants partout.
  const xw = compare(ref, got, 2, ['x', 'w']);
  const firstRow = compare(Object.fromEntries(Object.entries(ref).filter(([k]) => ['sous-en-tête', 'carte de profondeur', 'carnet'].includes(k))), got, 2, ['y']);
  writeFileSync(`${ART}Microstructure-geometry.json`, JSON.stringify({ ref, got, xw, firstRow }, null, 1));
  writeFileSync(`${ART}Microstructure-app.png`, await page.screenshot({ fullPage: true }));
  v.stop();
  expect(xw.missing, 'repères absents').toEqual([]);
  expect([...xw.diffs, ...firstRow.diffs], JSON.stringify([...xw.diffs, ...firstRow.diffs], null, 1)).toEqual([]);
});

test('Microstructure : source et fraîcheur sur chaque panneau, données affichées sans « — » inattendu', async ({ page }) => {
  const v = await openLive(page);
  for (const name of ['Carte de profondeur', 'Carnet d’ordres', 'CVD spot et perpétuel', 'Liquidations', 'Funding et open interest']) {
    await expect(page.locator(`section[aria-label="${name}"] [data-fresh]`).first()).toHaveText(/Direct · màj \d\d:\d\d:\d\d/, { timeout: 15_000 });
  }
  await expect(page.getByTestId('mc-fd-binance')).toContainText('%');
  await expect(page.getByTestId('mc-fd-hyperliquid')).toContainText('horaire');
  await expect(page.locator('.mc-lq')).toHaveCount(2);
  await expect(page.locator('.mc-lq--big')).toHaveCount(1);                 // 1 200 BTC × 59 650 $ ≥ 10 M$
  await expect(page.locator('section[aria-label="Liquidations"]')).toContainText('leurs totaux sont des minimums');
  v.stop();
});

test('Microstructure : un flux muet passe « périmé » puis « coupé », et sa coupure entre au journal', async ({ page }) => {
  test.setTimeout(150_000);
  const v = await openLive(page);
  v.cut('bybit');
  // Bybit : périmé après 20 s de silence ; ping sans réponse, reconnexion à 40 s : coupé.
  await expect(page.locator('[data-feed="bybit"]')).toHaveAttribute('data-state', 'stale', { timeout: 30_000 });
  await expect(page.locator('section[aria-label="Carnet d’ordres"] [data-fresh]').first()).toContainText('Bybit WS périmé');
  await expect(page.locator('[data-feed="bybit"]')).toHaveAttribute('data-state', 'down', { timeout: 30_000 });
  await expect(page.locator('[data-feed="bybit"]')).toContainText('coupé');
  await expect(page.locator('.feedbar [title^="Bybit WS"]')).toContainText('Bybit WS');
  await expect(page.locator('.mc-jr-list')).toContainText('coupé : aucun message');
  v.restore('bybit');
  await expect(page.locator('[data-feed="bybit"]')).toHaveAttribute('data-state', 'live', { timeout: 40_000 });
  await expect(page.locator('.mc-jr-list')).toContainText(/Bybit WS.*coupure de \d+ s/, { timeout: 5_000 });
  v.stop();
});

test('Microstructure : 390 px sans défilement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const v = await openLive(page);
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  writeFileSync(`${ART}Microstructure-390.png`, await page.screenshot({ fullPage: true }));
  v.stop();
  expect(sw).toBeLessThanOrEqual(w);
});
