// @vitest-environment node
// Moteur (PineTS, T-062) sur 799 bougies quotidiennes réelles de BTC/USDT (OKX, 16/09/2024 →
// 23/11/2026) : stratégies connues compilées et exécutées, réglages de l'écran appliqués, marge
// désactivée par défaut, erreurs de syntaxe avec leur ligne.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, runStrategy, scriptInputs, type RunOk } from './engine';
import type { Candle } from './metrics';
import { KNOWN, knownById } from './strategies';

const BTC = JSON.parse(readFileSync(new URL('./fixtures/okx-btc-1d-2024-09-16_2026-11-23.json', import.meta.url), 'utf8')) as Candle[];
const ok = (r: Awaited<ReturnType<typeof runStrategy>>): RunOk => { if (!r.ok) throw new Error(r.error); return r; };

describe('stratégies connues', () => {
  for (const k of KNOWN) {
    it(`${k.name} : compile, s’exécute, produit des transactions`, async () => {
      const r = ok(await runStrategy(k.source, BTC, '1D'));
      expect(r.trades.length + r.open.length).toBeGreaterThan(0);
      for (const t of r.trades) expect(t.exit_bar).toBeGreaterThanOrEqual(t.entry_bar);
    });
  }
  it('paramètres lus dans le script, avec titres et options', () => {
    const p = scriptInputs(knownById('sma_cross')!.source);
    expect(Array.isArray(p) && p.map((x) => x.id)).toEqual(['dir', 'sl', 'tp', 'fastLen', 'slowLen']);
    expect(Array.isArray(p) && p.find((x) => x.id === 'dir')).toMatchObject({ title: 'Sens', value: 'Les deux', options: ['Long', 'Short', 'Les deux'] });
  });
});

describe('réglages', () => {
  const sma = knownById('sma_cross')!.source;
  it('croisement 20/50 : 16 allers-retours, entrée à l’ouverture suivante, taille = capital / (prix × (1 + commission))', async () => {
    const r = ok(await runStrategy(sma, BTC, '1D', { ...DEFAULT_SETTINGS, slippageTicks: 0 }));
    expect(r.trades.length).toBe(16);
    const t = r.trades[0];
    expect(t).toMatchObject({ side: 'short', entry_bar: 112, entry_price: BTC[112].o });
    expect(Math.abs(t.size)).toBeCloseTo(10_000 / (BTC[112].o * 1.0005), 5);
    expect(t.pnl).toBeCloseTo(-801.56, 1);
  });
  it('sens « Long » : aucun short, sortie sur le signal inverse', async () => {
    const r = ok(await runStrategy(sma, BTC, '1D', DEFAULT_SETTINGS, { dir: 'Long' }));
    expect(r.trades.every((t) => t.side === 'long')).toBe(true);
    expect(r.trades.length).toBeGreaterThan(5);
  });
  it('stop de 2 % : des sorties par stop, pertes bornées près de 2 % plus les frais', async () => {
    const r = ok(await runStrategy(sma, BTC, '1D', { ...DEFAULT_SETTINGS, slippageTicks: 0 }, { sl: 2 }));
    const stops = r.trades.filter((t) => t.exit_id === 'XL' || t.exit_id === 'XS');
    expect(stops.length).toBeGreaterThan(0);
    for (const t of stops) expect(t.pnl / (Math.abs(t.size) * t.entry_price)).toBeGreaterThan(-0.06);   // écart à l’ouverture possible
  });
  it('appels de marge de TradingView si demandés : positions fragmentées', async () => {
    const off = ok(await runStrategy(sma, BTC, '1D', DEFAULT_SETTINGS));
    const on = ok(await runStrategy(sma, BTC, '1D', { ...DEFAULT_SETTINGS, margin: true }));
    expect(on.trades.length).toBeGreaterThan(off.trades.length);
  });
  it('erreur de syntaxe : message et ligne', async () => {
    const r = await runStrategy('//@version=6\nstrategy("x")\nx = ta.sma(close\n', BTC, '1D');
    expect(r).toMatchObject({ ok: false, line: 4 });
    const noStrat = await runStrategy('//@version=6\nindicator("x")\nplot(close)\n', BTC, '1D');
    expect(noStrat).toMatchObject({ ok: false, error: expect.stringMatching(/strategy\(\)/) });
  });
});
