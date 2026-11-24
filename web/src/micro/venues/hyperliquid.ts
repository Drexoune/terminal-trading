// Hyperliquid pour la microstructure (P5, T-065, T-067) : `wss://api.hyperliquid.xyz/ws`.
// - `l2Book` BTC : chaque message est un carnet complet (20 niveaux par côté), regroupé par
//   `nSigFigs`. Le pas dépend du prix (4 chiffres : 10 $ sous 100 000 $, 100 $ au-dessus) :
//   abonnements 3, 4 et 5, chaque carnet rangé selon son pas réel — 10 $ (±0,33 % à 60 000 $)
//   pour le carnet agrégé, 100 $ (±3 %) pour la carte de profondeur, les autres ignorés.
// - `trades` : side B = achat du preneur, A = vente.
// - `activeAssetCtx` : funding **horaire**, OI en BTC, marque, oracle (prime).
// Aucun flux public de liquidations (relevé S0) : « — » à l'écran.
// Ping `{"method":"ping"}` après 30 s de silence (Hyperliquid coupe à 60 s).

import { LocalBook } from '../book';
import { VenueStream, type MessageResult } from '../stream';
import { num, type VenueAdapter, type VenueCtx } from './ctx';

export const HL_WS = 'wss://api.hyperliquid.xyz/ws';

const subs = [3, 4, 5].map((n) => ({ type: 'l2Book', coin: 'BTC', nSigFigs: n }) as Record<string, unknown>)
  .concat([{ type: 'trades', coin: 'BTC' }, { type: 'activeAssetCtx', coin: 'BTC' }]);

/** Prochaine échéance de funding : l'heure pleine suivante (UTC). */
export const nextHour = (ms: number) => Math.floor(ms / 3_600_000) * 3_600_000 + 3_600_000;

export function createHyperliquid(ctx: VenueCtx): VenueAdapter {
  const fine = new LocalBook('hyperliquid');
  const deep = new LocalBook('hyperliquid');
  const lvl = (rows: { px: string; sz: string }[]) => rows.map((r): [number, number] => [num(r.px), num(r.sz)]);
  /** Pas de prix d'un carnet : plus petit écart entre deux niveaux voisins. */
  const step = (rows: { px: string }[]) => {
    let s = Infinity;
    for (let i = 1; i < rows.length; i++) s = Math.min(s, Math.abs(num(rows[i].px) - num(rows[i - 1].px)));
    return s;
  };

  function onMessage(raw: string, recv: number): MessageResult {
    const m = JSON.parse(raw) as { channel?: string; data?: unknown };
    if (m.channel === 'subscriptionResponse') return 'ack';
    if (m.channel === 'pong') return 'ignore';
    if (m.channel === 'error') return { error: `Hyperliquid : ${String(m.data).slice(0, 150)}` };
    if (m.channel === 'l2Book') {
      const d = m.data as { time: number; levels: [{ px: string; sz: string }[], { px: string; sz: string }[]] };
      // Les trois abonnements arrivent sur le même canal : le pas de prix les distingue.
      const st = Math.min(step(d.levels[0]), step(d.levels[1]));
      const target = st >= 5 && st <= 20 ? fine : st >= 50 && st <= 200 ? deep : null;
      target?.snapshot(lvl(d.levels[0]), lvl(d.levels[1]), num(d.time), recv);
    } else if (m.channel === 'trades') {
      for (const t of m.data as Record<string, unknown>[]) {
        ctx.emit({ kind: 'trade', t: { venue: 'hyperliquid', market: 'perp', ts: num(t.time), recv, px: num(t.px), sz: num(t.sz), side: t.side === 'A' ? 'sell' : 'buy' } });
      }
    } else if (m.channel === 'activeAssetCtx') {
      const c = (m.data as { ctx: Record<string, string> }).ctx;
      ctx.emit({ kind: 'funding', f: { venue: 'hyperliquid', ts: recv, rate: num(c.funding), interval_h: 1, next_ms: nextHour(recv) } });
      const oi = num(c.openInterest), mark = num(c.markPx);
      ctx.emit({ kind: 'oi', o: { venue: 'hyperliquid', ts: recv, oi_btc: oi, oi_usd: oi * mark } });
      ctx.emit({ kind: 'premium', p: { venue: 'hyperliquid', ts: recv, mark, index: num(c.oraclePx) } });
    } else return 'ignore';
    return 'data';
  }

  const stream = new VenueStream({
    name: 'hyperliquid', label: 'Hyperliquid WS', venue: 'hyperliquid', url: HL_WS, ping: JSON.stringify({ method: 'ping' }), quietMs: 30_000,
    subscribe: () => subs.map((s) => JSON.stringify({ method: 'subscribe', subscription: s })),
    onOpen: () => { fine.reset(); deep.reset(); },
    onMessage,
  }, ctx.deps, ctx.onFeed);
  return { streams: [stream], books: [fine, deep] };
}
