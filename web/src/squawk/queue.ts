// File du squawk (plan P1 § 10) : priorités, interruption par un chiffre capté, abandon des
// annonces trop vieilles, chien de garde qui relance la synthèse vocale bloquée (Chrome peut
// cesser d'appeler onend). Le moteur est injecté : la file se teste sans navigateur.

import type { Lang } from './speech';

export type UtteranceKind = 'chiffre' | 'alerte' | 'titre' | 'essai';

/** Plus le nombre est grand, plus l'annonce passe tôt ; un chiffre interrompt le reste. */
export const PRIORITY: Record<UtteranceKind, number> = { chiffre: 3, alerte: 2, essai: 2, titre: 1 };
/** Âge maximal avant d'être dit (plan : titres de plus de 60 s abandonnés). */
export const MAX_AGE_MS: Record<UtteranceKind, number> = { chiffre: 10 * 60_000, alerte: 5 * 60_000, essai: 60_000, titre: 60_000 };
export const WATCHDOG_MS = 25_000;

export interface Utterance {
  id: string;
  kind: UtteranceKind;
  text: string;
  lang: Lang;
  created_ms: number;
}

export interface Speaker {
  speak(u: Utterance, done: () => void): void;
  cancel(): void;
}

export interface Spoken { id: string; kind: UtteranceKind; text: string; at_ms: number; outcome: 'dit' | 'interrompu' | 'abandonné' | 'bloqué' }

export class SquawkQueue {
  private queue: Utterance[] = [];
  private current: { u: Utterance; started: number; token: number } | null = null;
  private token = 0;
  readonly history: Spoken[] = [];
  private listeners = new Set<() => void>();

  constructor(private speaker: Speaker, private clock: () => number = Date.now) {}

  get pending(): number { return this.queue.length; }
  get speaking(): Utterance | null { return this.current?.u ?? null; }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  push(u: Utterance): void {
    if (this.current?.u.id === u.id || this.queue.some((q) => q.id === u.id)) return;
    const cur = this.current;
    if (cur && PRIORITY[u.kind] > PRIORITY[cur.u.kind] && u.kind === 'chiffre') {
      this.finish('interrompu');
      this.speaker.cancel();
    }
    // Insertion stable : derrière les annonces de priorité supérieure ou égale.
    const at = this.queue.findIndex((q) => PRIORITY[q.kind] < PRIORITY[u.kind]);
    if (at < 0) this.queue.push(u); else this.queue.splice(at, 0, u);
    this.next();
  }

  /** À appeler régulièrement (1 s) : abandons et chien de garde. */
  tick(): void {
    const now = this.clock();
    if (this.current && now - this.current.started > WATCHDOG_MS) {
      this.finish('bloqué');
      this.speaker.cancel();
    }
    this.next();
  }

  clear(): void {
    this.queue = [];
    if (this.current) { this.finish('interrompu'); this.speaker.cancel(); }
    this.emit();
  }

  private next(): void {
    if (this.current) { this.emit(); return; }
    const now = this.clock();
    while (this.queue.length) {
      const u = this.queue.shift()!;
      if (now - u.created_ms > MAX_AGE_MS[u.kind]) { this.log(u, 'abandonné'); continue; }
      const token = ++this.token;
      this.current = { u, started: now, token };
      this.speaker.speak(u, () => {
        if (this.current?.token !== token) return;   // annonce déjà interrompue ou relancée
        this.finish('dit');
        this.next();
      });
      break;
    }
    this.emit();
  }

  private finish(outcome: Spoken['outcome']): void {
    if (this.current) this.log(this.current.u, outcome);
    this.current = null;
  }

  private log(u: Utterance, outcome: Spoken['outcome']): void {
    this.history.unshift({ id: u.id, kind: u.kind, text: u.text, at_ms: this.clock(), outcome });
    this.history.length = Math.min(this.history.length, 30);
  }

  private emit(): void { for (const l of this.listeners) l(); }
}
