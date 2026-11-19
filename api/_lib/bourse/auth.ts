// Accès au module Bourse par mot de passe d'application (décision T-031,
// docs/plan-b0.md § 6). WebCrypto seulement : le même code tourne sur Vercel,
// sous Vite et dans Vitest, sans dépendre des types de Node.
//
// - Empreinte : PBKDF2-SHA256, 600 000 itérations, sel aléatoire de 16 octets,
//   produite par scripts/bourse_password.py et collée dans Vercel
//   (BOURSE_PASSWORD_HASH = « pbkdf2-sha256$<itérations>$<sel b64>$<hash b64> »).
//   Le mot de passe n'est stocké nulle part.
// - Session : cookie « __Host-bourse » = « v1.<expiration en s>.<signature> »,
//   HMAC-SHA256 avec BOURSE_SESSION_SECRET. HttpOnly, Secure, SameSite=Strict,
//   Path=/. Changer le secret ferme toutes les sessions.

export const COOKIE_NAME = '__Host-bourse';
export const SESSION_DAYS = 30;                 // décision de Clément, 19/11/2026
export const MIN_ITERATIONS = 100_000;
export const MIN_SECRET_LENGTH = 32;
export const MAX_PASSWORD_LENGTH = 256;

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Égalité à temps constant de deux suites d'octets de même longueur. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export interface PasswordHash { iterations: number; salt: Uint8Array; hash: Uint8Array }

/** Lit BOURSE_PASSWORD_HASH, ou explique pourquoi il est refusé. */
export function parsePasswordHash(raw: string | undefined): PasswordHash | string {
  const parts = (raw ?? '').trim().split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') {
    return 'BOURSE_PASSWORD_HASH absente ou mal formée (produite par scripts/bourse_password.py)';
  }
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS) return `BOURSE_PASSWORD_HASH : ${MIN_ITERATIONS} itérations au moins`;
  try {
    const salt = fromB64(parts[2]);
    const hash = fromB64(parts[3]);
    if (salt.length < 16 || hash.length !== 32) return 'BOURSE_PASSWORD_HASH : sel ou empreinte de taille inattendue';
    return { iterations, salt, hash };
  } catch {
    return 'BOURSE_PASSWORD_HASH : base64 illisible';
  }
}

export async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  if (!password || password.length > MAX_PASSWORD_LENGTH) return false;
  return sameBytes(await pbkdf2(password, stored.salt, stored.iterations), stored.hash);
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Valeur du cookie de session, valable jusqu'à expSec (secondes UTC). */
export async function signSession(expSec: number, secret: string): Promise<string> {
  const body = `v1.${expSec}`;
  return `${body}.${b64url(await hmac(secret, body))}`;
}

/** Expiration (s) d'une session valide, sinon null : signature fausse, format inconnu ou expirée. */
export async function verifySession(value: string | null, secret: string, nowMs: number): Promise<number | null> {
  const m = /^v1\.(\d{9,11})\.([A-Za-z0-9_-]{43})$/.exec(value ?? '');
  if (!m) return null;
  const exp = Number(m[1]);
  const expected = await hmac(secret, `v1.${m[1]}`);
  let given: Uint8Array;
  try { given = fromB64(m[2]); } catch { return null; }
  if (!sameBytes(given, expected)) return null;
  return exp * 1000 > nowMs ? exp : null;
}

/** Valeur d'un cookie dans l'en-tête Cookie. */
export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(value: string, maxAgeSec: number): string {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearedCookie(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

/**
 * Requête qui modifie : même origine exigée. L'en-tête Origin, quand il est
 * présent, doit être celui de la requête ; le corps doit être du JSON (un
 * formulaire d'un autre site ne peut pas envoyer ce type sans pré-vérification CORS).
 */
export function sameOriginJson(request: Request): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (origin) {
    let o: URL;
    try { o = new URL(origin); } catch { return false; }
    if (!host || o.host !== host) return false;
  }
  return (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() === 'application/json';
}

/** Adresse du client (Vercel : première entrée de x-forwarded-for), jamais stockée en clair. */
export function clientAddress(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  return (fwd?.split(',')[0] ?? request.headers.get('x-real-ip') ?? 'inconnue').trim().slice(0, 64);
}

/** Empreinte de l'adresse pour le compteur d'essais : HMAC tronqué, non réversible sans le secret. */
export async function addressKey(address: string, secret: string): Promise<string> {
  return b64url(await hmac(secret, `essais:${address}`)).slice(0, 32);
}
