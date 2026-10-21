/** @vitest-environment node */
// Client REST OKX des fonctions Vercel : pagination, espacement, 429, codes
// d'erreur, conversions strictes. Mêmes règles que collectors/…/okx/rest.py.

import { describe, expect, it } from 'vitest';
import {
  candleFromRow, CANDLES_PER_REQUEST, MIN_SPACING_MS, OKX_EEA_REST, OkxError, OkxRest, RETRY_429_MS,
} from '../_lib/okx.ts';
import { DAY_MS, utcDayStart } from '../_lib/chart.ts';
import { FakeClock, fakeOkx, okxReply, readJson, type Recorded } from './fakes.ts';

const BTC = 'BTC-USDT-SWAP';
const TODAY = Date.UTC(2026, 9, 20);

function client(nowMs: number, override?: (r: Recorded) => Response | undefined) {
  const clock = new FakeClock(nowMs);
  const okx = fakeOkx({ nowMs, listingMs: 0, override });
  return { rest: new OkxRest(clock.deps(okx.fetch)), clock, calls: okx.calls };
}

describe('bougies : pagination OKX (300 par requête, 1 440 au plus)', () => {
  it('journée complète en 1 min : 4 pages de 300 puis 240, de la plus ancienne à la plus récente', async () => {
    const now = TODAY + DAY_MS - 30_000; // 23:59:30 UTC
    const { rest, calls } = client(now);
    const candles = await rest.candles(BTC, '1m', TODAY);
    expect(candles).toHaveLength(1440);
    expect(candles[0].t).toBe(TODAY);
    expect(candles[1439].t).toBe(TODAY + DAY_MS - 60_000);
    expect(candles.every((c, i) => i === 0 || c.t - candles[i - 1].t === 60_000)).toBe(true);
    expect(calls.map((c) => c.params.limit)).toEqual(['300', '300', '300', '300', '240']);
    // `after` = plus ancienne bougie de la page précédente.
    expect(calls.map((c) => c.params.after)).toEqual([
      undefined,
      String(now - (now % 60_000) - 299 * 60_000),
      String(now - (now % 60_000) - 599 * 60_000),
      String(now - (now % 60_000) - 899 * 60_000),
      String(now - (now % 60_000) - 1199 * 60_000),
    ]);
    expect(calls.every((c) => c.url.startsWith(`${OKX_EEA_REST}/api/v5/market/candles?`))).toBe(true);
  });

  it('s’arrête dès que la page atteint `since`, et filtre ce qui la précède', async () => {
    const now = TODAY + 10 * 60_000 + 5_000; // 00:10:05 : 11 bougies du jour
    const { rest, calls } = client(now);
    const candles = await rest.candles(BTC, '1m', TODAY);
    expect(candles.map((c) => (c.t - TODAY) / 60_000)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual({ instId: BTC, bar: '1m', limit: String(CANDLES_PER_REQUEST) });
  });

  it('une page vide termine la lecture (début de l’historique)', async () => {
    const now = TODAY + 5 * 60_000;
    const clock = new FakeClock(now);
    const okx = fakeOkx({ nowMs: now, listingMs: TODAY + 2 * 60_000 }); // 3 bougies existent
    const candles = await new OkxRest(clock.deps(okx.fetch)).candles(BTC, '1m', TODAY - DAY_MS);
    expect(candles.map((c) => c.t)).toEqual([TODAY + 2 * 60_000, TODAY + 3 * 60_000, TODAY + 4 * 60_000, TODAY + 5 * 60_000]);
    expect(okx.calls).toHaveLength(2);
    expect(okx.calls[1].params.after).toBe(String(TODAY + 2 * 60_000));
  });

  it('bougie en cours : confirmed false ; colonnes vol_base = volCcy, vol_quote = volCcyQuote', () => {
    const row = readJson<{ data: string[][] }>('collectors/tests/fixtures/rest_candles_1m.json').data[0];
    expect(candleFromRow(row)).toEqual({
      t: 1792487280000, o: 81391.7, h: 81402.9, l: 81391.6, c: 81402.9,
      vol_base: 31.84, vol_quote: 2591524.63992, confirmed: false,
    });
  });

  it('un champ illisible est une erreur, jamais une valeur supposée', () => {
    expect(() => candleFromRow(['1', '2'])).toThrow(OkxError);
    expect(() => candleFromRow(['1792487280000', '', '1', '1', '1', '1', '1', '1', '1'])).toThrow(OkxError);
    expect(() => candleFromRow(['1792487280000.5', '1', '1', '1', '1', '1', '1', '1', '1'])).toThrow(/réponse illisible/);
  });
});

describe('espacement, 429 et codes d’erreur', () => {
  it('deux appels successifs sont espacés de 50 ms', async () => {
    const { rest, clock } = client(TODAY + 60_000);
    await rest.time();
    await rest.time();
    expect(MIN_SPACING_MS).toBe(50);
    expect(clock.sleeps).toEqual([50]);
  });

  it('des appels simultanés passent un par un', async () => {
    const { rest, clock } = client(TODAY + 60_000);
    await Promise.all([rest.time(), rest.time(), rest.time()]);
    expect(clock.sleeps).toEqual([50, 50]);
  });

  it('un 429 est réessayé une fois après 1 s', async () => {
    let n = 0;
    const { rest, clock, calls } = client(TODAY + 60_000, () => (n++ === 0 ? new Response('', { status: 429 }) : undefined));
    const t = await rest.time();
    expect(t.okx_ts).toBe(TODAY + 60_000);
    expect(calls).toHaveLength(2);
    expect(clock.sleeps[0]).toBe(RETRY_429_MS);
  });

  it('deux 429 de suite : erreur « limite de débit atteinte »', async () => {
    const { rest, calls } = client(TODAY, () => new Response('', { status: 429 }));
    await expect(rest.time()).rejects.toThrow('limite de débit atteinte');
    expect(calls).toHaveLength(2);
  });

  it('code OKX ≠ "0" en HTTP 200 : erreur, seul le code est retenu pour la réponse', async () => {
    const { rest } = client(TODAY, () => okxReply([], '51001', 'Instrument ID does not exist'));
    const err = await rest.instrument(BTC).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OkxError);
    expect((err as OkxError).message).toBe('code 51001');
    expect((err as OkxError).detail).toContain('Instrument ID does not exist'); // journal seulement
  });

  it('HTTP 5xx, corps non JSON, réseau coupé', async () => {
    await expect(client(TODAY, () => new Response('oops', { status: 503 })).rest.time()).rejects.toThrow('HTTP 503');
    await expect(client(TODAY, () => new Response('<html>', { status: 200 })).rest.time()).rejects.toThrow('réponse illisible');
    const down = client(TODAY, () => { throw new TypeError('fetch failed'); });
    await expect(down.rest.time()).rejects.toThrow('injoignable ou délai dépassé');
  });
});

