import { describe, expect, it, vi } from 'vitest';
import { getValue, onItem, setValue } from './store';

describe('store', () => {
  it('un écouteur en erreur n’empêche ni la mise à jour ni les autres écouteurs', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: unknown[] = [];
    onItem('k', () => { throw new Error('boom'); });
    onItem('k', (v) => seen.push(v));
    setValue('k', 1);
    setValue('k', 2);
    expect(seen).toEqual([1, 2]);
    expect(getValue('k')).toBe(2);
    spy.mockRestore();
  });
});

describe('store : suppressions et clés par préfixe (P1)', () => {
  it('null supprime la clé ; la liste du préfixe est stable entre deux changements', async () => {
    const { keysWithPrefix, subscribePrefix } = await import('./store');
    const seen: number[] = [];
    const off = subscribePrefix('news:item:', () => seen.push(keysWithPrefix('news:item:').length));
    setValue('news:item:2', { t: 2 });
    setValue('news:item:1', { t: 1 });
    setValue('calendar:next', { x: 1 });          // autre préfixe : aucun signal
    const a = keysWithPrefix('news:item:');
    expect(a.map(([k]) => k)).toEqual(['news:item:1', 'news:item:2']);
    expect(keysWithPrefix('news:item:')).toBe(a);  // même référence sans changement (useSyncExternalStore)
    setValue('news:item:1', null);
    expect(getValue('news:item:1')).toBeUndefined();
    expect(keysWithPrefix('news:item:').map(([k]) => k)).toEqual(['news:item:2']);
    setValue('news:item:absent', null);            // suppression d'une clé absente : rien
    expect(seen).toEqual([1, 2, 1]);
    off();
  });
});
