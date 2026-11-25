// Voix de l'assistant (P6, S2–S3) : réponses lues par la synthèse vocale du navigateur, avec la voix
// française choisie pour le squawk (terminal.squawk.v1) et sa normalisation des nombres ; « Muet »
// coupe la lecture (réglage gardé dans le navigateur). La dictée (appui pour parler) vient en S3.

import { useSyncExternalStore } from 'react';
import { loadPrefs, voicesFor } from '../squawk/engine';
import { normalizeSpeech } from '../squawk/speech';

const MUTE_KEY = 'terminal.assistant.muted.v1';
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

let muted: boolean = (() => { try { return storage()?.getItem(MUTE_KEY) !== '0'; } catch { return true; } })();   // muet par défaut

export function isMuted(): boolean { return muted; }

export function setMuted(v: boolean): void {
  muted = v;
  try { storage()?.setItem(MUTE_KEY, v ? '1' : '0'); } catch { /* réglage de la session seulement */ }
  if (v) stopSpeaking();
  listeners.forEach((l) => l());
}

export function useMuted(): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => muted, () => true);
}

export function stopSpeaking(): void {
  try { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); } catch { /* rien à arrêter */ }
}

/** Lit une réponse (sauf « Muet » ou synthèse absente) ; renvoie false si rien n'a été lu. */
export function speak(text: string): boolean {
  if (muted || typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  const synth = window.speechSynthesis;
  const utt = new SpeechSynthesisUtterance(normalizeSpeech(text, 'fr'));
  utt.lang = 'fr-FR';
  const pref = loadPrefs().voiceFr;
  const voices = voicesFor('fr', synth.getVoices());
  const v = voices.find((x) => x.name === pref) ?? voices[0];
  if (v) utt.voice = v;
  synth.cancel();
  synth.speak(utt);
  return true;
}

// --- Dictée (S3) : appui pour parler -------------------------------------------------------------

/** Sous-ensemble de SpeechRecognition (Chrome : webkitSpeechRecognition ; Safari : partiel). */
export interface RecognitionLike {
  lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
export type RecognitionCtor = new () => RecognitionLike;

export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'micro refusé par le navigateur', 'service-not-allowed': 'dictée refusée par le navigateur',
  'no-speech': 'aucune parole entendue', 'audio-capture': 'aucun micro détecté', network: 'service de dictée injoignable',
  aborted: 'dictée annulée', 'language-not-supported': 'dictée en français indisponible dans ce navigateur',
};

/**
 * Une dictée en français : une seule phrase, résultat final seulement. `done` reçoit le texte, ou
 * une erreur lisible ; la lecture en cours est coupée (on ne parle pas pendant que l'assistant lit).
 */
export function dictate(ctor: RecognitionCtor | null, done: (r: { text: string } | { error: string }) => void): (() => void) | null {
  if (!ctor) { done({ error: 'dictée indisponible dans ce navigateur : utiliser le champ texte' }); return null; }
  stopSpeaking();
  const rec = new ctor();
  rec.lang = 'fr-FR'; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false;
  let settled = false;
  const finish = (r: { text: string } | { error: string }) => { if (!settled) { settled = true; done(r); } };
  rec.onresult = (ev) => {
    const t = Array.from(ev.results).map((r) => r[0]?.transcript ?? '').join(' ').trim();
    finish(t ? { text: t } : { error: ERRORS['no-speech'] });
  };
  rec.onerror = (ev) => finish({ error: ERRORS[ev.error] ?? `dictée interrompue (${ev.error})` });
  rec.onend = () => finish({ error: ERRORS['no-speech'] });
  try { rec.start(); } catch (e) { finish({ error: `dictée impossible : ${(e as Error).message}` }); return null; }
  return () => { try { rec.stop(); } catch { /* déjà arrêtée */ } };
}
