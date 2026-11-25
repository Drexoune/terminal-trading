// @vitest-environment node
// Indicateurs (P7, S2) : valeurs identiques à pinets (Pine Script) sur 300 jours de BTC réels.
import { readFileSync } from 'node:fs';
import { Indicator, PineTS } from 'pinets';
import { describe, expect, it } from 'vitest';
import { atr, ema, macd, rsi, snapshot, type Ohlc } from './ta';

const bars = (JSON.parse(readFileSync(new URL('../backtest/fixtures/okx-btc-1d-2024-09-16_2026-11-23.json', import.meta.url), 'utf8')) as Ohlc[]).slice(0, 300);
const SRC = `//@version=6
indicator("t")
plot(ta.ema(close, 20), "ema20")
plot(ta.ema(close, 200), "ema200")
plot(ta.rsi(close, 14), "rsi")
plot(ta.atr(14), "atr")
[m, s, h] = ta.macd(close, 12, 26, 9)
plot(m, "macd")
plot(s, "sig")`;

describe('indicateurs contre pinets', () => {
  it('EMA 20 et 200, RSI 14, ATR 14, MACD 12/26/9', async () => {
    const k = bars.map((b) => ({ openTime: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: 0, closeTime: b.t + 86_399_999 }));
    const ctx = await new PineTS(k, 'X', 'D').run(new Indicator(SRC));
    const ref = (name: string) => (ctx.plots[name].data as { value: number }[]).map((p) => p.value);
    const c = bars.map((b) => b.c), m = macd(c);
    const pairs: [string, (number | null)[]][] = [['ema20', ema(c, 20)], ['ema200', ema(c, 200)], ['rsi', rsi(c)], ['atr', atr(bars)], ['macd', m.macd], ['sig', m.signal]];
    for (const [name, ours] of pairs) {
      const theirs = ref(name);
      let compared = 0;
      for (let i = 0; i < c.length; i++) {
        const t = theirs[i], o = ours[i];
        if (o === null || t === null || t === undefined || Number.isNaN(t)) continue;
        expect(Math.abs(o - t) / Math.max(1, Math.abs(t)), `${name}[${i}]`).toBeLessThan(1e-6);
        compared++;
      }
      expect(compared, name).toBeGreaterThan(50);
    }
  });
});

describe('état de tendance', () => {
  it('série montante : haussier, 5 signaux sur 5', () => {
    const up: Ohlc[] = Array.from({ length: 260 }, (_, i) => ({ t: i, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i + (i % 3 === 0 ? -0.8 : 0) }));
    const s = snapshot(up, 252)!;
    expect(s.trend).toBe('up');
    expect(s.score).toBeGreaterThanOrEqual(3);
    expect(s.from_high).toBeLessThanOrEqual(0);
  });
  it('historique trop court : tendance inconnue', () => {
    expect(snapshot(bars.slice(0, 30), 252)!.trend).toBeNull();
  });
});
