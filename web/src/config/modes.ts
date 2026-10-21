// Modes de fonctionnement du terminal : où tourne le moteur de données.
//
//   Mode Online : rien à faire tourner chez soi. Le navigateur lit les WebSockets
//                 publiques d'OKX en direct ; les fonctions Vercel servent le REST
//                 d'OKX (qui refuse le CORS) ; Supabase héberge le collecteur
//                 planifié chaque minute et son journal.
//   Mode Local  : la passerelle Python tourne sur le Mac (http://127.0.0.1:8710).
//   Mode Tour   : la passerelle Python tourne sur la tour Windows, jointe par
//                 Tailscale en https (tailscale serve).
//
// Le choix est propre à chaque appareil (stockage local du navigateur) : le Mac
// peut être en Mode Local pendant que le téléphone est en Mode Online.

export type Mode = 'online' | 'local' | 'tour';

export interface ModeDef {
  id: Mode;
  label: string;        // « Mode Online »
  short: string;        // « Online »
  where: string;        // où tourne le moteur
  description: string;
}

export const MODES: ModeDef[] = [
  {
    id: 'online', label: 'Mode Online', short: 'Online', where: 'Vercel + Supabase',
    description: 'Aucun service à lancer : flux OKX lus en direct par le navigateur, REST via les fonctions Vercel, collecteur planifié dans Supabase.',
  },
  {
    id: 'local', label: 'Mode Local', short: 'Local', where: 'Mac',
    description: 'La passerelle tourne sur ce Mac : python scripts/dev.py, ou au démarrage de session avec deploy/macos.',
  },
  {
    id: 'tour', label: 'Mode Tour', short: 'Tour', where: 'Tour Windows · Tailscale',
    description: 'La passerelle tourne sur la tour Windows, 24 h/24, jointe par Tailscale en https.',
  },
];

export function modeDef(mode: Mode): ModeDef {
  return MODES.find((m) => m.id === mode)!;
}

export interface Settings {
  mode: Mode;
  localUrl: string;   // passerelle du Mac
  tourUrl: string;    // passerelle de la tour (https://…ts.net), vide tant que non configurée
}

export interface BuildEnv {
  VITE_DEFAULT_MODE?: string;
  VITE_LOCAL_GATEWAY_URL?: string;
  VITE_TOUR_GATEWAY_URL?: string;
}

export const STORAGE_KEY = 'terminal.settings.v1';
export const DEFAULT_LOCAL_URL = 'http://127.0.0.1:8710';

/** Instruments suivis en Mode Online (en Modes Local et Tour, la passerelle décide). */
export const ONLINE_INSTRUMENTS = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'];

/** WebSockets publiques OKX du compte européen (docs/okx.md, décision T-008). */
export const OKX_EEA_WS = {
  public: 'wss://wseea.okx.com/ws/v5/public',
  business: 'wss://wseea.okx.com/ws/v5/business',
};

function isMode(x: unknown): x is Mode {
  return x === 'online' || x === 'local' || x === 'tour';
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Adresse de passerelle acceptable, ou message d'erreur.
 * https partout ; http seulement vers la machine elle-même (une page https ne
 * peut joindre en http que localhost, et rien d'autre ne doit circuler en clair).
 */
export function validateGatewayUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return 'adresse vide';
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return 'adresse invalide';
  }
  if (u.username || u.password) return 'pas d’identifiants dans l’adresse';
  // « ? » ou « # » final : URL les ignore (search et hash vides) mais l'adresse
  // reste inutilisable pour la WebSocket.
  if (u.search || u.hash || /[?#]/.test(value)) return 'pas de paramètres dans l’adresse';
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname)) return null;
  if (u.protocol === 'http:') return 'http n’est accepté que vers cette machine (localhost) : utiliser https (tailscale serve)';
  return 'protocole non pris en charge (https attendu)';
}

export function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/** Réglages par défaut : variables de build, sinon déduits de l'adresse de la page. */
export function defaultSettings(env: BuildEnv, hostname: string): Settings {
  const fromEnv = env.VITE_DEFAULT_MODE;
  const mode: Mode = isMode(fromEnv) ? fromEnv : LOCAL_HOSTS.has(hostname) ? 'local' : 'online';
  return {
    mode,
    localUrl: normalizeUrl(env.VITE_LOCAL_GATEWAY_URL || DEFAULT_LOCAL_URL),
    tourUrl: normalizeUrl(env.VITE_TOUR_GATEWAY_URL || ''),
  };
}

interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** Réglages enregistrés sur cet appareil, complétés par les défauts ; jamais d'exception. */
export function loadSettings(storage: StorageLike | null, defaults: Settings): Settings {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      mode: isMode(saved.mode) ? saved.mode : defaults.mode,
      localUrl: typeof saved.localUrl === 'string' && !validateGatewayUrl(saved.localUrl)
        ? normalizeUrl(saved.localUrl) : defaults.localUrl,
      // Adresse vide enregistrée : celle du build (VITE_TOUR_GATEWAY_URL) reprend la main.
      tourUrl: typeof saved.tourUrl === 'string' && saved.tourUrl.trim() !== '' && !validateGatewayUrl(saved.tourUrl)
        ? normalizeUrl(saved.tourUrl) : defaults.tourUrl,
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(storage: StorageLike | null, s: Settings): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(s));
    return !!storage;
  } catch {
    return false; // navigation privée, stockage bloqué : le réglage vaut pour la session
  }
}

// --- Source de données du worker, selon le mode ---------------------------------

export type SourceConfig =
  | { kind: 'gateway'; mode: 'local' | 'tour'; baseUrl: string; wsUrl: string }
  | {
      kind: 'okx-direct'; mode: 'online'; apiBase: string;
      publicWs: string; businessWs: string; instruments: string[];
    };

/** Source du worker pour ces réglages, ou null si le mode n'est pas configuré (Tour sans adresse). */
export function sourceFor(s: Settings): SourceConfig | null {
  if (s.mode === 'online') {
    return {
      kind: 'okx-direct', mode: 'online', apiBase: '',
      publicWs: OKX_EEA_WS.public, businessWs: OKX_EEA_WS.business, instruments: ONLINE_INSTRUMENTS,
    };
  }
  const baseUrl = normalizeUrl(s.mode === 'local' ? s.localUrl : s.tourUrl);
  if (!baseUrl || validateGatewayUrl(baseUrl)) return null;
  return { kind: 'gateway', mode: s.mode, baseUrl, wsUrl: `${baseUrl.replace(/^http/, 'ws')}/ws` };
}

/** Base des routes REST (/api/chart, /api/health…) : la passerelle, ou les fonctions Vercel (même origine). */
export function restBase(s: Settings): string | null {
  if (s.mode === 'online') return '';
  const src = sourceFor(s);
  return src && src.kind === 'gateway' ? src.baseUrl : null;
}
