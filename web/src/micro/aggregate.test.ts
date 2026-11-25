// @vitest-environment node
// Microstructure (P5, étape S2) : agrégations pures contre des cas calculés à la main — carnet
// fusionné entre plateformes et déséquilibre, mur retiré contre mur échangé, funding ramené à
// 8 h et variation 24 h de l'OI, CVD (direct, trous rattrapés, divergence), liquidations
// (doublons, totaux, seuil de 10 M$), lecture des réponses REST réelles.
import { describe, expect, it } from 'vitest';
import { aggregate } from './aggBook';
import { parseBinanceKlines, parseBybitOiHist, parseOkxLiqHist, parseOkxOiHist, parseOkxTaker } from './backfill';
import { Cvd, CvdStream, cvdSentence, divergence, MIN } from './cvd';
import { DepthMap, niceStep } from './depth';
import { overlay } from './engine';
import { FundingBoard, nearest } from './funding';
import { Liquidations, LIQ_BIG_USD } from './liqs';
import type { BookView, MicroTrade, Venue } from './types';

const view = (venue: Venue, bids: [number, number][], asks: [number, number][], synced = true): BookView => ({
  venue, ts: 1, recv: 1, synced,
  bids: { px: bids.map((l) => l[0]), sz: bids.map((l) => l[1]) },
  asks: { px: asks.map((l) => l[0]), sz: asks.map((l) => l[1]) },
});
const trade = (p: Partial<MicroTrade>): MicroTrade => ({ venue: 'binance', market: 'perp', ts: 0, recv: 0, px: 60_000, sz: 1, side: 'buy', ...p });

describe('carnet agrégé', () => {
  it('tranches de 10 $ sur plusieurs plateformes, cumul, déséquilibre calculé à la main', () => {
    const a = view('okx', [[60_005.5, 1], [59_999.9, 2]], [[60_006, 1.5], [60_019, 0.5]]);
    const b = view('binance', [[60_004, 3], [59_995, 1]], [[60_008, 0.5], [60_031, 2]]);
    const c = view('bybit', [], [], false);
    const r = aggregate([a, b, c], 10, 2, 0);
    // Achats : 60 000 ← 1 + 3 ; 59 990 ← 2 + 1. Ventes : 60 010 ← 1,5 + 0,5 ; 60 020 ← 0,5.
    expect(r.bids.map((l) => [l.px, l.sz, l.cum])).toEqual([[60_000, 4, 4], [59_990, 3, 7]]);
    expect(r.asks.map((l) => [l.px, l.sz, l.cum])).toEqual([[60_010, 2, 2], [60_020, 0.5, 2.5]]);
    expect(r.bids[0].venues).toEqual({ okx: 1, binance: 3 });
    expect(r.imbalance).toBeCloseTo((7 - 2.5) / 9.5, 12);
    expect(r.best_bid).toBe(60_005.5);
    expect(r.spread).toBe(0.5);
    expect(r.missing).toEqual([{ venue: 'bybit', reason: 'carnet en cours de synchronisation' }]);
  });

  it('carnet proche complété par le carnet profond au-delà de sa portée seulement', () => {
    const near = view('okx', [[100, 1], [99, 1]], [[101, 1], [102, 1]]);
    const far = view('okx', [[100, 9], [98, 5], [90, 2]], [[101, 9], [105, 4]]);
    const v = overlay(near, far);
    expect(v.bids.px).toEqual([100, 99, 98, 90]);
    expect(v.bids.sz).toEqual([1, 1, 5, 2]);
    expect(v.asks.px).toEqual([101, 102, 105]);
  });
});

describe('carnet local', () => {
  it('Binance : niveaux hors de l’instantané écartés ; OKX : 400 niveaux au plus', async () => {
    const { LocalBook } = await import('./book');
    const b = new LocalBook('binance', 1, { bounded: true });
    b.snapshot([[100, 1], [99, 1]], [[101, 1], [102, 1]], 0, 0);
    b.apply([[50, 3]], [[150, 3]], 0, 0);                     // niveaux lointains modifiés : incomplets
    expect(b.view().bids.px).toEqual([100, 99]);
    expect(b.view().asks.px).toEqual([101, 102]);
    const o = new LocalBook('okx', 1, { maxLevels: 2 });
    o.snapshot([[100, 1], [99, 1], [98, 1]], [[101, 1]], 0, 0);
    expect(o.view().bids.px).toEqual([100, 99]);
  });
});

