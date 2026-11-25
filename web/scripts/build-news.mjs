// Paquet du service Tree of Alpha pour la machine Oracle (T-072) : server/news/main.ts, les règles
// du fil d'actus et le moteur d'alertes de p1-jobs en un seul module ES pour
// Node 22. Produit server/news/dist/news.mjs (hors dépôt), envoyé par deploy/oracle/deployer.sh.
//
//   cd web && node scripts/build-news.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const root = fileURLToPath(new URL('../..', import.meta.url));
const OUT = `${root}server/news/dist/news.mjs`;

const res = await build({
  input: `${root}server/news/main.ts`,
  platform: 'node',
  write: false,
  output: { format: 'esm', minify: false, codeSplitting: false },
  logLevel: 'warn',
});
const code = res.output.find((o) => o.type === 'chunk').code;
mkdirSync(`${root}server/news/dist`, { recursive: true });
writeFileSync(OUT, `// GÉNÉRÉ par web/scripts/build-news.mjs : ne pas modifier à la main.\n${code}`);
console.log(`${OUT.slice(root.length)} : ${(code.length / 1024) | 0} Kio`);
