// Supabase Realtime pour P1 en Mode Online (plan « Tout en ligne », O5, décision T-043) :
// le navigateur rejoint le canal PUBLIC « p1-public », où la base diffuse chaque changement
// de p1_state (trigger p1_state_broadcast, migration 20261123160000_p1_realtime.sql).
//
// Seule la clé publishable de Supabase entre dans le front (VITE_SUPABASE_PUBLISHABLE_KEY) :
// elle permet de rejoindre ce canal public, et rien d'autre (aucune table n'a de politique RLS).

import { RealtimeClient } from '@supabase/realtime-js';

export const TOPIC = 'p1-public';
export const EVENT = 'state';

export interface StateMessage { key: string; value: unknown; updated_ms: number }
export type RealtimeStatus = 'connexion' | 'connecté' | 'coupé' | 'non configuré';

export interface RealtimeConfig { url: string | undefined; key: string | undefined }

export function realtimeConfig(): RealtimeConfig {
  // Tests (Vitest, MODE « test ») : jamais de vraie connexion, même si le .env porte les valeurs.
  if (import.meta.env.MODE === 'test') return { url: undefined, key: undefined };
  return { url: import.meta.env.VITE_SUPABASE_URL as string | undefined, key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined };
}

/** https://<projet>.supabase.co -> wss://<projet>.supabase.co/realtime/v1 (comme supabase-js). */
export function realtimeEndpoint(url: string): string {
  return `${url.replace(/\/$/, '').replace(/^http/i, 'ws')}/realtime/v1`;
}

/** Raison de ne pas se connecter, ou null si la configuration est utilisable. */
export function configProblem(c: RealtimeConfig): string | null {
  if (!c.url || !c.key) return 'Realtime non configuré (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(c.url)) return 'VITE_SUPABASE_URL invalide (https://<projet>.supabase.co attendu)';
  if (!c.key.startsWith('sb_publishable_')) return 'VITE_SUPABASE_PUBLISHABLE_KEY : clé publishable (sb_publishable_…) attendue, jamais une clé secrète';
  return null;
}

/** Rejoint le canal ; renvoie de quoi se déconnecter. */
export function connectRealtime(c: RealtimeConfig, onMessage: (m: StateMessage) => void,
  onStatus: (s: RealtimeStatus, why?: string) => void): () => void {
  const problem = configProblem(c);
  if (problem) {
    onStatus('non configuré', problem);
    return () => {};
  }
  const client = new RealtimeClient(realtimeEndpoint(c.url!), { params: { apikey: c.key! } });
  const channel = client.channel(TOPIC, { config: { broadcast: { self: false }, private: false } });
  channel.on('broadcast', { event: EVENT }, (msg: { payload?: unknown }) => {
    const p = msg.payload as Partial<StateMessage> | undefined;
    if (p && typeof p.key === 'string') onMessage({ key: p.key, value: p.value, updated_ms: Number(p.updated_ms) });
  });
  onStatus('connexion');
  channel.subscribe((status, err) => {
    if (status === 'SUBSCRIBED') onStatus('connecté');
    else onStatus('coupé', err?.message ?? status);
  });
  return () => { void client.removeAllChannels(); client.disconnect(); };
}
