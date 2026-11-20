// Lecteur .xlsx minimal (étape B1.4), sans dépendance : un .xlsx est une
// archive zip de fichiers XML. Décompression par DecompressionStream
// (« deflate-raw », natif des navigateurs et de Node 22), XML par DOMParser.
//
// Il rend les lignes d'une feuille sous forme d'objets { en-tête: valeur } :
// texte, nombre ou booléen, sans interprétation. Les dates restent des numéros
// de série Excel : la validation (importer.ts, côté serveur) les convertit.

export type Cell = string | number | boolean | null;
export type SheetRow = Record<string, Cell>;

interface ZipEntry { name: string; method: number; compressedSize: number; offset: number }

function u16(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8); }
function u32(b: Uint8Array, o: number) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

/** Entrées du répertoire central d'une archive zip. */
function zipEntries(b: Uint8Array): ZipEntry[] {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('fichier illisible : ce n’est pas un classeur .xlsx');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('fichier illisible : répertoire du classeur abîmé');
    const nameLen = u16(b, p + 28);
    out.push({
      method: u16(b, p + 10), compressedSize: u32(b, p + 20), offset: u32(b, p + 42),
      name: dec.decode(b.subarray(p + 46, p + 46 + nameLen)),
    });
    p += 46 + nameLen + u16(b, p + 30) + u16(b, p + 32);
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data); c.close(); } });
  const stream = source.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(b: Uint8Array, e: ZipEntry): Promise<string> {
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28);
  const raw = b.subarray(start, start + e.compressedSize);
  const data = e.method === 0 ? raw : e.method === 8 ? await inflate(raw) : null;
  if (!data) throw new Error(`fichier illisible : compression ${e.method} non prise en charge`);
  return new TextDecoder().decode(data);
}

const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
const byTag = (d: Document | Element, tag: string) => Array.from(d.getElementsByTagNameNS('*', tag));

/** « AB12 » → index de colonne 27 (base 0). */
function columnIndex(ref: string): number {
  let n = 0;
  for (const c of ref.replace(/\d+$/, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Feuilles du classeur, dans l'ordre. */
export async function sheetNames(file: ArrayBuffer): Promise<string[]> {
  const b = new Uint8Array(file);
  const entries = zipEntries(b);
  const wb = entries.find((e) => e.name === 'xl/workbook.xml');
  if (!wb) throw new Error('fichier illisible : classeur sans xl/workbook.xml');
  return byTag(xml(await readEntry(b, wb)), 'sheet').map((s) => s.getAttribute('name') ?? '');
}

/**
 * Lignes d'une feuille (par son nom, sinon la première) : la ligne 1 porte les
 * en-têtes ; les lignes entièrement vides sont ignorées.
 */
export async function readSheet(file: ArrayBuffer, preferred?: string): Promise<{ sheet: string; rows: SheetRow[] }> {
  const b = new Uint8Array(file);
  const entries = zipEntries(b);
  const find = (name: string) => entries.find((e) => e.name === name);
  const wbEntry = find('xl/workbook.xml');
  const relsEntry = find('xl/_rels/workbook.xml.rels');
  if (!wbEntry || !relsEntry) throw new Error('fichier illisible : classeur incomplet');
  const sheets = byTag(xml(await readEntry(b, wbEntry)), 'sheet');
  const chosen = sheets.find((s) => s.getAttribute('name') === preferred) ?? sheets[0];
  if (!chosen) throw new Error('classeur sans feuille');
  const rid = chosen.getAttribute('r:id') ?? chosen.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const rel = byTag(xml(await readEntry(b, relsEntry)), 'Relationship').find((r) => r.getAttribute('Id') === rid);
  const target = rel?.getAttribute('Target') ?? '';
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const sheetEntry = find(path);
  if (!sheetEntry) throw new Error(`feuille introuvable : ${path}`);

  const sstEntry = find('xl/sharedStrings.xml');
  const shared = sstEntry ? byTag(xml(await readEntry(b, sstEntry)), 'si').map((si) => byTag(si, 't').map((t) => t.textContent ?? '').join('')) : [];

  const grid: Cell[][] = [];
  for (const row of byTag(xml(await readEntry(b, sheetEntry)), 'row')) {
    const r = Number(row.getAttribute('r')) - 1;
    const cells: Cell[] = [];
    for (const c of byTag(row, 'c')) {
      const col = columnIndex(c.getAttribute('r') ?? 'A');
      const t = c.getAttribute('t');
      const v = byTag(c, 'v')[0]?.textContent ?? null;
      let value: Cell = null;
      if (t === 's') value = v === null ? null : shared[Number(v)] ?? null;
      else if (t === 'inlineStr') value = byTag(c, 't').map((x) => x.textContent ?? '').join('');
      else if (t === 'str' || t === 'e') value = v;
      else if (t === 'b') value = v === '1';
      else value = v === null || v === '' ? null : Number(v);
      cells[col] = value;
    }
    grid[r] = cells;
  }
  const [header = [], ...body] = grid;
  const names = header.map((h) => (h === null || h === undefined ? '' : String(h).trim()));
  const rows: SheetRow[] = [];
  for (const cells of body) {
    if (!cells || cells.every((c) => c === null || c === undefined || c === '')) continue;
    const o: SheetRow = {};
    names.forEach((n, k) => { if (n) o[n] = cells[k] ?? null; });
    rows.push(o);
  }
  return { sheet: chosen.getAttribute('name') ?? '', rows };
}

/** Empreinte SHA-256 du fichier (texte hexadécimal), pour le journal des imports. */
export async function sha256Hex(file: ArrayBuffer): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', file));
  return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('');
}
