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
