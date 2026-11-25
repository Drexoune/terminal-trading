// Paquet du service des récaps de séance pour la machine Oracle (P6, T-074) : server/recap/main.ts,
// le registre et les faits (web/src/recap) et le contrôleur de l'assistant en un seul module ES pour
// Node 22. Produit server/recap/dist/recap.mjs (hors dépôt), envoyé par deploy/oracle/deployer.sh.
//
//   cd web && node scripts/build-recap.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const root = fileURLToPath(new URL('../..', import.meta.url));
const OUT = `${root}server/recap/dist/recap.mjs`;

const res = await build({
  input: `${root}server/recap/main.ts`,
  platform: 'node',
  write: false,
  output: { format: 'esm', minify: false, codeSplitting: false },
  logLevel: 'warn',
});
const code = res.output.find((o) => o.type === 'chunk').code;
mkdirSync(`${root}server/recap/dist`, { recursive: true });
writeFileSync(OUT, `// GÉNÉRÉ par web/scripts/build-recap.mjs : ne pas modifier à la main.\n${code}`);
console.log(`${OUT.slice(root.length)} : ${(code.length / 1024) | 0} Kio`);
