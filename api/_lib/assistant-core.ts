// Cœur de l'assistant (P6, T-074) : consignes, schémas JSON et contrôle des réponses. Module sans
// import, lu par la fonction Vercel (api/_lib/assistant.ts), par le front (web/src/assistant) et
// par le service des récaps sur la machine Oracle.
//
// Règle de la porte de P6 : l'assistant ne reçoit que nos données (des « faits » numérotés, chacun
// avec sa source et son heure), cite ceux qu'il utilise et ne calcule rien. Le contrôleur écarte
// toute réponse dont un nombre ne figure ni dans un fait cité, ni dans la question.

export interface Fact {
  id: string;                 // « F1 », « F2 »…
  label: string;              // « BTC-USDT perp · dernier prix »
  value: string;              // texte affiché, déjà formaté fr-FR (« 108 420,5 $ »)
  source: string;             // « OKX », « BLS », « Polymarket », « article : Reuters »…
  at_ms: number | null;       // heure de la source
  href: string | null;        // écran du terminal qui montre la donnée (« /microstructure »)
}

export type AssistantTask = 'ask' | 'translate' | 'recap';

/** Réponse imposée quand les faits ne suffisent pas. */
export const NO_DATA = 'Je n’ai pas cette donnée dans le terminal.';

export const ASK_SYSTEM = `Tu es l'assistant d'un terminal de trading personnel. Tu réponds en français, en 120 mots au plus.
Règles absolues :
- Tu n'utilises QUE les faits fournis (liste "facts", chacun avec un id, une valeur, une source et une heure). Aucune connaissance extérieure, aucune actualité que tu connaîtrais par ailleurs.
- Chaque nombre de ta réponse est recopié exactement depuis un fait (même écriture), jamais calculé, arrondi autrement, converti ou déduit. Pas de pourcentage, d'écart ou de moyenne que tu calculerais toi-même.
- Tu cites dans "sources" l'id de chaque fait utilisé.
- Si les faits ne permettent pas de répondre, dis exactement : « ${NO_DATA} » et laisse "sources" vide.
- Aucun conseil d'achat ou de vente, aucune prévision de prix.
Réponds en JSON : answer (texte), sources (liste d'ids).`;

