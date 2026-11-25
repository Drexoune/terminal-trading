// Paquet du service d'alertes à la seconde pour la machine Oracle (T-071) : server/alerts/main.ts, le
// moteur d'alertes de p1-jobs et les adaptateurs de la microstructure en un seul module ES pour
// Node 22. Produit server/alerts/dist/alerts.mjs (hors dépôt), envoyé par deploy/oracle/deployer.sh.
//
//   cd web && node scripts/build-alerts.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const root = fileURLToPath(new URL('../..', import.meta.url));
const OUT = `${root}server/alerts/dist/alerts.mjs`;

const res = await build({
  input: `${root}server/alerts/main.ts`,
  platform: 'node',
  write: false,
  output: { format: 'esm', minify: false, codeSplitting: false },
  logLevel: 'warn',
});
const code = res.output.find((o) => o.type === 'chunk').code;
mkdirSync(`${root}server/alerts/dist`, { recursive: true });
writeFileSync(OUT, `// GÉNÉRÉ par web/scripts/build-alerts.mjs : ne pas modifier à la main.\n${code}`);
console.log(`${OUT.slice(root.length)} : ${(code.length / 1024) | 0} Kio`);
