import { describe, expect, it } from 'vitest';
import { DEFAULT_HIGHLIGHTS, segments } from './highlight';

const hits = (t: string, w: readonly string[] = DEFAULT_HIGHLIGHTS) => segments(t, w).filter((s) => s.hit).map((s) => s.text);

describe('mots surlignés', () => {
  it('mots entiers, sans casse, expressions longues d’abord', () => {
    expect(hits('Nvidia CEO Jensen Huang says Fed rate cut is near')).toEqual(['Nvidia', 'Jensen', 'Huang', 'Fed', 'rate cut']);
    expect(hits('Federal budget, Fedex shares')).toEqual([]);                       // « Fed » jamais dans un autre mot
    expect(hits('S&P 500 futures rise; spot bitcoin ETFs see inflows')).toEqual(['S&P 500', 'bitcoin', 'ETFs']);
    expect(hits('the ETF and the btc price')).toEqual(['ETF', 'btc']);
  });

  it('le texte est conservé à l’identique', () => {
    const t = 'US CPI MoM Actual 0.3% (Forecast 0.2%) — Powell speaks';
    expect(segments(t, DEFAULT_HIGHLIGHTS).map((s) => s.text).join('')).toBe(t);
    expect(segments(t, [])).toEqual([{ text: t, hit: false }]);
    expect(hits('a+b (c) [d]', ['(c)', 'a+b'])).toEqual(['a+b', '(c)']);              // caractères spéciaux pris littéralement
  });
});
