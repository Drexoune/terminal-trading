// Paquet de la recherche autonome pour bt-jobs (Supabase, Deno) : web/src/backtest/research-core.ts
// avec le moteur (PineTS, build navigateur), les mesures, les diagnostics et Gemini, en un seul
// module ES. Deno ne résout ni les imports sans extension du front ni le paquet npm sans carte
// d'import : un fichier unique, généré, évite les deux. En tête, l'empreinte des sources : le test
// supabase/functions/bt-jobs/research-core.test.ts refuse un paquet périmé.
//
//   cd web && node scripts/build-research-core.mjs

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const root = fileURLToPath(new URL('../..', import.meta.url));
export const SOURCES = [
  'web/src/backtest/research-core.ts', 'web/src/backtest/research.ts', 'web/src/backtest/engine.ts', 'web/src/backtest/metrics.ts',
  'web/src/backtest/diagnostics.ts', 'web/src/lib/time.ts', 'api/_lib/gemini-pine.ts', 'web/node_modules/pinets/package.json',
];
export function sourcesHash() {
  const h = createHash('sha256');
  for (const f of SOURCES) h.update(f).update('\0').update(readFileSync(root + f)).update('\0');
  return h.digest('hex').slice(0, 16);
}

const OUT = `${root}supabase/functions/bt-jobs/research-core.gen.js`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = await build({
    input: `${root}web/src/backtest/research-core.ts`,
    platform: 'browser',
    write: false,
    output: { format: 'esm', minify: false, codeSplitting: false },
    logLevel: 'warn',
  });
  const code = res.output.find((o) => o.type === 'chunk').code;
  const head = `// GÉNÉRÉ par web/scripts/build-research-core.mjs : ne pas modifier à la main.\n// sources: ${sourcesHash()}\n// PineTS (AGPL-3.0, LuxAlgo) inclus pour un usage strictement personnel (T-062).\n// deno-lint-ignore-file\n// @ts-nocheck\n`;
  writeFileSync(OUT, head + code);
  console.log(`${OUT.slice(root.length)} : ${(head.length + code.length) / 1024 | 0} Kio, sources ${sourcesHash()}`);
}
