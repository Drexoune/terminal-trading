// Import des opérations (étape B1.4) : lignes d'un fichier au format d'import
// Baggr (feuille « Opérations » des exports XTB de Clément, règles de la
// feuille « Aide »), lues par le navigateur puis validées ICI, côté serveur.
//
//   parseRows    texte et nombres bruts → opérations typées, erreurs par ligne
//   resolveRows  rattache chaque titre à une cotation du référentiel et
//                contrôle la cohérence ISIN / mnémonique
//
// Le fichier est vérifié en entier : la moindre erreur est signalée avec sa
// ligne, et rien n'est importé. Réimporter le même fichier n'ajoute rien
// (clé de dédoublonnage : la Référence du courtier, sinon le contenu).

import { dec, toText } from './decimal.js';
import { normalizeIsin } from './isin.js';
import type { Kind } from './portfolio.js';

export type RawCell = string | number | boolean | null | undefined;
export type RawRow = Record<string, RawCell>;

/** Type du fichier → type interne. */
const TYPES: Record<string, Kind> = {
  achat: 'achat', vente: 'vente', dividende: 'dividende', 'remboursement de capital': 'remboursement_capital',
  'actions gratuites': 'actions_gratuites', 'split/regroupement': 'split', split: 'split', regroupement: 'split',
  'transfert de titre (entrant)': 'transfert_entrant', 'transfert de titre (sortant)': 'transfert_sortant',
  depot: 'depot', retrait: 'retrait', change: 'change', interets: 'interets', frais: 'frais',
  'remboursement de frais': 'remboursement_frais', taxes: 'taxes',
};

/** En-têtes reconnus (sans accents, minuscules) → champ. */
const HEADERS: Record<string, keyof Fields> = {
  date: 'date', type: 'type', isin: 'isin', ticker: 'ticker', place: 'place', nom: 'name', quantite: 'quantity',
  'prix unitaire': 'price', montant: 'amount', frais: 'fees', taxes: 'taxes', devise: 'currency',
  'taux de change': 'fx_rate', 'devise cible': 'target_currency', ratio: 'ratio', reference: 'reference',
};

interface Fields {
  date: RawCell; type: RawCell; isin: RawCell; ticker: RawCell; place: RawCell; name: RawCell; quantity: RawCell;
  price: RawCell; amount: RawCell; fees: RawCell; taxes: RawCell; currency: RawCell; fx_rate: RawCell;
  target_currency: RawCell; ratio: RawCell; reference: RawCell;
}

/** Places reconnues par leur nom → code MIC. */
const PLACES: Record<string, string> = {
  'euronext paris': 'XPAR', paris: 'XPAR', xetra: 'XETR', 'deutsche borse xetra': 'XETR', nasdaq: 'XNAS', nyse: 'XNYS',
  'euronext amsterdam': 'XAMS', 'euronext bruxelles': 'XBRU', 'euronext brussels': 'XBRU', 'borsa italiana': 'XMIL', milan: 'XMIL',
  'bolsa de madrid': 'XMAD', 'london stock exchange': 'XLON', 'six swiss exchange': 'XSWX',
};

/** Types dont le montant peut être négatif (feuille « Aide »). */
const SIGNED_AMOUNT: ReadonlySet<Kind> = new Set(['interets', 'taxes']);
const TITLE_KINDS: ReadonlySet<Kind> = new Set(['achat', 'vente', 'dividende', 'remboursement_capital', 'actions_gratuites',
  'split', 'transfert_entrant', 'transfert_sortant']);

export const MAX_IMPORT_ROWS = 5000;

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const text = (v: RawCell): string => (v === null || v === undefined ? '' : String(v).trim());

export interface ParsedRow {
  line: number;                 // ligne du fichier (en-têtes = ligne 1)
  trade_date: string;
  kind: Kind;
  isin: string | null;
  ticker: string | null;
  mic: string | null;
  name: string | null;
  quantity: string | null;
  price: string | null;
  amount: string | null;
  fees: string;
  taxes: string;
  currency: string | null;      // null : devise de l'enveloppe
  fx_rate: string | null;
  target_currency: string | null;
  ratio_new: string | null;
  ratio_old: string | null;
  reference: string | null;
}

export interface LineIssue { line: number; message: string }

/** Nombre du fichier : nombre, ou texte à virgule ou point décimal, sans séparateur de milliers. */
export function readNumber(v: RawCell): string | null | 'invalide' {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'invalide';
    const d = dec(v);
    return d === null ? 'invalide' : toText(d, 10).replace(/\.?0+$/, '');
  }
  const s = text(v).replace(/ | /g, '');
  if (!s) return null;
  if (!/^-?\d+([.,]\d+)?$/.test(s)) return 'invalide';
  return s.replace(',', '.');
}

