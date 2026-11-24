// Contexte commun des adaptateurs de plateforme (P5) : dépendances injectées (vraies dans le
// worker, fausses dans les tests), sortie des événements normalisés, carnets locaux, états de flux.

import type { FetchLike } from '../../data/protocol';
import type { LocalBook } from '../book';
import type { MicroFeedState, StreamDeps, VenueStream } from '../stream';
import type { MicroEvent } from '../types';

export interface VenueCtx {
  deps: StreamDeps & { fetch: FetchLike };
  emit: (e: MicroEvent) => void;
  onFeed: (s: MicroFeedState) => void;
}

export interface VenueAdapter {
  streams: VenueStream[];
  /** Carnets tenus par l'adaptateur (perpétuel ; Hyperliquid : fin et profond). */
  books: LocalBook[];
}

export const num = (x: unknown): number => {
  const v = Number(x);
  if (!Number.isFinite(v)) throw new Error(`nombre illisible : ${String(x).slice(0, 30)}`);
  return v;
};
