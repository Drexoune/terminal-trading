// @vitest-environment node
// Lecture des sources de P3 (M1) sur les captures réelles du 24/11/2026 : OCDE, BCE, FRED, BIS ;
// variation sur un an, périodes et fins de période.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bisMonthly, fredCsv, fredMonthEnd, periodEnd, sdmxCsv, shiftPeriod, yoy } from './parse.ts';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('sources réelles', () => {
  it('OCDE : IPC COICOP 2018 du Japon et de la Suisse, global et sous-jacent', () => {
    const s = sdmxCsv(fx('oecd-cpi-2018-JPN-CHE-2026-11-24.csv'), ['REF_AREA', 'FREQ', 'EXPENDITURE']);
    expect(s.get('JPN|M|_T')!.at(-1)).toEqual({ period: '2026-10', value: 2.3 });
    expect(s.get('CHE|M|_TXCP01_NRG')!.at(-1)).toEqual({ period: '2026-10', value: 0.7980759 });
    expect(s.get('JPN|Q|_T')!.at(-1)!.period).toBe('2026-Q3');
  });
  it('BCE : libellés entre guillemets ; PIB trimestriel de la zone euro (I10)', () => {
    expect(sdmxCsv(fx('ecb-hicp-2026-11-24.csv'), ['REF_AREA']).get('U2')!.at(-1)).toEqual({ period: '2026-10', value: 4 });
    expect(sdmxCsv(fx('ecb-gdp-2026-11-24.csv'), ['REF_AREA']).get('I10')!.at(-1)!.period).toBe('2026-Q3');
  });
  it('FRED : indice mensuel, PIB trimestriel, changes en fin de mois', () => {
    const cpi = fredCsv(fx('fred-cpiaucsl-30-2026-11-24.csv'), 'M');
    expect(cpi.at(-1)).toEqual({ period: '2026-10', value: 337.476 });
    // Octobre 2025 absent de FRED (IPC non publié pendant la fermeture des services fédéraux de 2025) :
    // la variation sur un an d'octobre 2026 n'est pas calculée ; le dernier chiffre vient du BLS (agenda).
    const y = yoy(cpi, 'M');
    expect(y.at(-1)!.period).toBe('2026-09');
    expect(y.some((o) => o.period === '2026-10' || o.period === '2025-10')).toBe(false);
    expect(fredCsv(fx('fred-gdpc1-2026-11-24.csv'), 'Q').at(-1)).toEqual({ period: '2026-Q3', value: 24611.077 });
    const eur = fredMonthEnd(fx('fred-dexuseu-2026-11-24.csv'));
    expect(eur.at(-1)).toEqual({ period: '2026-11', value: 1.0981 });
  });
  it('BIS mensuel : taux directeur par zone', () => {
    const b = bisMonthly(fx('bis-monthly-2026-11-24.csv'));
    expect(b.get('US')!.at(-1)).toEqual({ period: '2026-10', value: 3.875 });
    expect(b.get('JP')!.at(-1)).toEqual({ period: '2026-10', value: 1.25 });
  });
});

describe('périodes', () => {
  it('décalages mensuels et trimestriels, fins de période', () => {
    expect(shiftPeriod('2026-01', -12)).toBe('2025-01');
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('2026-Q1', -4)).toBe('2025-Q1');
    expect(shiftPeriod('2026-Q1', -1)).toBe('2025-Q4');
    expect(periodEnd('2024-02')).toBe('2024-02-29');
    expect(periodEnd('2026-Q3')).toBe('2026-09-30');
  });
  it('sur un an : période exacte exigée, rien d’inventé quand elle manque', () => {
    expect(yoy([{ period: '2025-01', value: 100 }, { period: '2026-01', value: 103 }], 'M')).toEqual([{ period: '2026-01', value: 3 }]);
    expect(yoy([{ period: '2025-02', value: 100 }, { period: '2026-01', value: 103 }], 'M')).toEqual([]);
    expect(yoy([{ period: '2025-Q3', value: 200 }, { period: '2026-Q3', value: 205 }], 'Q')).toEqual([{ period: '2026-Q3', value: 2.5 }]);
  });
});

describe('sources nationales (T-058, captures du 24/11/2026)', () => {
  it('DBnomics : ONS mensuel, RBA daté au dernier jour, Statistics Japan ; « NA » ignorés', async () => {
    const { dbnomicsJson } = await import('./parse.ts');
    expect(dbnomicsJson(fx('dbnomics-ONS_MM23_D7G7.M-2026-11-24.json'), 'M').at(-1)).toEqual({ period: '2026-10', value: 3.6 });
    const rba = dbnomicsJson(fx('dbnomics-RBA_G1_GCPIAGYP-2026-11-24.json'), 'Q');
    expect(rba.at(-1)).toEqual({ period: '2026-Q3', value: 3.9 });   // périodes vides jusqu'en 2027 ignorées
    expect(dbnomicsJson(fx('dbnomics-STATJP_CPIm_001-2026-11-24.json'), 'M').at(-1)).toEqual({ period: '2026-10', value: 115.6 });
  });
  it('Statistics Canada : vecteurs mensuels et trimestriel', async () => {
    const { statcanJson } = await import('./parse.ts');
    const m = statcanJson(fx('statcan-5-vectors-2026-11-24.json'), { 41690973: 'M', 2062815: 'M', 62305752: 'Q', 108785714: 'M' });
    expect(m.get('2062815')!.at(-1)).toEqual({ period: '2026-10', value: 6.7 });
    expect(m.get('62305752')!.at(-1)!.period).toBe('2026-Q2');
    expect(m.has('52367097')).toBe(false);   // vecteur non demandé
  });
  it('BNS : IPC sur un an, PIB (SECO, corrigé des événements sportifs), chômage corrigé', async () => {
    const { snbCsv } = await import('./parse.ts');
    expect(snbCsv(fx('snb-plkopr-2026-11-24.csv'), ['VVP'], 'M').at(-1)).toEqual({ period: '2026-10', value: 1.456053 });
    expect(snbCsv(fx('snb-gdpap-2026-11-24.csv'), ['VVP', 'BBIPS'], 'Q').at(-1)).toEqual({ period: '2026-Q2', value: 1.49081462 });
    expect(snbCsv(fx('snb-amarbma-2026-11-24.csv'), ['S1'], 'M').at(-1)).toEqual({ period: '2026-10', value: 3.09398862 });
  });
  it('Nouvelle-Zélande : sur un an chaîné depuis quatre trimestres consécutifs', async () => {
    const { yoyFromQoq } = await import('./parse.ts');
    const q = fredCsv(fx('fred-naexkp01nzq657s-2026-11-24.csv'), 'Q');
    const y = yoyFromQoq(q);
    expect(y.at(-1)!.period).toBe('2026-Q2');
    expect(yoyFromQoq([{ period: '2026-Q1', value: 1 }, { period: '2026-Q2', value: 1 }, { period: '2026-Q3', value: 1 }, { period: '2026-Q4', value: 1 }]))
      .toEqual([{ period: '2026-Q4', value: 4.0604 }]);
    expect(yoyFromQoq([{ period: '2026-Q1', value: 1 }, { period: '2026-Q3', value: 1 }, { period: '2026-Q4', value: 1 }, { period: '2027-Q1', value: 1 }])).toEqual([]);
  });
});
