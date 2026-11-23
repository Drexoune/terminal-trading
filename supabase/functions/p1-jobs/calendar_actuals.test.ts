// @vitest-environment node
// Réel tiré de FinancialJuice (T-048) : titres et événements réels du 23/11/2026.
import { describe, expect, it } from 'vitest';
import { actualFor, matchFigure, words, type FigureItem } from './calendar_actuals.ts';
import { classify, FEED_BY_ID } from './news_rules.ts';

const T = Date.UTC(2026, 10, 23, 14, 45);
const EVENTS = [
  { id: '552-us-flash-manufacturing-pmi|USD|2026-11-23|1', title: 'Flash Manufacturing PMI', currency: 'USD', time_ms: T, forecast_raw: '54.5' },
  { id: '583-us-flash-services-pmi|USD|2026-11-23|1', title: 'Flash Services PMI', currency: 'USD', time_ms: T, forecast_raw: '55.6' },
  { id: '837-uk-flash-manufacturing-pmi|GBP|2026-11-23|1', title: 'Flash Manufacturing PMI', currency: 'GBP', time_ms: Date.UTC(2026, 10, 23, 9, 30), forecast_raw: '53.0' },
  { id: '266-ge-flash-manufacturing-pmi|EUR|2026-11-23|1', title: 'German Flash Manufacturing PMI', currency: 'EUR', time_ms: Date.UTC(2026, 10, 23, 8, 30), forecast_raw: '54.1' },
  { id: '263-ez-flash-manufacturing-pmi|EUR|2026-11-23|1', title: 'Flash Manufacturing PMI', currency: 'EUR', time_ms: Date.UTC(2026, 10, 23, 9), forecast_raw: '52.7' },
  { id: '1-uk-retail-sales-mm|GBP|2026-11-20|1', title: 'Retail Sales m/m', currency: 'GBP', time_ms: Date.UTC(2026, 10, 20, 7), forecast_raw: '0.0%' },
];
const fj = (id: number, title: string, t: number): FigureItem => ({
  id, title, published_ms: t, received_ms: t + 8000, figure: classify(FEED_BY_ID.get('financialjuice')!, title, t).figure as FigureItem['figure'] });

describe('réel tiré du fil d’actus', () => {
  it('mots : pays, éditeurs et éditions retirés ; MoM = m/m', () => {
    expect(words('S&P Manufacturing PMI Flash')).toBe(words('Flash Manufacturing PMI'));
    expect(words('Retail Sales MoM')).toBe(words('Retail Sales m/m'));
    expect(words('Core Retail Sales MoM')).not.toBe(words('Retail Sales m/m'));
  });

  it('PMI américains du 23/11 : manufacturier et services rattachés, composite sans événement', () => {
    const m = fj(1, 'US S&P Manufacturing PMI Flash Actual 54.5 (Forecast 54.5, Previous 54.9)', T);
    expect(matchFigure(m, EVENTS)?.id).toBe(EVENTS[0].id);
    expect(actualFor(m, EVENTS[0])).toMatchObject({ actual: '54.5', actual_raw: '54.5', unit: null, delay_ms: 0, source: 'FinancialJuice' });
    // Consensus différent (55,5 contre 55,6) : le rattachement tient sur le pays, les mots et l'heure.
    expect(matchFigure(fj(2, 'US S&P Services PMI Flash Actual 54.7 (Forecast 55.5, Previous 56.1)', T), EVENTS)?.id).toBe(EVENTS[1].id);
    expect(matchFigure(fj(3, 'US S&P Composite PMI Flash Actual 54.6 (Forecast 55.6, Previous 55.9)', T), EVENTS)).toBeNull();
  });

  it('zone euro : l’Allemagne n’est pas la zone euro, la zone euro n’est pas l’Allemagne', () => {
    const de = fj(4, 'German HCOB Manufacturing PMI Flash Actual 54.3 (Forecast 54.1, Previous 54.2)', Date.UTC(2026, 10, 23, 8, 30, 5));
    expect(matchFigure(de, EVENTS)?.id).toBe(EVENTS[3].id);
    const ez = fj(5, 'Eurozone HCOB Manufacturing PMI Flash Actual 52.9 (Forecast 52.7, Previous 52.8)', Date.UTC(2026, 10, 23, 9, 0, 4));
    expect(matchFigure(ez, EVENTS)?.id).toBe(EVENTS[4].id);
  });

  it('jamais de rattachement douteux : autre indicateur, hors fenêtre, pays inconnu, réel absent', () => {
    expect(matchFigure(fj(6, 'UK Core Retail Sales MoM Actual 0.9% (Forecast 0.1%, Previous -0.7%)', Date.UTC(2026, 10, 20, 7)), EVENTS)).toBeNull();
    const rs = fj(7, 'UK Retail Sales MoM Actual 0.7% (Forecast 0%, Previous -0.4%)', Date.UTC(2026, 10, 20, 7, 0, 2));
    expect(actualFor(rs, matchFigure(rs, EVENTS)!)).toMatchObject({ actual: '0.7', unit: '%' });
    expect(matchFigure({ ...rs, published_ms: Date.UTC(2026, 10, 20, 8) }, EVENTS)).toBeNull();
    expect(matchFigure(fj(8, 'Swedish Unemployment Rate Actual 7.7% (Forecast -, Previous 8.1%)', T), EVENTS)).toBeNull();
    expect(matchFigure(fj(9, 'US S&P Manufacturing PMI Flash Actual - (Forecast 54.5, Previous 54.9)', T), EVENTS)).toBeNull();
  });
});
