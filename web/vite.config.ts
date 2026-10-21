import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { apiDev } from './vite-plugins/api-dev.ts';

const design = fileURLToPath(new URL('../design', import.meta.url));
const api = fileURLToPath(new URL('../api', import.meta.url));

export default defineConfig({
  // apiDev : fonctions Vercel du Mode Online (api/) servies par Vite en développement.
  plugins: [react(), apiDev({ apiDir: api })],
  // Les tokens et les polices restent dans design/ (source unique), hors de web/.
  // Le fichier .env est lu à la racine du dépôt, comme pour la passerelle.
  envDir: '..',
  resolve: { alias: { '@design': design } },
  server: { port: 5173, fs: { allow: ['..'] } },
  // Application personnelle sur poste fixe : un bundle unique (~180 ko gzip) reste raisonnable.
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 800 },
  worker: { format: 'es' },
});
