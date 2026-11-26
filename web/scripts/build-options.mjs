// Paquet du service terminal-options pour la machine Oracle (P7, T-075) : server/options/main.ts et ses calculs
// (web/src/analysis) en un seul module ES pour Node 22. Produit server/options/dist/options.mjs (hors
// dépôt), envoyé par deploy/oracle/deployer.sh.
//
//   cd web && node scripts/build-options.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const root = fileURLToPath(new URL('../..', import.meta.url));
const OUT = `${root}server/options/dist/options.mjs`;

const res = await build({
  input: `${root}server/options/main.ts`,
  platform: 'node',
  write: false,
  output: { format: 'esm', minify: false, codeSplitting: false },
  logLevel: 'warn',
});
const code = res.output.find((o) => o.type === 'chunk').code;
mkdirSync(`${root}server/options/dist`, { recursive: true });
writeFileSync(OUT, `// GÉNÉRÉ par web/scripts/build-options.mjs : ne pas modifier à la main.\n${code}`);
console.log(`${OUT.slice(root.length)} : ${(code.length / 1024) | 0} Kio`);
