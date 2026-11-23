// @vitest-environment node
// Fil d'actus (E6/O6) : lecture des 15 flux capturés le 20/11/2026, heures, règles, doublons.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalUrl, classify, cleanTitle, decodeFeed, FEED_BY_ID, FEEDS, FJ_NOISE, nearDuplicate, parseFeed, parseFeedDate, RULES_VERSION,
} from './news_rules.ts';

const fixture = (id: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../gateway/tests/fixtures/news/${id}.xml`, import.meta.url))));
const feed = (id: string) => FEED_BY_ID.get(id)!;
const RECV = 1795186369759;   // 20/11/2026 14:52:49 UTC, heure de la capture

describe('fil d’actus : lecture des captures réelles', () => {
  it('les 15 flux se lisent, chaque élément a un titre, un lien et une heure plausible', () => {
    const counts: Record<string, number> = {};
    for (const f of FEEDS) {
      const items = parseFeed(fixture(f.id));
      counts[f.id] = items.length;
      for (const it of items) {
        expect(it.title, f.id).not.toMatch(/<|&[a-z]+;|CDATA/);
        expect(canonicalUrl(it.link), `${f.id} ${it.link}`).toMatch(/^https:\/\//);
        const t = parseFeedDate(it.date_raw, f);
        expect(t, `${f.id} ${it.date_raw}`).not.toBeNull();
        expect(t!).toBeLessThan(RECV + 60_000);                       // jamais dans le futur
        expect(t!).toBeGreaterThan(Date.UTC(2015, 0, 1));
      }
    }
    expect(counts).toEqual({
      'fed-monetary': 15, 'fed-all': 20, 'fed-speeches': 15, 'ecb-press': 15, 'ecb-mid': 20, 'boe-news': 50, 'boe-speeches': 50,
      'boj-whatsnew': 47, 'snb-pressrel': 20, 'snb-mopo': 15, 'boc-press': 10, 'boc-announcements': 10, 'rba-media': 1,
      'rbnz-news': 50, financialjuice: 100,
    });
  });

  it('pièges de fuseau : BoC à Toronto malgré « +00:00 », BoE « Z », RBA sans secondes, MID sans fuseau', () => {
    expect(parseFeedDate('2026-11-16T10:00:04+00:00', feed('boc-press'))).toBe(Date.UTC(2026, 10, 16, 15, 0, 4));
    expect(parseFeedDate('2026-07-15T09:45:00+00:00', feed('boc-press'))).toBe(Date.UTC(2026, 6, 15, 13, 45));   // heure d'été
    expect(parseFeedDate('Thu, 19 Nov 2026 08:00:00 Z', feed('boe-news'))).toBe(Date.UTC(2026, 10, 19, 8));
    expect(parseFeedDate('2026-11-06T10:45+11:00', feed('rba-media'))).toBe(Date.UTC(2026, 10, 5, 23, 45));
    expect(parseFeedDate('2026/11/20 11:25:22', feed('ecb-mid'))).toBe(Date.UTC(2026, 10, 20, 10, 25, 22));
    expect(parseFeedDate('Fri, 20 Nov 2026 11:00:00 +0900', feed('boj-whatsnew'))).toBe(Date.UTC(2026, 10, 20, 2));
    expect(parseFeedDate('2026-10-30T06:15:00Z', feed('snb-pressrel'))).toBe(Date.UTC(2026, 9, 30, 6, 15));
    expect(parseFeedDate('hier', feed('fed-all'))).toBeNull();
    expect(parseFeedDate('Fri, 20 Nov 2026 11:00:00 XYZ', feed('fed-all'))).toBeNull();
  });

  it('encodage : déclaration XML, sinon UTF-8 ; jamais de mojibake sur les captures', () => {
    for (const f of FEEDS) for (const it of parseFeed(fixture(f.id))) expect(it.title, f.id).not.toMatch(/â€|Ã./);
    expect(decodeFeed(new Uint8Array([0x3c, 0x61, 0x3e, 0xe9]), 'text/xml; charset=iso-8859-1')).toBe('<a>é');
  });

  it('URL canonique : double barre de la BCE, http de la BoJ, ?xy=rss de FinancialJuice', () => {
    expect(canonicalUrl('https://www.ecb.europa.eu//press/key/date/2026/html/x.en.html')).toBe('https://www.ecb.europa.eu/press/key/date/2026/html/x.en.html');
    expect(canonicalUrl('http://www.boj.or.jp/en/research/imes/mes/mes26.htm')).toBe('https://www.boj.or.jp/en/research/imes/mes/mes26.htm');
    expect(canonicalUrl('https://www.financialjuice.com/News/9861905/X.aspx?xy=rss')).toBe('https://www.financialjuice.com/News/9861905/X.aspx');
    expect(canonicalUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('fil d’actus : règles versionnées', () => {
  it('décisions des banques centrales, sur les titres réels', () => {
    const urgent = (id: string) => parseFeed(fixture(id)).filter((i) => classify(feed(id), i.title, parseFeedDate(i.date_raw, feed(id))).urgent).map((i) => i.title);
    expect(urgent('fed-monetary')).toEqual([
      'Minutes of the Federal Open Market Committee, October 27-28, 2026', 'Federal Reserve issues FOMC statement',
      'Minutes of the Federal Open Market Committee, September 15-16, 2026', 'Federal Reserve issues FOMC statement',
      'Minutes of the Federal Open Market Committee, July 28–29, 2026', 'Federal Reserve issues FOMC statement',
      'Minutes of the Federal Open Market Committee, June 16-17, 2026', 'Federal Reserve issues FOMC statement',
      'Minutes of the Federal Open Market Committee, April 28-29, 2026', 'Federal Reserve issues FOMC statement',
    ].slice(0, urgent('fed-monetary').length));
    expect(urgent('rbnz-news')).toContain('OCR held at 2.75%');
    expect(urgent('snb-mopo').length).toBeGreaterThan(0);
    expect(urgent('boj-whatsnew')).toEqual(['Statement on Monetary Policy']);
    expect(urgent('boe-speeches')).toEqual([]);
    const bns = feed('snb-mopo');
    expect(classify(bns, '2026-09-24 - Monetary policy assessment of 24 September 2026', Date.UTC(2026, 8, 24, 7, 30)).urgent).toBe(true);
    expect(classify(bns, '2026-09-24 - Monetary policy assessment of 24 September 2026', Date.UTC(2026, 8, 30, 7, 30)).urgent).toBe(false);
    expect(classify(feed('boe-news'), 'BANK RATE MAINTAINED AT 3.75% - NOVEMBER 2026', null)).toMatchObject({ urgent: true, rule: 'decision:BOE' });
    expect(classify(feed('boc-press'), 'Bank of Canada maintains policy rate at 2¼%', null).urgent).toBe(true);
    expect(classify(feed('ecb-press'), 'Monetary policy decisions', null).urgent).toBe(true);
  });

  it('FinancialJuice : chiffre structuré, catégories, rubriques écartées', () => {
    const fj = feed('financialjuice');
    expect(classify(fj, 'UK Retail Sales MoM Actual 0.7% (Forecast 0%, Previous -0.4%)', null)).toEqual({
      category: 'macro', urgent: true, rule: 'figure:major', figure: { name: 'UK Retail Sales MoM', actual: '0.7%', forecast: '0%', previous: '-0.4%', revised: null } });
    expect(classify(fj, 'Canadian Retail Sales MoM Actual 0.8% (Forecast 0.7%, Previous 1.2%, Revised 1.4%)', null).figure?.revised).toBe('1.4%');
    expect(classify(fj, 'Swedish Unemployment Rate Actual 7.7% (Forecast -, Previous 8.1%)', null)).toMatchObject({ urgent: false, rule: 'figure', figure: { forecast: null } });
    expect(classify(fj, 'French Business Climate Mfg Actual 104 (Forecast 103, Previous 105)', null).urgent).toBe(false);
    expect(classify(fj, "ECB's Nagel: Inflation is too high", null).category).toBe('banque-centrale');
    expect(classify(fj, 'Spot bitcoin ETFs see fourth day of inflows', null).category).toBe('crypto');
    expect(classify(fj, 'Gold rises to three-week high', null).category).toBe('matieres-premieres');
    expect(classify(fj, 'UK-EU summit deal is done', null)).toEqual({ category: 'general', urgent: false, rule: null, figure: null });
    const titles = parseFeed(fixture('financialjuice')).map((i) => cleanTitle(fj, i.title));
    expect(titles[0]).toBe('House Committee calls to remove some China AI models from the Fed system.');
    const noise = titles.filter((t) => FJ_NOISE.test(t));
    expect(noise).toContain('Fed Interest Rate Probabilities');
    expect(noise).toContain('Credit Ágricole: FX Weekly - FJElite');
    expect(noise).not.toContain('UK Retail Sales MoM Actual 0.7% (Forecast 0%, Previous -0.4%)');
    expect(noise.length).toBe(25);
    expect(RULES_VERSION).toMatch(/^r1-[0-9a-f]{8}$/);
  });

  it('quasi-doublons : mêmes mots et mêmes nombres seulement', () => {
    expect(nearDuplicate('USTR Greer: Trump-Xi meeting constructive.', 'USTR Greer: Trump-Xi meeting was constructive')).toBe(true);
    expect(nearDuplicate('USTR Greer: China brought up Taiwan in talks this week', 'USTR Greer: China AG buying and rare earths would boost goodwill')).toBe(false);
    expect(nearDuplicate('Russian Foreign Ministry: No agreement on next round of Ukraine talks - TASS',
      'Russian Foreign Ministry: no agreement on next round of Ukraine talks - IFX')).toBe(true);
    expect(nearDuplicate('US CPI YoY Actual 3.1% (Forecast 3.0%)', 'US CPI YoY Actual 3.2% (Forecast 3.0%)')).toBe(false);
  });
});
