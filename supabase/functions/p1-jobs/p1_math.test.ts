// @vitest-environment node
// Calculs de P1 en ligne (O3) contre le fichier doré de Python : chiffres recalculés depuis la
// réponse réelle de l'API v1 du 23/11/2026, surprise brute, z.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DERIVATIONS, derive, parseResponse, sameValue, shift } from './bls_api.ts';
import { rawSurprise, zScore } from './surprise.ts';

const FIX = fileURLToPath(new URL('../../../gateway/tests/fixtures/bls/', import.meta.url));
const GOLDEN = JSON.parse(readFileSync(`${FIX}golden_math.json`, 'utf8')) as {
  latest: Record<string, string>; derive: Record<string, Record<string, [string, string] | null>>;
  shift: [string, number, string][]; surprise: [string | null, string | null, string | null][];
  z: [string | null, string[], string, string | null, number, boolean, string | null][];
};
const DATA = parseResponse(gunzipSync(readFileSync(`${FIX}api_v1_2026-11-23.json.gz`)).toString('utf8'));

describe('API v1 du BLS : portage de bls_api.py', () => {
  it('réponse réelle lue comme Python', () => {
    expect(DATA.latest).toEqual(GOLDEN.latest);
    expect(Object.keys(DERIVATIONS).sort()).toEqual(Object.keys(GOLDEN.derive));
  });

  it('chaque chiffre recalculé, pour chaque période, au caractère près', () => {
    let n = 0;
    for (const [ind, periods] of Object.entries(GOLDEN.derive)) {
      for (const [period, want] of Object.entries(periods)) {
        const d = derive(ind, period, DATA);
        expect(d ? [d.value, d.excerpt] : null, `${ind} ${period}`).toEqual(want);
        n++;
      }
    }
    expect(n).toBeGreaterThan(400);
  });

  it('périodes décalées ; égalité de valeurs décimales', () => {
    for (const [p, k, want] of GOLDEN.shift) expect(shift(p, k)).toBe(want);
    expect(sameValue('0.30', '0.3')).toBe(true);
    expect(sameValue('-0.0', '0.0')).toBe(true);
    expect(sameValue('0.3', null)).toBe(false);
    expect(() => parseResponse(JSON.stringify({ status: 'REQUEST_NOT_PROCESSED', message: ['Database is locked'] }))).toThrow(/locked/);
  });
});

describe('surprise et z : portage de surprise.py', () => {
  it('surprise brute exacte', () => {
    for (const [a, f, want] of GOLDEN.surprise) expect(rawSurprise(a, f), `${a} - ${f}`).toBe(want);
  });

  it('z, n, provisoire, raison', () => {
    for (const [s, hist, actual, z, n, provisional, reason] of GOLDEN.z) {
      expect(zScore(s, hist, actual), `${s} / ${hist.join(',')}`).toEqual({ z, n, provisional, reason });
    }
  });
});