describe('carte de profondeur', () => {
  const book = (wall: number) => view('binance', [[59_990, 1], [59_900, wall], [59_800, 1]], [[60_010, 1], [60_100, 1], [60_200, 1]]);
  it('pas « rond » pour ±0,5 % en 30 tranches', () => {
    expect(niceStep(60_000, 0.5, 30)).toBe(20);
    expect(niceStep(108_000, 0.5, 30)).toBe(50);
  });
  it('mur retiré : une tranche de 50 BTC qui disparaît sans trade', () => {
    const d = new DepthMap({ wallMinBtc: 40 });
    d.sample(0, [book(50)]);
    d.sample(5_000, [book(2)]);
    expect(d.state().walls).toEqual([{ t: 5_000, px: 59_900, sz: 50, side: 'bid', left: 2 }]);
  });
  it('mur échangé : la même baisse expliquée par des ventes à ce prix n’est pas un retrait', () => {
    const d = new DepthMap({ wallMinBtc: 40 });
    d.sample(0, [book(50)]);
    d.onTrade(trade({ px: 59_905, sz: 45, side: 'sell' }));
    d.sample(5_000, [book(2)]);
    expect(d.state().walls).toEqual([]);
    // Ventes agressives de 45 BTC (≥ 5) : une bulle au prix moyen.
    expect(d.state().bubbles).toEqual([{ t: 0, px: 59_905, sz: 45, side: 'sell' }]);
  });
  it('bord de carnet qui se déplace : la tranche sortie de la portée n’est pas un mur retiré', () => {
    const d = new DepthMap({ wallMinBtc: 40 });
    d.sample(0, [view('bybit', [[59_990, 1], [59_820, 60]], [[60_010, 1]])]);
    d.sample(5_000, [view('bybit', [[59_990, 1], [59_900, 1]], [[60_010, 1]])]);   // 59 820 hors portée
    expect(d.state().walls).toEqual([]);
  });
  it('une colonne toutes les 40 s, fenêtre de 60 min', () => {
    const d = new DepthMap();
    for (let t = 0; t <= 3_700_000; t += 5_000) d.sample(t, [book(10)]);
    const s = d.state();
    expect(s.columns.every((c) => c.t >= 3_700_000 - 3_600_000)).toBe(true);
    expect(s.columns.length).toBe(90);
  });
});

describe('funding et open interest', () => {
  it('funding ramené à 8 h (Hyperliquid horaire × 8), prime, OI 24 h en BTC, totaux pondérés', () => {
    const now = 100 * 3_600_000;
    const f = new FundingBoard();
    f.setFunding({ venue: 'binance', ts: now, rate: 0.0001, interval_h: 8, next_ms: now + 1 });
    f.setFunding({ venue: 'hyperliquid', ts: now, rate: 0.0000125, interval_h: 1, next_ms: now + 2 });
    f.setOi({ venue: 'binance', ts: now, oi_btc: 110, oi_usd: null });
    f.setOi({ venue: 'hyperliquid', ts: now, oi_btc: 50, oi_usd: 3_000_000 });
    f.setPremium({ venue: 'binance', ts: now, mark: 60_060, index: 60_000 });
    f.setPremium({ venue: 'hyperliquid', ts: now, mark: 60_000, index: 60_000 });
    f.setHistory('binance', [{ ts: now - 25 * 3_600_000, oi_btc: 90 }, { ts: now - 24 * 3_600_000 + 600_000, oi_btc: 100 }]);
    const s = f.state(now);
    const bn = s.rows.find((r) => r.venue === 'binance')!, hl = s.rows.find((r) => r.venue === 'hyperliquid')!;
    expect(bn.rate_8h).toBeCloseTo(0.0001, 12);
    expect(hl.rate_8h).toBeCloseTo(0.0001, 12);
    expect(bn.oi_usd).toBe(110 * 60_060);                      // OI × marque quand la valeur n'est pas publiée
    expect(bn.oi_24h).toBeCloseTo(0.1, 12);
    expect(bn.premium).toBeCloseTo(0.001, 12);
    expect(hl.oi_24h).toBeNull();
    expect(hl.oi_24h_reason).toBe('aucun historique public de l’OI');
    expect(s.rows.find((r) => r.venue === 'okx')!.rate_8h).toBeNull();
    expect(s.total.oi_btc).toBe(160);
    expect(s.total.oi_24h).toBeCloseTo(0.1, 12);               // Binance seule a un historique
    expect(s.total.oi_24h_venues).toEqual(['binance']);
    const wB = 110 * 60_060, wH = 3_000_000;
    expect(s.total.premium).toBeCloseTo((0.001 * wB) / (wB + wH), 12);
  });
  it('point d’historique le plus proche, à 90 min près', () => {
    expect(nearest([{ ts: 0, oi_btc: 1 }, { ts: 3_600_000, oi_btc: 2 }], 3_000_000)).toEqual({ ts: 3_600_000, oi_btc: 2 });
    expect(nearest([{ ts: 0, oi_btc: 1 }], 6_000_000)).toBeNull();
  });
});

