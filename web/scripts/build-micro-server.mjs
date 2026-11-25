// Paquet du service de la microstructure pour la machine Oracle (T-069) : server/micro/main.ts et
// le moteur du front (web/src/micro/*) en un seul module ES pour Node 22, sans node_modules sur la
// machine. Produit server/micro/dist/micro-server.mjs (hors dépôt), envoyé par deploy/oracle/deployer.sh.
//
//   cd web && node scripts/build-micro-server.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const root = fileURLToPath(new URL('../..', import.meta.url));
const OUT = `${root}server/micro/dist/micro-server.mjs`;

const res = await build({
  input: `${root}server/micro/main.ts`,
  platform: 'node',
  write: false,
  output: { format: 'esm', minify: false, codeSplitting: false },
  logLevel: 'warn',
});
const code = res.output.find((o) => o.type === 'chunk').code;
mkdirSync(`${root}server/micro/dist`, { recursive: true });
writeFileSync(OUT, `// GÉNÉRÉ par web/scripts/build-micro-server.mjs : ne pas modifier à la main.\n${code}`);
console.log(`${OUT.slice(root.length)} : ${(code.length / 1024) | 0} Kio`);