export const ASK_SCHEMA = {
  type: 'OBJECT',
  properties: { answer: { type: 'STRING' }, sources: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['answer', 'sources'],
};

export const TRANSLATE_SYSTEM = `Tu traduis en français un titre et, s'il existe, le texte d'une dépêche financière.
Traduction fidèle, phrase par phrase, sans résumer, sans rien ajouter, sans commentaire. Les nombres, devises, sigles et noms propres sont recopiés tels quels.
Réponds en JSON : title (titre traduit), body (texte traduit, ou chaîne vide s'il n'y a pas de texte).`;

export const TRANSLATE_SCHEMA = {
  type: 'OBJECT',
  properties: { title: { type: 'STRING' }, body: { type: 'STRING' } },
  required: ['title', 'body'],
};

export const RECAP_SYSTEM = `Tu écris le récapitulatif d'une séance de marché pour un terminal de trading personnel, en français, en 120 mots au plus.
Mêmes règles absolues : uniquement les faits fournis, chaque nombre recopié exactement depuis un fait, aucun calcul, aucune prévision, aucun conseil.
Commence par le mouvement du BTC, puis les flux (CVD, liquidations, funding), puis les publications et titres marquants, seulement s'ils figurent dans les faits.
Réponds en JSON : answer (texte), sources (liste d'ids des faits utilisés).`;

export const PROMPTS: Record<AssistantTask, { system: string; schema: unknown; temperature: number }> = {
  ask: { system: ASK_SYSTEM, schema: ASK_SCHEMA, temperature: 0.2 },
  translate: { system: TRANSLATE_SYSTEM, schema: TRANSLATE_SCHEMA, temperature: 0.1 },
  recap: { system: RECAP_SYSTEM, schema: ASK_SCHEMA, temperature: 0.3 },
};

/** Plafonds par jour de Paris et par usage (T-074) ; route de bt_ai_calls = nom de la tâche. */
export const DAILY_CAPS: Record<AssistantTask, number> = { ask: 60, translate: 30, recap: 6 };
export const FACTS_MAX = 80;
export const VALUE_MAX = 4000;
export const QUESTION_MAX = 600;

// --- Nombres ----------------------------------------------------------------------------------

export interface Num { value: number; decimals: number; raw: string }

/**
 * Nombres d'un texte, écritures française (« 108 420,5 », « −0,042 % », « 1,5 M$ ») et anglaise
 * (« 108,420.5 », « 0.6% »). Valeur absolue : le signe est porté par le texte, pas contrôlé ici.
 */
export function numbersOf(text: string): Num[] {
  const out: Num[] = [];
  const rx = /\d(?:[\d   ]*\d)?(?:[.,]\d+)*/g;
  for (const m of text.matchAll(rx)) {
    let raw = m[0].replace(/[   ]/g, '');
    // Groupes de milliers séparés par des espaces : « 108 420 » ; on ne fusionne pas deux nombres
    // séparés par une espace simple si le second groupe n'a pas 3 chiffres (« 14 30 »).
    const groups = m[0].split(/[   ]+/);
    if (groups.length > 1 && !groups.slice(1).every((g) => /^\d{3}(?:[.,]\d+)?$/.test(g))) {
      for (const g of groups) out.push(...numbersOf(g));
      continue;
    }
    let decimals = 0;
    if (raw.includes(',') && raw.includes('.')) {
      // Écriture anglaise : virgule des milliers, point décimal.
      raw = raw.replace(/,/g, '');
    } else if (raw.includes(',')) {
      const parts = raw.split(',');
      // « 1,234,567 » : milliers anglais ; sinon virgule décimale française.
      raw = parts.length > 2 && parts.slice(1).every((p) => p.length === 3) ? parts.join('') : parts.join('.');
    } else if ((raw.match(/\./g) ?? []).length > 1) {
      raw = raw.replace(/\./g, '');                          // « 1.234.567 » : milliers
    }
    const i = raw.indexOf('.');
    if (i >= 0) decimals = raw.length - i - 1;
    const value = Number(raw);
    if (Number.isFinite(value)) out.push({ value, decimals, raw: m[0] });
  }
  return out;
}

/** Un nombre de la réponse est-il celui d'un fait, au plus arrondi à sa propre précision ? */
export function sameNumber(answer: Num, fact: Num): boolean {
  if (Math.abs(answer.value - fact.value) < 1e-9) return true;
  if (answer.decimals >= fact.decimals) return false;      // plus précis que la source : inventé
  const half = 0.5 * 10 ** -answer.decimals;
  return Math.abs(answer.value - fact.value) <= half + 1e-9;
}

export interface Verdict { ok: boolean; unsourced: string[]; unknownSources: string[]; reason: string | null }

/**
 * Contrôle d'une réponse : sources connues, et chaque nombre présent dans un fait CITÉ (ou dans la
 * question). Une réponse sans nombre passe si elle cite des faits ou dit qu'elle n'a pas la donnée.
 */
export function verifyAnswer(answer: string, sources: string[], facts: Fact[], question = ''): Verdict {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const unknownSources = sources.filter((s) => !byId.has(s));
  const cited = sources.map((s) => byId.get(s)).filter((f): f is Fact => !!f);
  const allowed = [...cited.flatMap((f) => numbersOf(`${f.label} ${f.value}`)), ...numbersOf(question)];
  const unsourced = numbersOf(answer).filter((n) => !allowed.some((a) => sameNumber(n, a))).map((n) => n.raw.trim());
  const ok = !unknownSources.length && !unsourced.length && (cited.length > 0 || answer.includes(NO_DATA) || !numbersOf(answer).length);
  const reason = unknownSources.length ? `source inconnue (${unknownSources.slice(0, 3).join(', ')})`
    : unsourced.length ? `chiffre non sourcé (${unsourced.slice(0, 3).join(', ')})`
      : !ok ? 'réponse sans source' : null;
  return { ok, unsourced, unknownSources, reason };
}

/** Faits envoyés à Gemini : texte compact, une ligne par fait. */
export function factsText(facts: Fact[]): string {
  return facts.map((f) => `${f.id} | ${f.label} | ${f.value} | source : ${f.source}${f.at_ms ? ` | ${new Date(f.at_ms).toISOString()}` : ''}`).join('\n');
}

/** Faits reçus d'un client : forme et tailles bornées (jamais plus de FACTS_MAX). */
export function cleanFacts(raw: unknown): Fact[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, FACTS_MAX).flatMap((f): Fact[] => {
    if (!f || typeof f !== 'object') return [];
    const o = f as Record<string, unknown>;
    if (typeof o.id !== 'string' || !/^F\d{1,3}$/.test(o.id) || typeof o.value !== 'string') return [];
    return [{ id: o.id, label: String(o.label ?? '').slice(0, 200), value: o.value.slice(0, VALUE_MAX), source: String(o.source ?? '').slice(0, 120),
      at_ms: typeof o.at_ms === 'number' ? o.at_ms : null, href: typeof o.href === 'string' && o.href.startsWith('/') ? o.href.slice(0, 120) : null }];
  });
}
