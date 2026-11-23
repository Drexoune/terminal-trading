import { describe, expect, it } from 'vitest';
import { configProblem, realtimeConfig, realtimeEndpoint } from './realtime';

describe('Realtime : configuration du front (T-043)', () => {
  it('clé publishable seulement, jamais une clé secrète', () => {
    const url = 'https://vabgpcbvvuhvhdyjreqi.supabase.co';
    expect(configProblem({ url, key: 'sb_publishable_abc' })).toBeNull();
    expect(configProblem({ url, key: 'sb_secret_abc' })).toMatch(/publishable/);
    expect(configProblem({ url, key: 'eyJhbGciOi.x.y' })).toMatch(/publishable/);
    expect(configProblem({ url: undefined, key: 'sb_publishable_abc' })).toMatch(/non configuré/);
    expect(configProblem({ url: 'http://evil.example', key: 'sb_publishable_abc' })).toMatch(/invalide/);
  });

  it('adresse WebSocket du service Realtime ; aucune connexion pendant les tests', () => {
    expect(realtimeEndpoint('https://vabgpcbvvuhvhdyjreqi.supabase.co/')).toBe('wss://vabgpcbvvuhvhdyjreqi.supabase.co/realtime/v1');
    expect(realtimeConfig()).toEqual({ url: undefined, key: undefined });
  });
});
