// Accès PostgREST du module Bourse côté Vercel : lectures, décomptes et
// insertions avec la clé secrète (configuration de api/_lib/supabase.ts).
// Noms de tables et de colonnes : constantes du code, jamais une valeur reçue.

import type { FetchFn } from '../okx.js';
import { SupabaseError, SUPABASE_TIMEOUT_MS, type SupabaseConfig } from '../supabase.js';

const IDENT = /^[a-z_][a-z0-9_]*$/;

export interface BourseDb {
  select<T>(table: string, params: Record<string, string>): Promise<T[]>;
  count(table: string, params: Record<string, string>): Promise<number>;
  insert(table: string, rows: Record<string, unknown>[]): Promise<void>;
  /** Supprime les lignes filtrées ; renvoie leur nombre. */
  remove(table: string, params: Record<string, string>): Promise<number>;
  /** Fonction SQL (/rest/v1/rpc/<fn>) ; renvoie son résultat JSON. */
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
}

export function createBourseDb(cfg: SupabaseConfig, fetchFn: FetchFn): BourseDb {
  async function call(table: string, params: Record<string, string>, init: RequestInit): Promise<Response> {
    if (!IDENT.test(table.replace(/^rpc\//, ''))) throw new Error(`table invalide : ${table}`);
    const url = `${cfg.url}/rest/v1/${table}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
    let r: Response;
    try {
      r = await fetchFn(url, { ...init, headers: { ...cfg.headers, ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS) });
    } catch (e) {
      throw new SupabaseError('injoignable ou délai dépassé', `${table} : ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      let code = '';
      try {
        const c = (JSON.parse(text) as { code?: unknown }).code;
        if (typeof c === 'string' && /^[A-Z0-9]{3,10}$/.test(c)) code = c;
      } catch { /* corps vide ou non JSON */ }
      throw new SupabaseError(`HTTP ${r.status}${code ? ` (code ${code})` : ''}`, `${table} : ${text.slice(0, 200)}`);
    }
    return r;
  }

  return {
    async select<T>(table: string, params: Record<string, string>): Promise<T[]> {
      const r = await call(table, params, { method: 'GET', headers: { Accept: 'application/json' } });
      let rows: unknown;
      try { rows = await r.json(); } catch { throw new SupabaseError('réponse illisible', `${table} : pas du JSON`); }
      if (!Array.isArray(rows)) throw new SupabaseError('réponse illisible', `${table} : tableau attendu`);
      return rows as T[];
    },
    async count(table, params) {
      const r = await call(table, { select: 'id', ...params }, { method: 'HEAD', headers: { Prefer: 'count=exact' } });
      const m = /\/(\d+)$/.exec(r.headers.get('content-range') ?? '');
      if (!m) throw new SupabaseError('décompte absent de la réponse', `${table} : Content-Range ${r.headers.get('content-range')}`);
      return Number(m[1]);
    },
    async insert(table, rows) {
      if (!rows.length) return;
      await call(table, {}, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(rows),
      });
    },
    async remove(table, params) {
      if (!Object.keys(params).length) throw new Error('suppression sans filtre refusée');
      const r = await call(table, params, { method: 'DELETE', headers: { Prefer: 'return=representation', Accept: 'application/json' } });
      const rows = await r.json().catch(() => []);
      return Array.isArray(rows) ? rows.length : 0;
    },
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const r = await call(`rpc/${fn}`, {}, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(args),
      });
      try { return await r.json() as T; } catch { throw new SupabaseError('réponse illisible', `rpc ${fn} : pas du JSON`); }
    },
  };
}
