// @vitest-environment node
// Portage TypeScript du parseur BLS (O3) contre la lecture Python des 124 pages du corpus
// réel du 20/11/2026 : chaque champ, chaque citation, chaque raison, au caractère près.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classify, parsePage } from './bls_release.ts';

const FIX = fileURLToPath(new URL('../../../gateway/tests/fixtures/bls/', import.meta.url));
const PAGES = JSON.parse(gunzipSync(readFileSync(`${FIX}releases_2026-11-20.json.gz`)).toString('utf8')) as Record<string, string>;
const GOLDEN = JSON.parse(readFileSync(`${FIX}golden_parser.json`, 'utf8')) as {
  pages: Record<string, Record<string, unknown>>;
  classify: [string, string, [string, string] | null, string | null][];
  special: Record<string, { page: string; problems: string[] }>;
};
const enc = (s: string) => new TextEncoder().encode(s);

function view(name: string) {
  const p = parsePage(name.split('_')[0], enc(PAGES[name]));
  const figures = Object.fromEntries(Object.entries(p.figures).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, f]) => [k, { value: f.value, reason: f.reason, part: f.part, excerpt: f.excerpt, flags: f.flags }]));
  return { page: p.page, title: p.title, period: p.period, edition: p.edition, embargo_text: p.embargo_text,
    embargo_ms: p.embargo_ms, embargo_date: p.embargo_date, problems: p.problems, figures };
}

describe('parseur BLS en ligne : portage de bls_release.py', () => {
  it('le corpus a bien ses 124 pages', () => {
    expect(Object.keys(PAGES)).toHaveLength(124);
    expect(Object.keys(GOLDEN.pages)).toEqual(Object.keys(PAGES).sort());
  });

  it.each(Object.keys(GOLDEN.pages))('%s : même lecture que Python', (name) => {
    expect(view(name)).toEqual(GOLDEN.pages[name]);
  });

  it('nouveauté : date d’embargo et version de référence', () => {
    for (const [name, date, base, verdict] of GOLDEN.classify) {
      expect(classify(parsePage(name.split('_')[0], enc(PAGES[name])), date, base), `${date} ${base}`).toBe(verdict);
    }
  });

  it('pages vides, corrompues, d’erreur ou sans texte', () => {
    const cases: Record<string, Uint8Array> = {
      vide: enc('  \n'),
      'octets nuls': new Uint8Array([60, 104, 0, 0, 62]),
      erreur: enc('<html><title>Sorry, the page cannot be found</title></html>'),
      'sans pre': enc('<html><title>Consumer Price Index</title><p>x</p></html>'),
    };
    for (const [label, raw] of Object.entries(cases)) {
      const p = parsePage('cpi', raw);
      expect({ page: p.page, problems: p.problems }, label).toEqual(GOLDEN.special[label]);
    }
  });
});