describe('instruments et heure', () => {
  it('paramètres de contrat lus sur la réponse réelle enregistrée (comme OkxRest.instrument)', async () => {
    const { rest, calls } = client(TODAY);
    expect(await rest.instrument(BTC)).toEqual({
      inst: BTC, ct_val: 0.01, ct_val_ccy: 'BTC', ct_type: 'linear', lot_sz: 0.01, min_sz: 0.01,
      tick_sz: 0.1, settle_ccy: 'USDT', state: 'live',
    });
    expect(calls[0].path).toBe('/api/v5/public/instruments');
    expect(calls[0].params).toEqual({ instType: 'SWAP', instId: BTC });
  });

  it('instrument absent ou différent de celui demandé : erreur', async () => {
    await expect(client(TODAY).rest.instrument('ETH-USDT-SWAP')).rejects.toThrow('instrument introuvable');
    const other = client(TODAY, (r) => (r.path.endsWith('instruments')
      ? okxReply([{ ...readJson<{ data: object[] }>('collectors/tests/fixtures/rest_instruments.json').data[0] }]) : undefined));
    await expect(other.rest.instrument('ETH-USDT-SWAP')).rejects.toThrow('réponse illisible');
  });

  it('heure : okx_ts, heure de la fonction au milieu de l’aller-retour, aller-retour', async () => {
    const clock = new FakeClock(TODAY + 1_000);
    const rest = new OkxRest(clock.deps(async () => {
      clock.advance(40); // 40 ms d'aller-retour
      return okxReply([{ ts: String(TODAY + 1_100) }]);
    }));
    expect(await rest.time()).toEqual({ okx_ts: TODAY + 1_100, fn_ts: TODAY + 1_020, rtt_ms: 40 });
  });

  it('journée UTC', () => {
    expect(utcDayStart(TODAY + 5 * 3_600_000 + 123)).toBe(TODAY);
    expect(utcDayStart(TODAY)).toBe(TODAY);
    expect(utcDayStart(TODAY - 1)).toBe(TODAY - DAY_MS);
  });
});
