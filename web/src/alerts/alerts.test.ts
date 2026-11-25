import { describe, expect, it } from 'vitest';
import { draftToBody, EMPTY_DRAFT, parseDecimal, ruleChip, sortRules, telegramText, unacked, type AlertEvent, type AlertRule } from './alerts';

const NOW = Date.UTC(2026, 11, 10, 13, 52);   // 14:52 Paris

function rule(over: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 1, kind: 'price', params: {}, channels: ['écran'], state: 'armée', label: 'BTC franchit 110 000',
    category: 'Prix · OKX', created_ms: 0, updated_ms: 0, last_fired_ms: null, ...over,
  };
}

function event(over: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: 'a', rule_id: 1, kind: 'price', rule_label: 'x', category: 'Prix · OKX', fired_ms: NOW - 60_000, title: 't',
    body: null, source: 'OKX', source_ms: null, data: {}, telegram: null, telegram_ms: null, telegram_error: null,
    acked_ms: null, voice: false, ...over,
  };
}

describe('état des règles', () => {
  it('« Déclenchée hh:mm » comme dans la maquette, à l’heure de Paris', () => {
    expect(ruleChip(rule(), NOW)).toEqual({ text: 'Armée', variant: 'armed' });
    expect(ruleChip(rule({ state: 'déclenchée', last_fired_ms: NOW }), NOW)).toEqual({ text: 'Déclenchée 14:52', variant: 'fired' });
    // Une règle récurrente reste armée : son dernier déclenchement récent se montre 30 min.
    expect(ruleChip(rule({ last_fired_ms: NOW - 10 * 60_000 }), NOW).variant).toBe('fired');
    expect(ruleChip(rule({ last_fired_ms: NOW - 40 * 60_000 }), NOW).variant).toBe('armed');
    expect(ruleChip(rule({ state: 'désactivée' }), NOW).text).toBe('Désactivée');
  });

  it('tri : déclenchées, armées, désactivées', () => {
    const r = sortRules([rule({ id: 1, state: 'désactivée' }), rule({ id: 2 }), rule({ id: 3, state: 'déclenchée' })]);
    expect(r.map((x) => x.id)).toEqual([3, 2, 1]);
  });

  it('à acquitter : non acquittées des dernières 24 h', () => {
    const list = [event(), event({ id: 'b', acked_ms: NOW }), event({ id: 'c', fired_ms: NOW - 2 * 86_400_000 })];
    expect(unacked(list, NOW).map((e) => e.id)).toEqual(['a']);
  });

  it('état Telegram lisible', () => {
    expect(telegramText(event())).toBeNull();
    expect(telegramText(event({ telegram: 'envoyé', telegram_ms: NOW }))).toBe('Telegram : envoyé à 14:52');
    expect(telegramText(event({ telegram: 'échec', telegram_error: 'Unauthorized' }))).toBe('Telegram : échec (Unauthorized)');
  });
});

describe('formulaire', () => {
  it('lit les nombres à la française', () => {
    expect(parseDecimal('110 000,5')).toBe('110000.5');
    expect(parseDecimal('−0,02')).toBe('-0.02');
    expect(parseDecimal('abc')).toBeNull();
  });

  it('construit le corps de la requête, ou dit ce qui manque', () => {
    expect(draftToBody({ ...EMPTY_DRAFT, level: '110 000' })).toEqual({
      body: { kind: 'price', params: { inst: 'BTC-USDT-SWAP', level: '110000', direction: 'les deux' }, channels: ['écran', 'telegram'] },
    });
    expect(draftToBody({ ...EMPTY_DRAFT, level: '' })).toEqual({ error: 'Prix : saisir un niveau positif.' });
    expect(draftToBody({ ...EMPTY_DRAFT, kind: 'event_soon', currencies: 'usd, eur', telegram: false, voice: true })).toEqual({
      body: { kind: 'event_soon', params: { minutes: 5, captured_only: true, impacts: [], currencies: ['USD', 'EUR'] }, channels: ['écran', 'voix'] },
    });
    expect('error' in draftToBody({ ...EMPTY_DRAFT, kind: 'surprise' })).toBe(true);
    expect(draftToBody({ ...EMPTY_DRAFT, kind: 'keyword', words: 'Powell, ETF ,' })).toMatchObject({ body: { params: { words: ['Powell', 'ETF'] } } });
  });
});

describe('règle d’écart entre sources (P2, R5)', () => {
  it('banque ou toutes, seuil de 0 à 50 points', () => {
    expect(draftToBody({ ...EMPTY_DRAFT, kind: 'rate_gap', gapBank: 'FED', gapPts: '2,5', telegram: false }))
      .toEqual({ body: { kind: 'rate_gap', params: { bank: 'FED', threshold_pts: '2.5' }, channels: ['écran'] } });
    expect(draftToBody({ ...EMPTY_DRAFT, kind: 'rate_gap', gapBank: '', gapPts: '5' }))
      .toMatchObject({ body: { params: { bank: null, threshold_pts: '5' } } });
    expect(draftToBody({ ...EMPTY_DRAFT, kind: 'rate_gap', gapPts: '80' })).toEqual({ error: 'Écart : saisir un seuil de 0 à 50 points.' });
  });
});

describe('sortes de la machine Oracle (T-071)', () => {
  it('liquidations : M$ saisis → dollars ; fenêtre bornée', () => {
    expect(draftToBody({ ...EMPTY_DRAFT, kind: 'liquidations', liqUsd: '2,5', liqWindow: '3', liqSide: 'long', telegram: true }))
      .toEqual({ body: { kind: 'liquidations', params: { min_usd: '2500000', window_min: 3, side: 'long' }, channels: ['écran', 'telegram'] } });
    expect(draftToBody({ ...EMPTY_DRAFT, kind: 'liquidations', liqWindow: '90' })).toEqual({ error: 'Liquidations : fenêtre de 1 à 60 minutes.' });
  });
  it('mur retiré : taille minimale de 10 BTC', () => {
    expect(draftToBody({ ...EMPTY_DRAFT, kind: 'wall', wallBtc: '150', wallSide: 'vente', telegram: false }))
      .toEqual({ body: { kind: 'wall', params: { min_btc: '150', side: 'vente' }, channels: ['écran'] } });
    expect(draftToBody({ ...EMPTY_DRAFT, kind: 'wall', wallBtc: '5' })).toEqual({ error: 'Mur retiré : saisir une taille d’au moins 10 BTC.' });
  });
});

describe('juge des prix (T-071)', () => {
  const o = { ok: true, at: 1_000_000, armed: 2, fired: 0, ws: { status: 'connected', reconnects: 0, last_error: null }, last_trade_ms: {}, micro_stream: { connected: true, error: null } };
  it('Oracle à la seconde si son battement est frais et sa WebSocket connectée, sinon Supabase', async () => {
    const { judgeOf } = await import('./alerts');
    expect(judgeOf(o, 1_050_000)).toMatchObject({ text: 'Prix · Oracle à la seconde', live: true });
    expect(judgeOf(o, 1_100_000)).toMatchObject({ text: 'Prix · Supabase à la minute', live: false });
    expect(judgeOf({ ...o, ok: false }, 1_010_000).live).toBe(false);
    expect(judgeOf(undefined, 0).title).toMatch(/jamais vue/);
  });
});
