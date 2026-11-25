// Sortes d'alerte jugées par la machine Oracle (T-071) : liquidations et mur retiré. Absentes du
// fichier doré de Python (la passerelle du Mode Local ne les connaît pas).
import { describe, expect, it } from 'vitest';
import * as ar from './alert_rules.ts';

const I = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'];
const sp = (s: string) => s.replace(/[  ]/g, ' ');

describe('liquidations', () => {
  it('validation : défauts, bornes, côtés', () => {
    expect(ar.validate('liquidations', { min_usd: '5000000' }, ['telegram'], I)).toEqual([{ min_usd: '5000000', window_min: 5, side: 'les deux' }, ['écran', 'telegram']]);
    expect(() => ar.validate('liquidations', { min_usd: '50000' }, [], I)).toThrow('montant minimal : 100 000 $');
    expect(() => ar.validate('liquidations', { min_usd: '1000000', window_min: 61 }, [], I)).toThrow('fenêtre : entier de 1 à 60 minutes');
    expect(() => ar.validate('liquidations', { min_usd: '1000000', side: 'acheteur' }, [], I)).toThrow('côté : long, short ou les deux');
  });
  it('libellé et message : montant en M$, détail par plateforme, planchers rappelés', () => {
    const [p] = ar.validate('liquidations', { min_usd: '2500000', window_min: 1, side: 'long' }, [], I);
    expect(ar.describe('liquidations', p).map(sp)).toEqual(['Liquidations longues ≥ 2,5 M$ en 1 min', 'Microstructure · Oracle']);
    const [t, b] = ar.liquidationsMessage(p, 12_340_000, { okx: 2_000_000, binance: 10_340_000 }, 7).map(sp);
    expect(t).toBe('Liquidations : 12,3 M$ en 1 min (longues)');
    expect(b).toBe('7 liquidation(s) : Binance 10,3 M$ · OKX 2 M$ · Binance et OKX diffusent au plus une liquidation par seconde : minimum · Hyperliquid : aucun flux public');
  });
});

describe('mur retiré', () => {
  it('validation et libellé', () => {
    const [p] = ar.validate('wall', { min_btc: '150', side: 'vente' }, [], I);
    expect(p).toEqual({ min_btc: '150', side: 'vente' });
    expect(ar.describe('wall', p).map(sp)).toEqual(['Mur retiré ≥ 150 BTC côté vente', 'Microstructure · Oracle']);
    expect(() => ar.validate('wall', { min_btc: '5' }, [], I)).toThrow('taille minimale : 10 BTC');
  });
  it('message : taille, prix, côté, reste, jamais un stop supposé', () => {
    const [t, b] = ar.wallMessage({ px: 59_300, sz: 417.59, side: 'bid', left: 44.78 }, '07:05').map(sp);
    expect(t).toBe('Mur retiré : 418 BTC à 59 300 (achat)');
    expect(b).toContain('Il reste 44,8 BTC à 07:05 (Paris)');
    expect(b).toContain('jamais un stop supposé');
  });
});
