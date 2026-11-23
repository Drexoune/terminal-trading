// Client PostgREST de p1-jobs : lecture, insertion (avec retour des lignes créées), upsert.
// Même règles que okx-collector/postgrest.ts (clé secrète seulement, noms de tables et de
// colonnes contrôlés, jamais une valeur extérieure collée dans le chemin).

import { authHeaders, type FetchLike } from '../okx-collector/postgrest.ts';

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type Row = Record<string, Json>;

export interface Rest {
  select<T = Row>(table: string, query: Record<string, string>): Promise<T[]>;
  insert<T = Row>(table: string, rows: Row[], returning?: string): Promise<T[]>;
  upsert(table: string, rows: Row[], onConflict: string): Promise<void>;
  /** INSERT … ON CONFLICT DO NOTHING ; renvoie les lignes réellement créées (verrou, première publication). */
  insertIgnore<T = Row>(table: string, rows: Row[], onConflict: string, returning: string): Promise<T[]>;
  rpc<T = unknown>(fn: string, args: Row): Promise<T>;
  /** PATCH des lignes qui passent les filtres (eq.…, is.null…) ; jamais sans filtre. */
  update(table: string, filters: Record<string, string>, patch: Row): Promise<void>;
  /** DELETE des lignes qui passent les filtres ; jamais sans filtre. */
  remove(table: string, filters: Record<string, string>): Promise<void>;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const IDENT_LIST = /^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$/;

export function createRest(url: string, key: string, fetchFn: FetchLike, timeoutMs = 15_000): Rest {
  const base = `${url.replace(/\/+$/, '')}/rest/v1`;
  const auth = authHeaders(key);

  async function call(path: string, init: { method: string; body?: string; prefer?: string }): Promise<string> {
    const headers: Record<string, string> = { ...auth, Accept: 'application/json' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.prefer) headers.Prefer = init.prefer;
    let r;
    try {
      r = await fetchFn(`${base}/${path}`, { method: init.method, headers, body: init.body, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new Error(`PostgREST injoignable (${path.split('?')[0]}) : ${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await r.text();
    if (!r.ok) {
      let detail = text.slice(0, 300);
      try {
        const b = JSON.parse(text) as { code?: string; message?: string };
        if (b.message) detail = `${b.code ? `${b.code} ` : ''}${b.message}`;
      } catch { /* corps non JSON */ }
      throw new Error(`PostgREST ${r.status} sur ${path.split('?')[0]} : ${detail}`);
    }
    return text;
  }

  const table = (t: string) => {
    if (!IDENT.test(t)) throw new Error(`table invalide : ${t}`);
    return t;
  };

  return {
    async select<T>(t: string, query: Record<string, string>) {
      const text = await call(`${table(t)}?${new URLSearchParams(query)}`, { method: 'GET' });
      return JSON.parse(text) as T[];
    },
    async insert<T>(t: string, rows: Row[], returning?: string) {
      if (!rows.length) return [];
      if (returning && !IDENT_LIST.test(returning)) throw new Error(`colonnes invalides : ${returning}`);
      const q = returning ? `?select=${returning}` : '';
      const text = await call(`${table(t)}${q}`, {
        method: 'POST', body: JSON.stringify(rows), prefer: returning ? 'return=representation' : 'return=minimal',
      });
      return returning ? JSON.parse(text) as T[] : [];
    },
    async upsert(t: string, rows: Row[], onConflict: string) {
      if (!rows.length) return;
      if (!IDENT_LIST.test(onConflict)) throw new Error(`on_conflict invalide : ${onConflict}`);
      await call(`${table(t)}?on_conflict=${onConflict}`, {
        method: 'POST', body: JSON.stringify(rows), prefer: 'resolution=merge-duplicates,return=minimal',
      });
    },
    async insertIgnore<T>(t: string, rows: Row[], onConflict: string, returning: string) {
      if (!rows.length) return [];
      if (!IDENT_LIST.test(onConflict) || !IDENT_LIST.test(returning)) throw new Error('colonnes invalides');
      const text = await call(`${table(t)}?on_conflict=${onConflict}&select=${returning}`, {
        method: 'POST', body: JSON.stringify(rows), prefer: 'resolution=ignore-duplicates,return=representation',
      });
      return JSON.parse(text) as T[];
    },
    async update(t: string, filters: Record<string, string>, patch: Row) {
      if (!Object.keys(filters).length) throw new Error('update sans filtre refusé');
      if (!Object.keys(filters).every((k) => IDENT.test(k))) throw new Error('filtre invalide');
      await call(`${table(t)}?${new URLSearchParams(filters)}`, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal' });
    },
    async remove(t: string, filters: Record<string, string>) {
      if (!Object.keys(filters).length) throw new Error('suppression sans filtre refusée');
      if (!Object.keys(filters).every((k) => IDENT.test(k))) throw new Error('filtre invalide');
      await call(`${table(t)}?${new URLSearchParams(filters)}`, { method: 'DELETE', prefer: 'return=minimal' });
    },
    async rpc<T>(fn: string, args: Row) {
      if (!IDENT.test(fn)) throw new Error(`fonction invalide : ${fn}`);
      const text = await call(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
      return (text ? JSON.parse(text) : null) as T;
    },
  };
}

/** bytea <-> PostgREST : texte hexadécimal « \x… ». */
export function toBytea(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `\\x${hex}`;
}

export function fromBytea(text: string | null | undefined): Uint8Array | null {
  if (!text || !text.startsWith('\\x')) return null;
  const hex = text.slice(2);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
