// Coinbase Exchange pour la CVD spot (P5, T-065) : `wss://ws-feed.exchange.coinbase.com`, canaux
// publics `matches` et `heartbeat` (sans clé). Dans un `match`, `side` est le côté du teneur de
// marché : `sell` = achat agressif. Continuité : trade_id + 1. Heartbeat chaque seconde.

import { VenueStream, type MessageResult } from '../stream';
import { num, type VenueAdapter, type VenueCtx } from './ctx';

export const COINBASE_WS = 'wss://ws-feed.exchange.coinbase.com';

export function createCoinbase(ctx: VenueCtx): VenueAdapter {
  let lastId: number | null = null;
  let stream: VenueStream;

  function onMessage(raw: string, recv: number): MessageResult {
    const m = JSON.parse(raw) as Record<string, unknown>;
    if (m.type === 'subscriptions') return 'ack';
    if (m.type === 'error') return { error: `Coinbase : ${String(m.message)} ${String(m.reason ?? '')}`.slice(0, 200) };
    if (m.type === 'heartbeat') return 'data';
    if (m.type !== 'match' && m.type !== 'last_match') return 'ignore';
    const id = num(m.trade_id);
    if (m.type === 'match' && lastId !== null && id > lastId + 1) stream.gap(`${id - lastId - 1} trade(s) manquant(s)`);
    lastId = Math.max(id, lastId ?? id);
    if (m.type === 'last_match') return 'data';                // dernier trade avant l'abonnement : repère seulement
    ctx.emit({ kind: 'trade', t: { venue: 'coinbase', market: 'spot', ts: Date.parse(String(m.time)), recv, px: num(m.price), sz: num(m.size),
      side: m.side === 'sell' ? 'buy' : 'sell' } });
    return 'data';
  }

  stream = new VenueStream({
    name: 'coinbase', label: 'Coinbase WS', venue: 'coinbase', url: COINBASE_WS, quietMs: 15_000,
    subscribe: () => [JSON.stringify({ type: 'subscribe', product_ids: ['BTC-USD'], channels: ['matches', 'heartbeat'] })],
    onOpen: () => { lastId = null; },
    onMessage,
  }, ctx.deps, ctx.onFeed);
  return { streams: [stream], books: [] };
}
