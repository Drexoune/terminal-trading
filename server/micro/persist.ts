// Sauvegarde de l'état du moteur sur la machine Oracle (T-069) : écriture atomique (fichier
// temporaire puis renommage), relue au démarrage si elle a moins d'une heure (MicroEngine.restore).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function saveJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, file);
}

/** Contenu du fichier, ou null s'il est absent ou illisible (jamais d'exception au démarrage). */
export function loadJson<T>(file: string): T | null {
  try { return JSON.parse(readFileSync(file, 'utf8')) as T; } catch { return null; }
}