describe('CVD', () => {
  const T0 = 1_795_550_400_000;                               // minute pleine
  it('tranche close sans connexion = trou ; rattrapage sans jamais écraser le direct', () => {
    const s = new CvdStream('binance:perp', MIN, T0);
    s.tick(T0);
    expect(s.holes().length).toBe(240);
    s.trade(trade({ ts: T0 + 10_000, recv: T0 + 10_000, sz: 2 }));   // connecté en cours de minute
    s.trade(trade({ ts: T0 + 70_000, recv: T0 + 70_000, sz: 1, side: 'sell' }));
    s.tick(T0 + 2 * MIN + 1);
    expect(s.state(T0)).toBe('hole');                         // minute entamée : trou
    expect(s.state(T0 + MIN)).toBe('live');
    s.fill([{ unit: T0, buy: 5, sell: 1 }, { unit: T0 + MIN, buy: 99, sell: 0 }]);
    const m = s.minutes(T0, T0 + 2 * MIN);
    expect(m.get(T0)).toEqual({ buy: 5, sell: 1 });
    expect(m.get(T0 + MIN)).toEqual({ buy: 0, sell: 1 });     // direct conservé
  });
  it('coupure : la tranche en cours devient un trou, rattrapé ensuite', () => {
    const s = new CvdStream('binance:perp', MIN, T0);
    s.trade(trade({ ts: T0 - 1, recv: T0 - 1 }));
    s.disconnected(T0 + 30_000);
    s.trade(trade({ ts: T0 + 40_000, recv: T0 + 40_000 }));
    s.tick(T0 + 2 * MIN);
    expect(s.state(T0)).toBe('hole');
    expect(s.state(T0 + MIN)).toBe('live');
  });
  it('tranche de 5 min d’OKX étalée sur ses minutes', () => {
    const s = new CvdStream('okx:perp', 5 * MIN, T0);
    s.tick(T0 + 5 * MIN);
    s.fill([{ unit: T0, buy: 10, sell: 5 }]);
    expect(s.minutes(T0, T0 + 5 * MIN).get(T0 + 2 * MIN)).toEqual({ buy: 2, sell: 1 });
  });
  it('courbes cumulées des seuls flux rattrapés, divergence et phrase de lecture', () => {
    const c = new Cvd(T0);
    const now = T0 + 3 * MIN;
    c.tick(now);
    const last = now - MIN;
    c.fill('binance:perp', [{ unit: last, buy: 100, sell: 20 }]);
    c.fill('binance:spot', [{ unit: last, buy: 10, sell: 40 }]);
    c.trade(trade({ venue: 'bybit', sz: 3, recv: now }));     // à part : pas dans les courbes
    const s = c.state(now);
    expect(s.perp).toBe(80);
    expect(s.spot).toBe(-30);
    expect(s.series.perp.at(-1)).toBe(80);
    expect(s.series.t.length).toBe(240);
    expect(s.ratio_perp).toBeCloseTo(80 / 120, 12);
    expect(s.ratio_spot).toBeCloseTo(-30 / 50, 12);
    expect(s.divergence).toBe(true);
    expect(s.perp_venues).toEqual(['binance']);
    expect(s.others).toEqual([{ venue: 'bybit', market: 'perp', delta: 3, since: now }]);
    expect(s.sentence).toBe('Le perpétuel achète (+80 BTC), le spot vend (−30 BTC) : sur les 4 dernières heures, la pression acheteuse vient des dérivés, pas du comptant.');
  });
  it('divergence : signes opposés et au moins 2 % du volume de chaque côté', () => {
    expect(divergence(0.05, -0.03)).toBe(true);
    expect(divergence(0.05, -0.01)).toBe(false);
    expect(divergence(0.05, 0.03)).toBe(false);
    expect(divergence(null, -0.5)).toBe(false);
    expect(cvdSentence(null, 1, false, 4)).toMatch(/rattrapage/);
  });
});