/** Date du fichier : numéro de série Excel, « JJ/MM/AAAA », « AAAA-MM-JJ » (heure éventuelle ignorée). */
export function readDate(v: RawCell): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    // Système 1900 d'Excel : jour 25569 = 01/01/1970 (le faux 29/02/1900 est avant).
    return new Date(Math.round((Math.floor(v) - 25569) * 86_400_000)).toISOString().slice(0, 10);
  }
  const s = text(v);
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : (m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+Z?)?$/.exec(s)) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  if (!iso) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === iso ? iso : null;
}

/** Lignes brutes (en-têtes du fichier comme clés) → opérations typées et erreurs. */
export function parseRows(raw: readonly RawRow[], today: string): { rows: ParsedRow[]; errors: LineIssue[] } {
  const rows: ParsedRow[] = [];
  const errors: LineIssue[] = [];
  // Les tableurs gardent souvent des lignes vides formatées en fin de feuille.
  let n = raw.length;
  while (n > 0 && Object.values(raw[n - 1]).every((v) => !text(v))) n--;
  raw = raw.slice(0, n);
  if (raw.length > MAX_IMPORT_ROWS) return { rows, errors: [{ line: 0, message: `fichier trop long : ${raw.length} lignes (${MAX_IMPORT_ROWS} au plus)` }] };
  raw.forEach((r, k) => {
    const line = k + 2;
    const f = {} as Fields;
    const unknown: string[] = [];
    for (const [h, v] of Object.entries(r)) {
      const key = HEADERS[fold(h)];
      if (key) f[key] = v; else if (text(v)) unknown.push(h);
    }
    const err = (message: string) => errors.push({ line, message });
    if (Object.values(f).every((v) => !text(v))) return;   // ligne vide
    if (unknown.length) err(`colonne(s) inconnue(s) : ${unknown.join(', ')}`);

    const date = readDate(f.date);
    if (!date) { err(`date illisible : « ${text(f.date)} » (JJ/MM/AAAA ou AAAA-MM-JJ)`); return; }
    if (date > today) { err(`date dans le futur : ${date}`); return; }
    const kind = TYPES[fold(text(f.type))];
    if (!kind) { err(`type inconnu : « ${text(f.type)} »`); return; }

    const num = (label: string, v: RawCell, signed = false): string | null => {
      const n = readNumber(v);
      if (n === 'invalide') { err(`${label} illisible : « ${text(v)} »`); return null; }
      if (n !== null && !signed && n.startsWith('-')) { err(`${label} négatif : le type donne le sens, les nombres sont positifs`); return null; }
      return n;
    };
    const quantity = num('Quantité', f.quantity);
    const price = num('Prix unitaire', f.price);
    const amount = num('Montant', f.amount, SIGNED_AMOUNT.has(kind));
    const fees = num('Frais', f.fees) ?? '0';
    const taxes = num('Taxes', f.taxes) ?? '0';
    const fx = num('Taux de change', f.fx_rate);

    const isin = text(f.isin).toUpperCase() || null;
    const ticker = text(f.ticker).toUpperCase() || null;
    const placeText = text(f.place);
    const mic = !placeText ? null : /^[A-Z]{4}$/.test(placeText.toUpperCase()) ? placeText.toUpperCase() : PLACES[fold(placeText)] ?? null;
    if (placeText && !mic) err(`place inconnue : « ${placeText} » (code MIC attendu, ex. XPAR)`);
    if (isin && !normalizeIsin(isin)) err(`ISIN invalide : ${isin} (clé de contrôle)`);
    const currency = text(f.currency).toUpperCase() || null;
    if (currency && !/^[A-Z]{3}$/.test(currency)) err(`devise invalide : « ${currency} »`);
    const target = text(f.target_currency).toUpperCase() || null;

    let ratio_new: string | null = null;
    let ratio_old: string | null = null;
    if (kind === 'split') {
      const m = /^(\d+(?:[.,]\d+)?)\s*:\s*(\d+(?:[.,]\d+)?)$/.exec(text(f.ratio));
      if (!m) err(`Ratio attendu pour un split, sous la forme « 10:1 »`);
      else { ratio_new = m[1].replace(',', '.'); ratio_old = m[2].replace(',', '.'); }
    }

    const positive = (v: string | null) => v !== null && Number(v) > 0;
    if (TITLE_KINDS.has(kind) && !isin && !ticker) err('titre attendu : ISIN, ou Ticker avec Place');
    if (TITLE_KINDS.has(kind) && !isin && ticker && !mic) err('Place attendue avec le Ticker');
    switch (kind) {
      case 'achat': case 'vente':
        if (!positive(quantity)) err('Quantité attendue');
        if (!positive(price) && !positive(amount)) err('Prix unitaire ou Montant attendu');
        break;
      case 'dividende': case 'remboursement_capital':
        if (!positive(amount)) err('Montant attendu');
        break;
      case 'actions_gratuites':
        if (!positive(quantity)) err('Quantité attendue');
        break;
      case 'split':
        break;   // Ratio contrôlé plus haut
      case 'transfert_entrant': case 'transfert_sortant':
        if (!positive(quantity) || !positive(price)) err('Quantité et Prix unitaire (valeur de transfert) attendus');
        break;
      case 'change':
        if (!positive(amount) || !target || !positive(fx)) err('Montant, Devise cible et Taux de change attendus');
        break;
      case 'interets': case 'taxes':
        if (amount === null || Number(amount) === 0) err('Montant attendu');
        break;
      default:
        if (!positive(amount)) err('Montant attendu');
    }

    rows.push({
      line, trade_date: date, kind, isin, ticker, mic, name: text(f.name) || null, quantity, price, amount, fees, taxes,
      currency, fx_rate: fx, target_currency: target, ratio_new, ratio_old, reference: text(f.reference) || null,
    });
  });
  return { rows, errors };
}

