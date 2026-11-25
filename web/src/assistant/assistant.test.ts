// @vitest-environment node
// Faits de l'assistant (P6) : formats fr-FR, sources, écrans ; une réponse recopiant un fait passe
// le contrôleur, un calcul de l'IA est écarté ; le client refuse ce que le contrôle local refuse.
import { describe, expect, it } from 'vitest';
import { verifyAnswer } from '../../../api/_lib/assistant-core';
import { buildFacts } from './facts';
import { ask } from './client';

const NOW = Date.parse('2026-11-25T14:30:00Z');
const T = { inst: 'BTC-USDT-SWAP', last: 108_420.5, bid: null, ask: null, open24h: 110_452.8, high24h: 111_000, low24h: 107_900, sod_utc0: null, vol_base24h: null, ts_source: NOW, ts_recv: NOW };
const sp = (s: string) => s.replace(/[  ]/g, ' ');

describe('faits', () => {
  const facts = buildFacts({ now: NOW, tickers: [T],
    article: { id: 7, feed: 'treeofalpha', source: 'Tree of Alpha · The Block', kind: 'agence', bank: null, title: 'The Block: ETF inflows hit $1.2B', summary: null, url: null,
      category: 'crypto', urgent: false, rule: null, rules_version: 'x', figure: null, published_ms: NOW, published_raw: null, received_ms: NOW, backfill: false, lang: 'en' } as never,
    liqs: { long_usd: 66_700_000, short_usd: 1_520_000 } as never });
  it('numérotés, sourcés, liés à un écran, formatés fr-FR', () => {
    expect(facts.map((f) => f.id)).toEqual(facts.map((_, k) => `F${k + 1}`));
    const px = facts.find((f) => f.label === 'BTC-USDT perp · dernier prix')!;
    expect(sp(px.value)).toBe('108 420,5 $');
    expect(px).toMatchObject({ source: 'OKX', href: '/graphiques' });
    expect(sp(facts.find((f) => f.label.includes('variation sur 24 h'))!.value)).toBe('−1,84 %');
    expect(sp(facts.find((f) => f.label.startsWith('Liquidations'))!.value)).toBe('longs 66,7 M$, shorts 1,5 M$ (Binance et OKX : minimums)');
    expect(facts[0]).toMatchObject({ label: 'Article ouvert · titre (VO)', value: 'The Block: ETF inflows hit $1.2B' });
  });
  it('recopier un fait passe ; calculer est écarté', () => {
    const px = facts.find((f) => f.label === 'BTC-USDT perp · dernier prix')!;
    expect(verifyAnswer(`Le BTC cote ${px.value}.`, [px.id], facts).ok).toBe(true);
    expect(verifyAnswer('Le BTC a perdu 2 032,3 $ sur 24 h.', [px.id], facts).ok).toBe(false);
    expect(verifyAnswer('Les ETF ont reçu 1.2 milliard selon The Block.', ['F1'], facts).ok).toBe(true);
  });
});

describe('client', () => {
  it('une réponse acceptée par le serveur mais refusée par le contrôle local n’est pas affichée', async () => {
    const facts = buildFacts({ now: NOW, tickers: [T] });
    const fake = (async () => new Response(JSON.stringify({ ok: true, answer: 'Le BTC cote 999 $.', sources: ['F1'] }), { status: 200 })) as typeof fetch;
    expect(await ask('Prix ?', facts, fake)).toMatchObject({ ok: false });
    const good = (async () => new Response(JSON.stringify({ ok: true, answer: `Le BTC cote ${facts[0].value}.`, sources: ['F1'] }), { status: 200 })) as typeof fetch;
    expect(await ask('Prix ?', facts, good)).toMatchObject({ ok: true });
  });
});
