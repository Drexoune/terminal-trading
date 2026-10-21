import { describe, expect, it } from 'vitest';
import type { FeedState } from '../data/protocol';
import { feedDetail } from './FeedBar';

const feed = (over: Partial<FeedState> = {}): FeedState => ({
  name: 'okx-public', status: 'connected', connected_since_ms: 0, last_message_ms: 0,
  reconnects: 0, outages: [], last_error: null, ...over,
});

describe('détail des flux au survol', () => {
  it('sans incident : reconnexions et aucun trou', () => {
    expect(feedDetail('connecté', feed(), { count: 0, last: '', ts_recv: 0 }))
      .toBe('connecté · 0 reconnexion(s) · aucun trou de séquence');
  });

  it('coupure, erreur et trou de séquence, heures de Paris', () => {
    const t = Date.parse('2026-10-20T13:36:00Z');
    const d = feedDetail('connecté', feed({
      reconnects: 2, last_error: 'ConnectionError: pas de pong',
      outages: [{ from_ms: t, to_ms: t + 4_200, duration_ms: 4_200 }],
    }), { count: 3, last: 'BTC-USDT-SWAP : 12 trade(s) manquant(s) entre 1 et 14', ts_recv: t + 4_300 });
    expect(d).toBe('connecté · 2 reconnexion(s) · dernière coupure 15:36:00, 4,2 s'
      + ' · erreur : ConnectionError: pas de pong'
      + ' · 3 trou(s) de séquence, dernier 15:36:04 : BTC-USDT-SWAP : 12 trade(s) manquant(s) entre 1 et 14');
  });

  it('abonnements refusés par OKX', () => {
    expect(feedDetail('connecté', feed({ rejected: ['tickers FOO-USDT-SWAP'] })))
      .toBe('connecté · 0 reconnexion(s) · refusé(s) par OKX : tickers FOO-USDT-SWAP');
  });

  it('flux de bougies : pas de journal de trous', () => {
    expect(feedDetail('déconnecté', undefined)).toBe('déconnecté');
  });
});
