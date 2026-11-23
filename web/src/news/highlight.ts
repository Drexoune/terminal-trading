// Mots surlignés du fil d'actus (T-050) : liste par défaut du domaine marchés et investissement,
// modifiable depuis l'écran Actus (enregistrée dans p1_state, clé news:highlight, derrière le
// mot de passe d'application). Découpage pur, testé : mots entiers (pluriel en « s » compris), sans
// tenir compte de la casse, expressions les plus longues d'abord.

import { fetchJson } from '../data/gateway';
import { setValue, useValue } from '../data/store';

export const HIGHLIGHT_KEY = 'news:highlight';

export const DEFAULT_HIGHLIGHTS = [
  // Banques centrales et politique monétaire
  'Fed', 'FOMC', 'Powell', 'ECB', 'Lagarde', 'BoE', 'Bailey', 'BoJ', 'Ueda', 'SNB', 'RBA', 'RBNZ', 'BoC',
  'rate cut', 'rate hike', 'rate hikes', 'rate cuts', 'basis points', 'bps', 'QT', 'balance sheet',
  // Chiffres macro
  'CPI', 'PCE', 'PPI', 'NFP', 'payrolls', 'unemployment', 'inflation', 'GDP', 'recession', 'PMI', 'retail sales',
  // Marchés
  'Treasury', 'Treasuries', 'yields', 'S&P 500', 'Nasdaq', 'Dow', 'VIX', 'dollar', 'DXY', 'gold', 'oil', 'OPEC', 'tariff', 'tariffs',
  // Entreprises et dirigeants
  'Nvidia', 'Jensen', 'Huang', 'Apple', 'Microsoft', 'Tesla', 'Musk', 'Amazon', 'Meta', 'Alphabet', 'OpenAI', 'Anthropic', 'earnings',
  // Crypto
  'bitcoin', 'BTC', 'ether', 'ETH', 'crypto', 'ETF', 'stablecoin', 'SEC', 'Coinbase', 'Binance', 'MicroStrategy', 'Saylor',
  // Politique et géopolitique
  'Trump', 'Xi', 'China', 'sanctions',
];

export interface Segment { text: string; hit: boolean }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Expression compilée pour une liste (mémoïsée sur la liste elle-même). */
const cache = new WeakMap<readonly string[], RegExp | null>();
function matcher(words: readonly string[]): RegExp | null {
  if (cache.has(words)) return cache.get(words)!;
  const list = [...new Set(words.map((w) => w.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const rx = list.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(escape).join('|')})s?(?![\\p{L}\\p{N}])`, 'giu') : null;
  cache.set(words, rx);
  return rx;
}

export function segments(text: string, words: readonly string[]): Segment[] {
  const rx = matcher(words);
  if (!rx || !text) return [{ text, hit: false }];
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(rx)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), hit: false });
    out.push({ text: m[0], hit: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}

export interface HighlightState { words: string[]; updated_ms: number }

/** Liste en vigueur : celle enregistrée, sinon la liste par défaut. */
export function useHighlights(): { words: string[]; custom: boolean } {
  const v = useValue<HighlightState>(HIGHLIGHT_KEY);
  return v && Array.isArray(v.words) ? { words: v.words, custom: true } : { words: DEFAULT_HIGHLIGHTS, custom: false };
}

export async function saveHighlights(words: string[]): Promise<HighlightState> {
  const r = await fetchJson<HighlightState>('/api/p1/highlights', { method: 'POST', json: { words }, timeoutMs: 8000 });
  setValue(HIGHLIGHT_KEY, r);
  return r;
}
