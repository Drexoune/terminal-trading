// Vérifie qu'aucune clé ni aucun secret n'a fini dans le bundle public du front.
// À lancer après `npm run build` (la CI le fait). Sortie non nulle au moindre doute.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;

const PATTERNS = [
  [/OK-ACCESS-(KEY|SIGN|PASSPHRASE)/i, 'en-tête d’authentification OKX'],
  [/\b(api[_-]?key|secret[_-]?key|passphrase)\b\s*[:=]\s*["'][^"']{8,}["']/i, 'clé ou secret en clair'],
  [/sk-ant-[A-Za-z0-9_-]{10,}/, 'clé API Anthropic'],
  [/AKIA[0-9A-Z]{16}/, 'clé AWS'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clé privée'],
  [/\bghp_[A-Za-z0-9]{30,}/, 'jeton GitHub'],
  [/\b(OKX|ANTHROPIC|CLAUDE)_[A-Z_]*(KEY|SECRET|PASSPHRASE)\b/, 'nom de variable secrète'],
  // Mode Online : les clés Supabase et le secret du collecteur restent côté serveur.
  [/\bsb_secret_[A-Za-z0-9_-]{8,}/, 'clé secrète Supabase'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'jeton JWT (clé service_role ?)'],
  [/\bSUPABASE_[A-Z_]*(KEY|SECRET)\b/, 'nom de variable secrète Supabase'],
  [/\bCOLLECTOR_SECRET\b/, 'nom du secret du collecteur'],
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

let problems = 0;
let scanned = 0;
for (const file of files(DIST)) {
  if (!/\.(js|css|html|json|map|txt)$/.test(file)) continue;
  scanned += 1;
  const text = readFileSync(file, 'utf8');
  for (const [re, label] of PATTERNS) {
    const m = text.match(re);
    if (m) {
      problems += 1;
      console.error(`✘ ${file} : ${label} (« ${m[0].slice(0, 40)} »)`);
    }
  }
}
console.log(`${scanned} fichiers analysés dans dist/, ${problems} problème(s).`);
process.exit(problems ? 1 : 0);
