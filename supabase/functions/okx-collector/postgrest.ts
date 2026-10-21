// Client PostgREST minimal (API REST de la base Supabase), sans dépendance :
// supabase-js n'apporterait ici que du poids, et ce module doit rester pur
// (aucune API Deno, aucun import npm) pour être testé par Vitest.
//
// Clés acceptées (docs Supabase « API keys », à vérifier au déploiement) :
// - nouvelle clé secrète `sb_secret_…` : en-tête `apikey` SEUL. Ce n'est pas
//   un JWT : l'envoyer aussi en `Authorization: Bearer` fait répondre
//   « Invalid JWT » ;
// - ancienne clé `service_role` (JWT, commence par `eyJ`) : `apikey` +
//   `Authorization: Bearer`.
// Une clé publiable (`sb_publishable_…`) ou un JWT `anon` est refusé d'emblée :
// la RLS sans politique ne lui laisserait rien lire ni écrire, autant échouer
// clairement plutôt que d'écrire zéro ligne en silence.

export interface ResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface RequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** Sous-ensemble de fetch utilisé ici ; le fetch global de Deno et de Node convient. */
export type FetchLike = (url: string, init?: RequestInitLike) => Promise<ResponseLike>;

export type Row = Record<string, string | number | boolean | null>;

export interface Db {
  insert(table: string, rows: Row[]): Promise<void>;
  /** INSERT … ON CONFLICT (onConflict) DO UPDATE : rejouer un passage ne crée pas de doublon. */
  upsert(table: string, rows: Row[], onConflict: string): Promise<void>;
  select<T = Row>(table: string, query: Record<string, string>): Promise<T[]>;
}

export type KeyKind = 'secret' | 'legacy-jwt';

/** Lit la charge d'un JWT sans vérifier sa signature (seul le rôle nous intéresse). */
function jwtRole(key: string): string | null {
  try {
    const part = key.split('.')[1] ?? '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const payload = JSON.parse(atob(b64)) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/** Type de clé, ou erreur si ce n'est pas une clé capable d'écrire malgré la RLS. */
export function keyKind(key: string): KeyKind {
  if (key.startsWith('sb_secret_')) return 'secret';
  if (key.startsWith('sb_publishable_')) {
    throw new Error('clé publiable refusée : le collecteur a besoin de la clé secrète');
  }
  if (key.startsWith('eyJ') && key.split('.').length === 3) {
    const role = jwtRole(key);
    if (role !== null && role !== 'service_role') {
      throw new Error(`clé JWT de rôle « ${role} » refusée : la clé service_role est requise`);
    }
    return 'legacy-jwt';
  }
  throw new Error('format de clé Supabase inconnu (sb_secret_… ou JWT service_role attendu)');
}

/** En-têtes d'authentification selon le type de clé. */
export function authHeaders(key: string): Record<string, string> {
  return keyKind(key) === 'secret'
    ? { apikey: key }
    : { apikey: key, Authorization: `Bearer ${key}` };
}

// Noms de tables et de colonnes : uniquement ce que la migration définit, jamais
// une valeur venue de l'extérieur collée dans l'URL.
const IDENT = /^[a-z_][a-z0-9_]*$/;
const IDENT_LIST = /^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$/;

function checkIdent(value: string, pattern: RegExp, what: string): void {
  if (!pattern.test(value)) throw new Error(`PostgREST : ${what} invalide (${JSON.stringify(value)})`);
}

export interface PostgrestOptions {
  url: string;          // SUPABASE_URL, https://<ref>.supabase.co
  key: string;          // clé secrète
  fetch: FetchLike;
  timeoutMs?: number;   // par requête ; 10 s par défaut
}

export function createPostgrest(opts: PostgrestOptions): Db {
  const base = `${opts.url.replace(/\/+$/, '')}/rest/v1`;
  const auth = authHeaders(opts.key);   // lève tout de suite si la clé ne convient pas
  const timeoutMs = opts.timeoutMs ?? 10_000;

  async function call(table: string, search: string, init: RequestInitLike): Promise<string> {
    checkIdent(table, IDENT, 'table');
    const url = `${base}/${table}${search ? `?${search}` : ''}`;
    let r: ResponseLike;
    try {
      r = await opts.fetch(url, {
        ...init,
        headers: { ...auth, ...init.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // Panne réseau ou délai dépassé : le message d'origine ne nomme pas la table.
      throw new Error(`PostgREST injoignable sur ${table} : ${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await r.text();
    if (!r.ok) {
      // Réponse d'erreur PostgREST : {code, message, details, hint}.
      let detail = text.slice(0, 300);
      try {
        const body = JSON.parse(text) as { code?: string; message?: string };
        if (body.message) detail = `${body.code ? `${body.code} ` : ''}${body.message}`;
      } catch { /* corps non JSON : on garde le texte brut */ }
      throw new Error(`PostgREST ${r.status} sur ${table} : ${detail}`);
    }
    return text;
  }

  async function write(table: string, rows: Row[], prefer: string, search: string): Promise<void> {
    if (rows.length === 0) return;
    await call(table, search, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: prefer },
      body: JSON.stringify(rows),
    });
  }

  return {
    insert: (table, rows) => write(table, rows, 'return=minimal', ''),

    async upsert(table, rows, onConflict) {
      checkIdent(onConflict, IDENT_LIST, 'on_conflict');
      await write(table, rows, 'resolution=merge-duplicates,return=minimal',
        new URLSearchParams({ on_conflict: onConflict }).toString());
    },

    async select<T>(table: string, query: Record<string, string>): Promise<T[]> {
      const text = await call(table, new URLSearchParams(query).toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      let rows: unknown;
      try {
        rows = JSON.parse(text);
      } catch {
        throw new Error(`PostgREST : réponse non JSON sur ${table}`);
      }
      if (!Array.isArray(rows)) throw new Error(`PostgREST : tableau attendu sur ${table}`);
      return rows as T[];
    },
  };
}