// --- rattachement au référentiel -----------------------------------------------------

export interface RefListing { id: number; symbol: string; mic: string | null; currency: string; isin: string | null; name: string; tracked: boolean }

export interface ResolvedRow extends ParsedRow {
  listing_id: number | null;
  listing_label: string | null;
  currency: string;             // devise du compte espèces, résolue
  dedup_key: string;
}

/**
 * Rattache chaque titre à une cotation : d'abord par Ticker et Place, puis par
 * ISIN. Un ISIN qui contredit le référentiel est signalé (avertissement) et la
 * ligne est rattachée à la cotation du Ticker : un export saisi à la main peut
 * porter l'ISIN d'un autre fonds de la même gamme.
 */
export function resolveRows(rows: readonly ParsedRow[], listings: readonly RefListing[], envelopeCurrency: string):
  { rows: ResolvedRow[]; errors: LineIssue[]; warnings: LineIssue[] } {
  const errors: LineIssue[] = [];
  const warnings: LineIssue[] = [];
  const out: ResolvedRow[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    let listing: RefListing | null = null;
    if (TITLE_KINDS.has(r.kind)) {
      if (r.ticker && r.mic) listing = listings.find((l) => l.symbol === r.ticker && l.mic === r.mic) ?? null;
      if (listing && r.isin && listing.isin && r.isin !== listing.isin) {
        warnings.push({ line: r.line, message: `ISIN du fichier ${r.isin} ≠ référentiel ${listing.isin} pour ${r.ticker} (${r.mic}) : ligne rattachée à ${listing.name}` });
      }
      if (!listing && r.isin) {
        const byIsin = listings.filter((l) => l.isin === r.isin);
        listing = byIsin.find((l) => l.mic === r.mic) ?? byIsin.find((l) => l.tracked) ?? byIsin[0] ?? null;
        if (listing && r.ticker && listing.symbol !== r.ticker) {
          warnings.push({ line: r.line, message: `${r.ticker} (${r.mic ?? '?'}) absent du référentiel : ligne rattachée par l'ISIN à ${listing.symbol} (${listing.mic ?? '?'})` });
        }
      }
      if (!listing) {
        errors.push({ line: r.line, message: `titre inconnu du référentiel : ${[r.isin, r.ticker, r.mic].filter(Boolean).join(' · ')} — ajouter d'abord sa cotation` });
        continue;
      }
    }
    const currency = r.currency ?? envelopeCurrency;
    if (listing && (r.kind === 'achat' || r.kind === 'vente' || r.kind.startsWith('transfert'))
        && listing.currency !== currency && r.amount === null && r.fx_rate === null) {
      errors.push({ line: r.line, message: `titre en ${listing.currency}, compte en ${currency} : Montant ou Taux de change attendu` });
    }
    const base = r.reference ? `ref:${r.reference}`
      : `h:${[r.trade_date, r.kind, listing?.id ?? '', r.quantity, r.price, r.amount, r.fees, r.taxes, currency].join('|')}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({
      ...r, currency, listing_id: listing?.id ?? null, listing_label: listing ? `${listing.name} · ${listing.symbol}` : null,
      dedup_key: (n > 1 ? `${base}#${n}` : base).slice(0, 200),
    });
  }
  return { rows: out, errors, warnings };
}

/** Ligne prête pour la fonction SQL bourse_import (colonnes de public.transactions). */
export function toDbRow(r: ResolvedRow): Record<string, string | number | null> {
  return {
    trade_date: r.trade_date, kind: r.kind, listing_id: r.listing_id, quantity: r.quantity, price: r.price, amount: r.amount,
    fees: r.fees, taxes: r.taxes, currency: r.currency, fx_rate: r.fx_rate, target_currency: r.target_currency,
    ratio_new: r.ratio_new, ratio_old: r.ratio_old, reference: r.reference, dedup_key: r.dedup_key, note: null,
  };
}
