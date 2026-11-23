// Squawk dans le navigateur (plan P1 § 10) : synthèse vocale, son généré (Web Audio),
// notifications du système, et un seul onglet qui parle par navigateur (Web Locks).
//
// - « Activer voix et son » (barre du haut) doit être cliqué à chaque chargement de page :
//   Chrome et iOS refusent la voix et le son sans geste de l'utilisateur.
// - L'onglet qui obtient le verrou « terminal-squawk » parle ; les autres attendent qu'il
//   se ferme. Sans Web Locks (vieux navigateur), chaque onglet activé parle.
// - Voix et réglages choisis par appareil, gardés dans le stockage local (sans garantie :
//   stockage bloqué -> valeurs par défaut).

import { useSyncExternalStore } from 'react';
import { browserStorage } from '../config/settings';
import { SquawkQueue, type Speaker, type Utterance } from './queue';
import type { Lang } from './speech';

export interface SquawkPrefs {
  voiceFr: string | null;     // nom de la voix (SpeechSynthesisVoice.name)
  voiceEn: string | null;
  figures: boolean;           // chiffres captés
  alerts: boolean;            // alertes dont la règle demande la voix
  headlines: boolean;         // titres urgents (E6)
  sound: boolean;             // bip des alertes
  notifications: boolean;     // notification du système quand l'onglet est caché
}

export const DEFAULT_PREFS: SquawkPrefs = {
  voiceFr: null, voiceEn: null, figures: true, alerts: true, headlines: true, sound: true, notifications: true,
};

const PREFS_KEY = 'terminal.squawk.v1';
const LOCK = 'terminal-squawk';

export function loadPrefs(): SquawkPrefs {
  try {
    const raw = browserStorage()?.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<SquawkPrefs>) } : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(p: SquawkPrefs): void {
  try { browserStorage()?.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* stockage bloqué : réglage de la session seulement */ }
}

/** Voix disponibles pour une langue, celles du pays d'abord (fr-FR, en-US). */
export function voicesFor(lang: Lang, all: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const pref = lang === 'fr' ? 'fr-fr' : 'en-us';
  return all.filter((v) => v.lang.toLowerCase().startsWith(lang))
    .sort((a, b) => Number(b.lang.toLowerCase() === pref) - Number(a.lang.toLowerCase() === pref) || a.name.localeCompare(b.name));
}

export interface SquawkState {
  supported: { speech: boolean; audio: boolean; notifications: boolean; locks: boolean };
  enabled: boolean;           // geste reçu sur ce chargement de page
  leader: boolean;            // cet onglet parle pour le navigateur
  notificationPermission: NotificationPermission | 'indisponible';
  prefs: SquawkPrefs;
  voices: { name: string; lang: string }[];
  speaking: string | null;
  pending: number;
  history: SquawkQueue['history'];
}

class BrowserSpeaker implements Speaker {
  constructor(private prefs: () => SquawkPrefs) {}

  speak(u: Utterance, done: () => void): void {
    const synth = window.speechSynthesis;
    const utt = new SpeechSynthesisUtterance(u.text);
    const name = u.lang === 'fr' ? this.prefs().voiceFr : this.prefs().voiceEn;
    const voice = voicesFor(u.lang, synth.getVoices()).find((v) => !name || v.name === name);
    if (voice) utt.voice = voice;
    utt.lang = voice?.lang ?? (u.lang === 'fr' ? 'fr-FR' : 'en-US');
    utt.onend = done;
    utt.onerror = done;
    synth.speak(utt);
  }

  cancel(): void {
    try { window.speechSynthesis.cancel(); } catch { /* rien à arrêter */ }
  }
}

class Squawk {
  private audio: AudioContext | null = null;
  private listeners = new Set<() => void>();
  private snapshot: SquawkState;
  readonly queue: SquawkQueue;
  private prefs = loadPrefs();
  private enabled = false;
  private leader = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.queue = new SquawkQueue(new BrowserSpeaker(() => this.prefs));
    this.queue.subscribe(() => this.emit());
    this.snapshot = this.compute();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.addEventListener?.('voiceschanged', () => this.emit());
    }
  }

  private supported(): SquawkState['supported'] {
    const w = typeof window === 'undefined' ? undefined : window;
    return {
      speech: !!w && 'speechSynthesis' in w,
      audio: !!w && ('AudioContext' in w || 'webkitAudioContext' in w),
      notifications: !!w && 'Notification' in w,
      locks: typeof navigator !== 'undefined' && !!navigator.locks,
    };
  }

  private compute(): SquawkState {
    const s = this.supported();
    return {
      supported: s,
      enabled: this.enabled,
      leader: this.leader,
      notificationPermission: s.notifications ? Notification.permission : 'indisponible',
      prefs: this.prefs,
      voices: s.speech ? window.speechSynthesis.getVoices().map((v) => ({ name: v.name, lang: v.lang })) : [],
      speaking: this.queue.speaking?.text ?? null,
      pending: this.queue.pending,
      history: [...this.queue.history],
    };
  }

  private emit(): void {
    this.snapshot = this.compute();
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  get = (): SquawkState => this.snapshot;

  /** Geste de l'utilisateur : débloque la voix, le son et demande la permission de notifier. */
  async enable(): Promise<void> {
    const s = this.supported();
    if (s.audio) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audio = this.audio ?? new Ctx();
      await this.audio.resume().catch(() => undefined);
      this.beep('alerte');
    }
    this.enabled = true;
    if (!this.timer) this.timer = setInterval(() => this.queue.tick(), 1000);
    this.claimVoice();
    if (s.speech) {
      // Dite dans le geste : c'est ce qui débloque la synthèse sur Chrome et iOS.
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance('Voix activée'));
    }
    if (s.notifications && this.prefs.notifications && Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => 'denied');
    }
    this.emit();
  }

  disable(): void {
    this.enabled = false;
    this.queue.clear();
    this.emit();
  }

  private claimVoice(): void {
    if (this.leader) return;
    if (!navigator.locks) { this.leader = true; return; }
    // Le verrou est gardé tant que la page vit ; à sa fermeture, l'onglet suivant le reçoit.
    void navigator.locks.request(LOCK, () => new Promise<void>(() => {
      this.leader = true;
      this.emit();
    }));
  }

  setPrefs(p: Partial<SquawkPrefs>): void {
    this.prefs = { ...this.prefs, ...p };
    savePrefs(this.prefs);
    this.emit();
  }

  /** Cet onglet doit-il annoncer ? (activé ici, et seul à parler pour le navigateur) */
  get active(): boolean { return this.enabled && this.leader; }

  say(u: Utterance): void {
    if (this.active && this.supported().speech) this.queue.push(u);
  }

  beep(kind: 'alerte' | 'chiffre'): void {
    if (!this.audio || !this.prefs.sound) return;
    const ctx = this.audio;
    const notes = kind === 'chiffre' ? [880, 1320] : [660, 990];
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.13);
    });
  }

  /** Notification du système, seulement quand l'onglet est caché (sinon l'écran suffit). */
  notify(title: string, body: string, tag: string): void {
    if (!this.supported().notifications || !this.prefs.notifications) return;
    if (Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    try { new Notification(title, { body, tag }); } catch { /* refusée par le navigateur */ }
  }
}

export const squawk = new Squawk();

export function useSquawk(): SquawkState {
  return useSyncExternalStore(squawk.subscribe, squawk.get);
}
