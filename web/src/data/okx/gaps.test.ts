/// <reference types="node" />
// Continuité des identifiants de trades : tout trou est signalé, jamais masqué.
// Mêmes cas que collectors/tests/test_gaps.py.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TradeSequence } from './gaps';
import { parse, type OkxEvent, type TradeEvent } from './parse';

// Racine du dépôt (le global URL de jsdom ne convient pas à fileURLToPath).
const ROOT = `${resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')}/`;

const trade = (tid: number, count = 1, inst = 'BTC-USDT-SWAP') => ({ inst, trade_id: tid, count, ts_source: 0 });

describe('continuité des trades', () => {
  it('le flux enregistré ne contient aucun trou', () => {
    const recorded = JSON.parse(readFileSync(`${ROOT}collectors/tests/fixtures/ws_messages.json`, 'utf-8'));
    const items = recorded['trades:push'] as { recv_ms: number; msg: unknown }[];
    const trades = items.flatMap((it) => parse(JSON.stringify(it.msg), it.recv_ms) as OkxEvent[]) as TradeEvent[];
    expect(trades.length).toBeGreaterThanOrEqual(20);
    const seq = new TradeSequence();
    expect(trades.map((t) => seq.check(t)).filter(Boolean)).toEqual([]);
  });

  it('un message agrégé est continu', () => {
    const seq = new TradeSequence();
    expect(seq.check(trade(100))).toBeNull();
    expect(seq.check(trade(103, 3))).toBeNull(); // agrège 101, 102, 103
  });

  it('les trades manquants sont comptés', () => {
    const seq = new TradeSequence();
    seq.check(trade(100));
    const gap = seq.check(trade(110));
    expect(gap?.missing).toBe(9);
    expect(gap?.describe()).toBe('BTC-USDT-SWAP : 9 trade(s) manquant(s) entre 100 et 110');
  });

  it('un trou à travers une reconnexion est signalé', () => {
    // La séquence n'est pas remise à zéro à la reconnexion : les trades perdus
    // pendant la coupure apparaissent dans le journal des trous.
    const seq = new TradeSequence();
    seq.check(trade(500));
    expect(seq.check(trade(742))?.missing).toBe(241);
  });

  it('un doublon est signalé et ne fait pas reculer la séquence', () => {
    const seq = new TradeSequence();
    seq.check(trade(100));
    const gap = seq.check(trade(100));
    expect(gap).not.toBeNull();
    expect(gap!.missing).toBeLessThanOrEqual(0);
    expect(gap!.describe()).toBe('BTC-USDT-SWAP : trade 100 reçu après 100 (doublon ou désordre)');
    expect(seq.check(trade(101))).toBeNull();
  });

  it('les instruments sont indépendants', () => {
    const seq = new TradeSequence();
    seq.check(trade(10, 1, 'A'));
    seq.check(trade(900, 1, 'B'));
    expect(seq.check(trade(11, 1, 'A'))).toBeNull();
  });

  it('reset oublie un instrument, ou tous', () => {
    const seq = new TradeSequence();
    seq.check(trade(10, 1, 'A'));
    seq.check(trade(10, 1, 'B'));
    seq.reset('A');
    expect(seq.check(trade(50, 1, 'A'))).toBeNull();
    expect(seq.check(trade(50, 1, 'B'))?.missing).toBe(39);
    seq.reset();
    expect(seq.check(trade(99, 1, 'B'))).toBeNull();
  });
});
