// @vitest-environment node
// Dictée de l'assistant (P6, S3) : fausse reconnaissance vocale. Français, une phrase, résultat
// final ; erreurs lisibles ; navigateur sans dictée signalé (le champ texte reste).
import { describe, expect, it } from 'vitest';
import { dictate, type RecognitionLike } from './voice';

class FakeRec implements RecognitionLike {
  static last: FakeRec;
  lang = ''; interimResults = true; maxAlternatives = 5; continuous = true;
  onresult: RecognitionLike['onresult'] = null;
  onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null;
  started = false; stopped = false;
  constructor() { FakeRec.last = this; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  abort() {}
}

describe('dictée', () => {
  it('réglée en français, une phrase, résultat final ; texte transmis une seule fois', () => {
    const got: unknown[] = [];
    const stop = dictate(FakeRec, (r) => got.push(r))!;
    const r = FakeRec.last;
    expect([r.lang, r.interimResults, r.maxAlternatives, r.continuous, r.started]).toEqual(['fr-FR', false, 1, false, true]);
    r.onresult?.({ results: [[{ transcript: 'où en est le BTC ' }]] });
    r.onend?.();
    expect(got).toEqual([{ text: 'où en est le BTC' }]);
    stop();
    expect(r.stopped).toBe(true);
  });
  it('erreurs lisibles ; silence ; navigateur sans dictée', () => {
    const got: unknown[] = [];
    dictate(FakeRec, (r) => got.push(r));
    FakeRec.last.onerror?.({ error: 'not-allowed' });
    dictate(FakeRec, (r) => got.push(r));
    FakeRec.last.onend?.();
    expect(dictate(null, (r) => got.push(r))).toBeNull();
    expect(got).toEqual([{ error: 'micro refusé par le navigateur' }, { error: 'aucune parole entendue' },
      { error: 'dictée indisponible dans ce navigateur : utiliser le champ texte' }]);
  });
});
