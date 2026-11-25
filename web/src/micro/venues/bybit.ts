// Bybit linéaire pour la microstructure (P5, T-065, T-067) : `wss://stream.bybit.com/v5/public/linear`.
// - `orderbook.1000.BTCUSDT` : instantané puis deltas ; `u` augmente de 1 à chaque message (un
//   instantané le remet à zéro). Rupture : désabonnement puis réabonnement, trou journalisé.
// - `publicTrade.BTCUSDT` : S = côté du preneur.
// - `tickers.BTCUSDT` : instantané puis deltas partiels (funding, prochaine échéance, OI en BTC,
//   marque, indice), fusionnés.
// - `allLiquidation.BTCUSDT` : toutes les liquidations selon Bybit (envoi toutes les 500 ms) ;
//   S = Buy : position longue liquidée.
// Ping `{"op":"ping"}` toutes les 20 s (doc Bybit).

import { LocalBook, levels } from '../book';
import { VenueStream, type MessageResult } from '../stream';
import { num, type VenueAdapter, type VenueCtx } from './ctx';

export const BYBIT_WS = 'wss://stream.bybit.com/v5/public/linear';
const BOOK = 'orderbook.1000.BTCUSDT';
const TOPICS = [BOOK, 'publicTrade.BTCUSDT', 'tickers.BTCUSDT', 'allLiquidation.BTCUSDT'];

export function createBybit(ctx: VenueCtx): VenueAdapter {
  const book = new LocalBook('bybit', 1, { maxLevels: 1000 });
  let lastU: number | null = null;
  const ticker: Record<string, string> = {};
  let stream: VenueStream;

  const resync = (why: string) => {
    book.reset(); lastU = null;
    stream.gap(`carnet resynchronisé : ${why}`);
    stream.send(JSON.stringify({ op: 'unsubscribe', args: [BOOK] }));
    stream.send(JSON.stringify({ op: 'subscribe', args: [BOOK] }));
  };

  function onMessage(raw: string, recv: number): MessageResult {
    const m = JSON.parse(raw) as { op?: string; success?: boolean; ret_msg?: string; topic?: string; type?: string; ts?: number; data?: unknown };
    if (m.op === 'subscribe' || m.op === 'unsubscribe') return m.success ? 'ack' : { error: `Bybit a refusé l’abonnement : ${m.ret_msg}` };
    if (m.op === 'pong' || m.op === 'ping') return 'ignore';
    if (!m.topic) return 'ignore';
    if (m.topic === BOOK) {
      const d = m.data as { u: number; b: string[][]; a: string[][] };
      const ts = num(m.ts);
      if (m.type === 'snapshot') { book.snapshot(levels(d.b), levels(d.a), ts, recv); lastU = d.u; return 'data'; }
      if (lastU === null) return 'data';
      if (d.u !== lastU + 1) { resync(`u attendu ${lastU + 1}, reçu ${d.u}`); return 'data'; }
      book.apply(levels(d.b), levels(d.a), ts, recv);
      lastU = d.u;
      if (book.crossed()) resync('carnet croisé');
    } else if (m.topic.startsWith('publicTrade.')) {
      for (const t of m.data as Record<string, unknown>[]) {
        ctx.emit({ kind: 'trade', t: { venue: 'bybit', market: 'perp', ts: num(t.T), recv, px: num(t.p), sz: num(t.v), side: t.S === 'Sell' ? 'sell' : 'buy' } });
      }
    } else if (m.topic.startsWith('tickers.')) {
      const d = m.data as Record<string, string>;
      if (m.type === 'snapshot') for (const k of Object.keys(ticker)) delete ticker[k];
      for (const [k, v] of Object.entries(d)) if (v !== '' && v != null) ticker[k] = v;
      const ts = num(m.ts);
      if (ticker.fundingRate) {
        ctx.emit({ kind: 'funding', f: { venue: 'bybit', ts, rate: num(ticker.fundingRate),
          interval_h: ticker.fundingIntervalHour ? num(ticker.fundingIntervalHour) : 8, next_ms: ticker.nextFundingTime ? num(ticker.nextFundingTime) : null } });
      }
      if (ticker.openInterest) {
        ctx.emit({ kind: 'oi', o: { venue: 'bybit', ts, oi_btc: num(ticker.openInterest), oi_usd: ticker.openInterestValue ? num(ticker.openInterestValue) : null } });
      }
      if (ticker.markPrice && ticker.indexPrice) ctx.emit({ kind: 'premium', p: { venue: 'bybit', ts, mark: num(ticker.markPrice), index: num(ticker.indexPrice) } });
    } else if (m.topic.startsWith('allLiquidation.')) {
      for (const l of m.data as Record<string, unknown>[]) {
        const sz = num(l.v), px = num(l.p);
        ctx.emit({ kind: 'liq', l: { venue: 'bybit', ts: num(l.T), recv, side: l.S === 'Buy' ? 'long' : 'short', px, sz, usd: sz * px, floor: false } });
      }
    }
    return 'data';
  }

  stream = new VenueStream({
    name: 'bybit', label: 'Bybit WS', venue: 'bybit', url: BYBIT_WS, ping: JSON.stringify({ op: 'ping' }), quietMs: 20_000,
    subscribe: () => [JSON.stringify({ op: 'subscribe', args: TOPICS })],
    onOpen: () => { book.reset(); lastU = null; },
    onMessage,
  }, ctx.deps, ctx.onFeed);
  return { streams: [stream], books: [book] };
}