describe('liquidations', () => {
  it('doublons écartés, totaux longs et shorts, lignes ≥ 10 M$ surlignées, fenêtre d’une heure', () => {
    const l = new Liquidations();
    const base = { venue: 'okx' as const, recv: 0, px: 60_000, floor: true };
    expect(l.add({ ...base, ts: 1_000, side: 'long', sz: 200, usd: 12_000_000 })).toBe(true);
    expect(l.add({ ...base, ts: 1_000, side: 'long', sz: 200, usd: 12_000_000 })).toBe(false);
    l.add({ ...base, venue: 'bybit', floor: false, ts: 2_000, side: 'short', sz: 1, usd: 60_000 });
    const s = l.state(3_000);
    expect(s.long_usd).toBe(12_000_000);
    expect(s.short_usd).toBe(60_000);
    expect(s.rows.map((r) => [r.venue, r.big])).toEqual([['bybit', false], ['okx', true]]);
    expect(s.rows[1].usd).toBeGreaterThanOrEqual(LIQ_BIG_USD);
    expect(s.by_venue.find((v) => v.venue === 'hyperliquid')!.reason).toBe('aucun flux public de liquidations');
    expect(l.state(1_000 + 3_600_001).count).toBe(1);
  });
});

describe('réponses REST réelles (relevés du 24 et du 25/11/2026)', () => {
  it('bougies Binance : volume preneur acheteur (champ 9), vendeur = volume − acheteur, bougie en cours écartée', () => {
    const rows = [[1795535040000, '59735.90', '59768.50', '59664.40', '59670.20', '307.618', 1795535099999, '18365197.88530', 7061, '122.653', '7322980.41510', '0'],
      [1795535100000, '59670.10', '59877.00', '59604.50', '59720.50', '816.924', 1795535159999, '48820605.07350', 16198, '485.464', '29008326.57480', '0']];
    const f = parseBinanceKlines(rows, 1795535120000);
    expect(f).toHaveLength(1);
    expect(f[0].unit).toBe(1795535040000);
    expect(f[0].buy).toBeCloseTo(122.653, 9);
    expect(f[0].sell).toBeCloseTo(307.618 - 122.653, 9);
  });
  it('OKX : volume preneur [ts, vente, achat] (tranche en cours écartée), OI en BTC, liquidations en contrats', () => {
    const tv = { code: '0', data: [['1795565400000', '8.026', '176.1619'], ['1795565100000', '77.5543', '53.8354']], msg: '' };
    expect(parseOkxTaker(tv, 1795565619000)).toEqual([{ unit: 1795565100000, sell: 77.5543, buy: 53.8354 }]);
    const oi = { code: '0', data: [['1795564800000', '3071288.84', '30710.4322', '1829692684.83']], msg: '' };
    expect(parseOkxOiHist(oi)).toEqual([{ ts: 1795564800000, oi_btc: 30710.4322 }]);
    const liq = { code: '0', msg: '', data: [{ instId: 'BTC-USDT-SWAP', details: [{ bkLoss: '0', bkPx: '59536.7', posSide: 'long', side: 'sell', sz: '91', ts: '1795565423988' }] }] };
    expect(parseOkxLiqHist(liq, 5)).toEqual([{ venue: 'okx', ts: 1795565423988, recv: 5, side: 'long', px: 59536.7, sz: 0.91, usd: 0.91 * 59536.7, floor: true }]);
    expect(() => parseOkxTaker({ code: '50011', msg: 'Too Many Requests' }, 0)).toThrow('OKX : 50011 Too Many Requests');
  });
  it('Bybit : historique de l’OI en BTC', () => {
    const b = { retCode: 0, retMsg: 'OK', result: { list: [{ openInterest: '67988.709', timestamp: '1795564800000' }] } };
    expect(parseBybitOiHist(b)).toEqual([{ ts: 1795564800000, oi_btc: 67988.709 }]);
  });
});
