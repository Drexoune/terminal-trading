// Paquet du service de recherche autonome pour la machine Oracle (T-070) : server/bt/main.ts, la
// boucle de bt-jobs et son moteur (research-core.gen.js, PineTS compris) en un seul module ES pour
// Node 22. Produit server/bt/dist/bt-runner.mjs (hors dépôt), envoyé par deploy/oracle/deployer.sh.
//
//   cd web && node scripts/build-bt-runner.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const root = fileURLToPath(new URL('../..', import.meta.url));
const OUT = `${root}server/bt/dist/bt-runner.mjs`;

const res = await build({
  input: `${root}server/bt/main.ts`,
  platform: 'node',
  write: false,
  output: { format: 'esm', minify: false, codeSplitting: false },
  logLevel: 'warn',
});
const code = res.output.find((o) => o.type === 'chunk').code;
mkdirSync(`${root}server/bt/dist`, { recursive: true });
writeFileSync(OUT, `// GÉNÉRÉ par web/scripts/build-bt-runner.mjs : ne pas modifier à la main.\n// PineTS (AGPL-3.0, LuxAlgo) inclus pour un usage strictement personnel (T-062).\n${code}`);
console.log(`${OUT.slice(root.length)} : ${(code.length / 1024) | 0} Kio`);
