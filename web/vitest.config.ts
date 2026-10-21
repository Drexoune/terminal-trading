import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// Les tests couvrent le front (web/src), les fonctions Vercel (api/) et la
// logique du collecteur Supabase (supabase/functions/), d'où la racine du dépôt.
export default mergeConfig(viteConfig, defineConfig({
  test: {
    dir: '..',
    include: [
      'web/src/**/*.test.{ts,tsx}',
      'api/**/*.test.ts',
      'supabase/functions/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**'],
    environment: 'jsdom',
  },
}));
