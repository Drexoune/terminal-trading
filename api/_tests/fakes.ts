/// <reference types="node" />
// Faux OKX, fausses horloges et contexte de test des fonctions Vercel.
//
// fakeRows est le portage exact de fake_rows dans make_chart_golden.py : mêmes
// bougies pour les mêmes paramètres, d'où la comparaison directe avec la sortie
// de la passerelle (fixtures/chart_golden.json).

import { readFileSync } from 'node:fs';
import type { FetchFn, OkxDeps } from '../_lib/okx.ts';
import { createContext, type Context } from '../_lib/routes.ts';
import type { Env } from '../_lib/http.ts';

export const ROOT = new URL('../../', import.meta.url);

export function readJson<T = unknown>(relative: string): T {
  return JSON.parse(readFileSync(new URL(relative, ROOT), 'utf-8')) as T;
}

export const BAR_MS: Record<string, number> = { '1m': 60_000, '5m': 300_000, '1H': 3_600_000, '1Dutc': 86_400_000 };

const tenths = (n: number) => `${Math.floor(n / 10)}.${n % 10}`;

export function fakeRow(t: number, barMs: number, nowMs: number): string[] {
  const k = Math.floor(t / 60_000);
  const o = 800_000 + (k % 997);
  const c = o + (k % 7) - 3;
  const h = Math.max(o, c) + (k % 5);
  const lo = Math.min(o, c) - (k % 3);
  const vol = 100 + (k % 50);
  return [String(t), tenths(o), tenths(h), tenths(lo), tenths(c), String(vol),
    `${Math.floor(vol / 100)}.${String(vol % 100).padStart(2, '0')}`, String(vol * 8000),
    t + barMs > nowMs ? '0' : '1'];
}

export function fakeRows(params: Record<string, string>, nowMs: number, listingMs: number): string[][] {
  const b = BAR_MS[params.bar];
  const limit = Number(params.limit);
  let t = nowMs - (nowMs % b);
  if (params.after !== undefined) t = Math.min(t, Math.floor((Number(params.after) - 1) / b) * b);
  const rows: string[][] = [];
  while (rows.length < limit && t + b > listingMs) {
    rows.push(fakeRow(t, b, nowMs));
    t -= b;
  }
  return rows;
}

export interface Recorded { path: string; params: Record<string, string>; init?: RequestInit; url: string }

export function okxReply(data: unknown, code = '0', msg = ''): Response {
  return new Response(JSON.stringify({ code, msg, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** Horloges simulées : `sleep` avance l'horloge monotone (comme l'attente réelle), pas l'heure murale. */
export class FakeClock {
  mono = 0;
  sleeps: number[] = [];
  constructor(public wall: number) {}
  advance(ms: number): void {
    this.mono += ms;
    this.wall += ms;
  }
  deps(fetch: FetchFn): OkxDeps {
    return {
      fetch,
      now: () => this.wall,
      monotonic: () => this.mono,
      sleep: async (ms) => {
        this.sleeps.push(ms);
        this.mono += ms;
      },
    };
  }
}

export interface FakeOkxOptions {
  nowMs: number;
  listingMs: number;
  /** Réponse imposée pour une requête (sinon le faux marché). */
  override?: (r: Recorded) => Response | Promise<Response> | undefined;
}

/** Faux OKX REST : bougies déterministes, instruments réels enregistrés, heure du serveur. */
export function fakeOkx(opts: FakeOkxOptions) {
  const calls: Recorded[] = [];
  const instruments = readJson<{ data: Record<string, unknown>[] }>('collectors/tests/fixtures/rest_instruments.json');
  const fetch: FetchFn = async (url, init) => {
    const u = new URL(url);
    const rec: Recorded = { path: u.pathname, params: Object.fromEntries(u.searchParams), init, url };
    calls.push(rec);
    const forced = await opts.override?.(rec);
    if (forced) return forced;
    if (u.origin !== 'https://eea.okx.com') return new Response('mauvais domaine', { status: 421 });
    if (u.pathname === '/api/v5/market/candles') return okxReply(fakeRows(rec.params, opts.nowMs, opts.listingMs));
    if (u.pathname === '/api/v5/public/instruments') {
      return okxReply(instruments.data.filter((d) => d.instId === rec.params.instId));
    }
    if (u.pathname === '/api/v5/public/time') return okxReply([{ ts: String(opts.nowMs) }]);
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}

/** Contexte de test complet : faux OKX (ou fetch fourni), horloges simulées, environnement explicite. */
export function testContext(opts: { nowMs: number; listingMs?: number; env?: Env; fetch?: FetchFn;
                                    override?: FakeOkxOptions['override'] }) {
  const clock = new FakeClock(opts.nowMs);
  const okx = fakeOkx({ nowMs: opts.nowMs, listingMs: opts.listingMs ?? 0, override: opts.override });
  const ctx: Context = createContext(clock.deps(opts.fetch ?? okx.fetch), opts.env ?? {});
  return { ctx, clock, calls: okx.calls };
}

export const req = (path: string) => new Request(`https://terminal.example${path}`);
