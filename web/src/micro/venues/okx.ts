// OKX pour la microstructure (P5, T-065, T-067) : WebSocket publique EEA (`wss://wseea.okx.com`),
// une connexion distincte de celle du flux principal (data/sources/okxSource.ts).
//
// - `books` BTC-USDT-SWAP : 400 niveaux, instantané puis mises à jour ; continuité par
//   seqId / prevSeqId (la somme de contrôle vaut 0 depuis 2026 : plus fournie). Rupture :
//   désabonnement puis réabonnement du seul carnet, trou journalisé.
// - `trades` swap (tailles en contrats : × ctVal 0,01 BTC) et spot ; continuité tradeId − count.
// - `liquidation-orders` (tous les swaps, filtré sur BTC-USDT-SWAP) : plancher (doc d'OKX : ne
//   représente pas toutes les liquidations).
// - `funding-rate`, `open-interest`, `mark-price` et `index-tickers` (prime perp / spot).
// Ping texte « ping » après 20 s de silence (règle d'OKX : coupure à 30 s).

import { LocalBook, levels } from '../book';
import { VenueStream, type MessageResult } from '../stream';
import { num, type VenueAdapter, type VenueCtx } from './ctx';

export const OKX_WS = 'wss://wseea.okx.com/ws/v5/public';
export const SWAP = 'BTC-USDT-SWAP';
export const CT_VAL = 0.01;                      // BTC par contrat (instruments, relevé du 24/11/2026)

const ARGS = [
  { channel: 'books', instId: SWAP }, { channel: 'trades', instId: SWAP }, { channel: 'trades', instId: 'BTC-USDT' },
  { channel: 'liquidation-orders', instType: 'SWAP' }, { channel: 'funding-rate', instId: SWAP },
  { channel: 'open-interest', instId: SWAP }, { channel: 'mark-price', instId: SWAP }, { channel: 'index-tickers', instId: 'BTC-USDT' },
];

interface OkxMsg { event?: string; code?: string; msg?: string; arg?: { channel: string; instId?: string }; action?: string; data?: Record<string, unknown>[] }

export function createOkx(ctx: VenueCtx): VenueAdapter {
  const book = new LocalBook('okx', CT_VAL);
  let seq: number | null = null;
  const lastTid = new Map<string, number>();
  let mark: number | null = null, index: number | null = null, markTs = 0;
  let stream: VenueStream;

  const resync = (why: string) => {
    book.reset(); seq = null;
    stream.gap(`carnet resynchronisé : ${why}`);
    stream.send(JSON.stringify({ op: 'unsubscribe', args: [ARGS[0]] }));
    stream.send(JSON.stringify({ op: 'subscribe', args: [ARGS[0]] }));
  };

  function onMessage(raw: string, recv: number): MessageResult {
    if (raw === 'pong') return 'ignore';
    const m = JSON.parse(raw) as OkxMsg;
    if (m.event === 'subscribe' || m.event === 'unsubscribe') return 'ack';
    if (m.event === 'error') return { error: `OKX a refusé la requête : ${m.code} ${m.msg}` };
    if (m.event) return 'ignore';
    const ch = m.arg?.channel;
    for (const d of m.data ?? []) {
      if (ch === 'books') {
        const s = num(d.seqId), prev = num(d.prevSeqId), ts = num(d.ts);
        if (m.action === 'snapshot') { book.snapshot(levels(d.bids as string[][]), levels(d.asks as string[][]), ts, recv); seq = s; continue; }
        if (seq === null) continue;                                 // mise à jour avant l'instantané : ignorée
        if (prev !== seq) { resync(`seqId attendu ${seq}, reçu prevSeqId ${prev}`); return 'data'; }
        book.apply(levels(d.bids as string[][]), levels(d.asks as string[][]), ts, recv);
        seq = s;
        if (book.crossed()) { resync('carnet croisé'); return 'data'; }
      } else if (ch === 'trades') {
        const inst = String(d.instId), tid = num(d.tradeId), count = num(d.count ?? 1);
        const prev = lastTid.get(inst);
        if (prev !== undefined && tid - count !== prev && tid > prev) stream.gap(`${inst} : ${tid - count - prev} trade(s) manquant(s)`);
        lastTid.set(inst, Math.max(tid, prev ?? tid));
        const perp = inst === SWAP;
        ctx.emit({ kind: 'trade', t: { venue: 'okx', market: perp ? 'perp' : 'spot', ts: num(d.ts), recv, px: num(d.px), sz: num(d.sz) * (perp ? CT_VAL : 1),
          side: d.side === 'sell' ? 'sell' : 'buy' } });
      } else if (ch === 'liquidation-orders') {
        if (d.instId !== SWAP) continue;
        for (const x of (d.details as Record<string, unknown>[]) ?? []) {
          const sz = num(x.sz) * CT_VAL, px = num(x.bkPx);
          const long = x.posSide === 'long' || (x.posSide === 'net' && x.side === 'sell');
          ctx.emit({ kind: 'liq', l: { venue: 'okx', ts: num(x.ts), recv, side: long ? 'long' : 'short', px, sz, usd: sz * px, floor: true } });
        }
      } else if (ch === 'funding-rate') {
        const next = d.fundingTime != null ? num(d.fundingTime) : null;
        const prevT = d.prevFundingTime != null && d.prevFundingTime !== '' ? num(d.prevFundingTime) : null;
        const h = next !== null && prevT !== null && next > prevT ? Math.round((next - prevT) / 3_600_000) : 8;
        ctx.emit({ kind: 'funding', f: { venue: 'okx', ts: num(d.ts), rate: num(d.fundingRate), interval_h: h, next_ms: next } });
      } else if (ch === 'open-interest') {
        ctx.emit({ kind: 'oi', o: { venue: 'okx', ts: num(d.ts), oi_btc: num(d.oiCcy), oi_usd: d.oiUsd != null ? num(d.oiUsd) : null } });
      } else if (ch === 'mark-price' || ch === 'index-tickers') {
        if (ch === 'mark-price') { mark = num(d.markPx); markTs = num(d.ts); } else index = num(d.idxPx);
        if (mark !== null && index !== null) ctx.emit({ kind: 'premium', p: { venue: 'okx', ts: markTs, mark, index } });
      }
    }
    return 'data';
  }

  stream = new VenueStream({
    name: 'okx-micro', label: 'OKX WS', venue: 'okx', url: OKX_WS, ping: 'ping', quietMs: 20_000,
    subscribe: () => [JSON.stringify({ op: 'subscribe', args: ARGS })],
    onOpen: () => { book.reset(); seq = null; lastTid.clear(); },
    onMessage,
  }, ctx.deps, ctx.onFeed);
  return { streams: [stream], books: [book] };
}
