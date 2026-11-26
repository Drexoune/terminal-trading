// Paquet du service terminal-analysis pour la machine Oracle (P7, T-075) : server/analysis/main.ts et ses calculs
// (web/src/analysis) en un seul module ES pour Node 22. Produit server/analysis/dist/analysis.mjs (hors
// dépôt), envoyé par deploy/oracle/deployer.sh.
//
//   cd web && node scripts/build-analysis.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const root = fileURLToPath(new URL('../..', import.meta.url));
const OUT = `${root}server/analysis/dist/analysis.mjs`;

const res = await build({
  input: `${root}server/analysis/main.ts`,
  platform: 'node',
  write: false,
  output: { format: 'esm', minify: false, codeSplitting: false },
  logLevel: 'warn',
});
const code = res.output.find((o) => o.type === 'chunk').code;
mkdirSync(`${root}server/analysis/dist`, { recursive: true });
writeFileSync(OUT, `// GÉNÉRÉ par web/scripts/build-analysis.mjs : ne pas modifier à la main.\n${code}`);
console.log(`${OUT.slice(root.length)} : ${(code.length / 1024) | 0} Kio`);
