/// <reference types="node" />
// Parité du parseur TypeScript avec le parseur Python de la passerelle, sur
// le fichier doré (collectors/tests/fixtures/parsed_golden.json) : pour chaque
// message, mêmes événements, mêmes clés dans le même ordre, mêmes valeurs.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Control, candleFromRow, parse, type OkxEvent } from './parse';

// Racine du dépôt (le global URL de jsdom ne convient pas à fileURLToPath).
const ROOT = `${resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')}/`;
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(`${ROOT}${rel}`, 'utf-8')) as T;

interface GoldenCase {
  name: string; recv_ms: number; raw: string;
  events?: OkxEvent[]; control?: { event: string; raw: Record<string, unknown> };
}
type Recorded = Record<string, { recv_ms: number; msg: unknown }[]>;

const golden = readJson<{ cases: GoldenCase[] }>('collectors/tests/fixtures/parsed_golden.json');
const recorded = readJson<Recorded>('collectors/tests/fixtures/ws_messages.json');

function asGolden(out: OkxEvent[] | Control): Pick<GoldenCase, 'events' | 'control'> {
  return out instanceof Control ? { control: { event: out.event, raw: out.raw } } : { events: out };
}

describe('parité avec parse.py (fichier doré)', () => {
  it('couvre chaque message enregistré', () => {
    const names = new Set(golden.cases.map((c) => c.name));
    for (const [group, items] of Object.entries(recorded)) {
      items.forEach((_, i) => expect(names.has(`${group}#${i}`), `${group}#${i}`).toBe(true));
    }
  });

  it.each(golden.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const got = asGolden(parse(c.raw, c.recv_ms));
    const expected = { events: c.events, control: c.control };
    // Égalité stricte (null n'est pas undefined) puis texte JSON identique,
    // ce qui vérifie aussi l'ordre des clés.
    expect(got).toStrictEqual(Object.fromEntries(Object.entries(expected).filter(([, v]) => v !== undefined)));
    expect(JSON.stringify(got)).toBe(JSON.stringify(c.events ? { events: c.events } : { control: c.control }));
  });

  it('les messages enregistrés, resérialisés en JavaScript, donnent le même résultat', () => {
    // Le navigateur reçoit le texte d'OKX, pas celui de Python : l'espacement du
    // JSON ne doit rien changer.
    const byName = new Map(golden.cases.map((c) => [c.name, c]));
    for (const [group, items] of Object.entries(recorded)) {
      items.forEach((it, i) => {
        const c = byName.get(`${group}#${i}`)!;
        expect(JSON.stringify(asGolden(parse(JSON.stringify(it.msg), it.recv_ms))))
          .toBe(JSON.stringify(c.events ? { events: c.events } : { control: c.control }));
      });
    }
  });
});

describe('analyse des messages OKX', () => {
  const first = (key: string) => {
    const it = recorded[key][0];
    return parse(JSON.stringify(it.msg), it.recv_ms) as OkxEvent[];
  };

  it('trade : champs et unités', () => {
    const [t] = first('trades:push');
    expect(t).toMatchObject({ kind: 'trade', inst: 'BTC-USDT-SWAP' });
    if (t.kind !== 'trade') throw new Error('trade attendu');
    expect(Number.isInteger(t.trade_id) && t.count >= 1).toBe(true);
    expect(['buy', 'sell']).toContain(t.side);
    expect(t.px).toBeGreaterThan(1000);
  });

  it('funding : période de 8 h sur BTC', () => {
    const [f] = first('funding-rate:push');
    if (f.kind !== 'funding') throw new Error('funding attendu');
    expect(f.interval_ms).toBe(8 * 3_600_000);
    expect(f.funding_time!).toBeGreaterThan(f.ts_source);
  });

  it('bougies REST et WebSocket : même tableau', () => {
    const rows = readJson<{ data: unknown[][] }>('collectors/tests/fixtures/rest_candles_1m.json').data;
    const c = candleFromRow('BTC-USDT-SWAP', '1m', rows[1]);
    expect(c.confirmed).toBe(true);
    expect(c.t % 60_000).toBe(0);
    expect(c.ts_recv).toBeNull();
  });

  it('contrôles', () => {
    expect(parse('pong', 0)).toBeInstanceOf(Control);
    const ctl = parse('{"event":"error","code":"60012","msg":"x"}', 0);
    expect(ctl).toBeInstanceOf(Control);
    expect((ctl as Control).event).toBe('error');
  });

  it('un champ obligatoire illisible lève une erreur, comme en Python', () => {
    const msg = (d: object) => JSON.stringify({ arg: { channel: 'trades', instId: 'X' }, data: [d] });
    expect(() => parse(msg({ instId: 'X', tradeId: '1', px: '', sz: '1', side: 'buy', ts: '1' }), 0)).toThrow(/px/);
    expect(() => parse(msg({ instId: 'X', tradeId: '1.5', px: '1', sz: '1', side: 'buy', ts: '1' }), 0)).toThrow(/tradeId/);
    expect(() => parse(msg({ tradeId: '1', px: '1', sz: '1', side: 'buy', ts: '1' }), 0)).toThrow(/instId/);
  });
});
