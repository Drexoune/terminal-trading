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
