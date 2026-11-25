// Colonne Assistant de l'écran Actus (P6, S2, maquette Actus) : questions sur l'article ouvert et
// sur ce que le terminal affiche. Les faits (web/src/assistant/facts.ts) sont pris au moment de
// la question ; la réponse vient de Gemini, contrôlée côté serveur puis ici (aucun chiffre non
// sourcé) ; chaque source est une puce qui mène à l'écran qui montre la donnée. « À vérifier ».
// Traduction de l'article à la demande (T-074), jamais automatique.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Panel } from '../../components/Panel';
import { ask, AssistantError, translate } from '../../assistant/client';
import { collectFacts, type Fact } from '../../assistant/facts';
import { setMuted, speak, useMuted } from '../../assistant/voice';
import type { NewsItem } from '../../news/news';
import { setValue, useValue } from '../../data/store';
import { VOICE_KEY } from '../../shell/AssistantMic';

export interface Message { role: 'user' | 'assistant'; text: string; sources?: Fact[]; error?: boolean; note?: string }

const SUGGESTIONS = ['Résume l’article en 3 points', 'Quels chiffres du terminal sont liés à cet article ?', 'Où en est le BTC ?'];

/** Puce d'une source : libellé court, lien vers l'écran (ou l'article). */
function SourceChip({ f }: { f: Fact }) {
  const text = f.label.length > 34 ? `${f.label.slice(0, 33)}…` : f.label;
  const title = `${f.label} : ${f.value} · ${f.source}`;
  return f.href && f.href !== '/actus'
    ? <Link className="chip chip--hot chip--s as-src" to={f.href} title={title}>{text}</Link>
    : <span className="chip chip--hot chip--s as-src" title={title}>{text}</span>;
}

export function AssistantPanel({ article, now }: { article: NewsItem | null; now: number }) {
  const [threads, setThreads] = useState<Record<string, Message[]>>({});
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [translation, setTranslation] = useState<Record<number, { title: string; body: string }>>({});
  const muted = useMuted();
  const key = article ? String(article.id) : 'general';
  const msgs = threads[key] ?? [];
  const push = (m: Message) => setThreads((t) => ({ ...t, [key]: [...(t[key] ?? []), m] }));

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setDraft('');
    push({ role: 'user', text: q });
    setBusy(true);
    const facts = collectFacts(now, article, article ? translation[article.id] ?? null : null);
    try {
      const r = await ask(q, facts);
      if (r.ok && r.answer) {
        const byId = new Map(facts.map((f) => [f.id, f]));
        push({ role: 'assistant', text: r.answer, sources: (r.sources ?? []).map((s) => byId.get(s)).filter((f): f is Fact => !!f), note: r.cached ? 'réponse en cache' : undefined });
        if (!muted) speak(r.answer);
      } else push({ role: 'assistant', text: r.reason ?? 'réponse indisponible', error: true });
    } catch (e) {
      const status = e instanceof AssistantError ? e.status : 0;
      push({ role: 'assistant', error: true, text: status === 401 ? 'Session expirée : se reconnecter (mot de passe d’application).' : (e as Error).message });
    } finally { setBusy(false); }
  }

  // Question dictée depuis le micro de la barre du haut (S3) : envoyée une seule fois.
  const voiceQ = useValue<{ text: string; at: number }>(VOICE_KEY);
  const lastVoice = useRef(0);
  useEffect(() => {
    if (!voiceQ || voiceQ.at === lastVoice.current) return;
    lastVoice.current = voiceQ.at;
    setValue(VOICE_KEY, null);
    void send(voiceQ.text);
  }, [voiceQ]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function doTranslate() {
    if (!article || busy) return;
    push({ role: 'user', text: 'Traduis l’article en français.' });
    setBusy(true);
    try {
      const r = await translate(article.title, article.summary);
      if (r.ok && r.title) {
        setTranslation((t) => ({ ...t, [article.id]: { title: r.title!, body: r.body ?? '' } }));
        push({ role: 'assistant', text: `${r.title}${r.body ? `\n\n${r.body}` : ''}`, note: 'traduction Gemini, titre d’origine conservé (VO)' });
      } else push({ role: 'assistant', error: true, text: r.reason ?? 'traduction indisponible' });
    } catch (e) {
      push({ role: 'assistant', error: true, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <Panel title="Assistant" label="Assistant" controls="none"
      chips={<>
        <span className={`chip ${article ? 'chip--live' : ''}`} data-testid="as-loaded">{article ? 'Article chargé' : 'Aucun article'}</span>
        <button type="button" className="chip as-mute" aria-pressed={muted} onClick={() => setMuted(!muted)}
          title={muted ? 'Lecture vocale coupée' : 'Réponses lues à voix haute'}>{muted ? 'Muet' : 'Voix'}</button>
      </>}>
      <div className="as" data-testid="assistant">
        <div className="as-thread" aria-live="polite">
          {!msgs.length && <p className="as-empty">Pose une question sur l’article ouvert ou sur ce que le terminal affiche. Les réponses ne citent que nos données.</p>}
          {msgs.map((m, i) => m.role === 'user'
            ? <div key={i} className="as-msg as-msg--user"><span className="lbl lbl--s">Toi</span><p>{m.text}</p></div>
            : <div key={i} className={`as-msg as-msg--bot${m.error ? ' as-msg--error' : ''}`} data-testid="as-answer">
                <span className="lbl lbl--s">Assistant</span>
                <p>{m.text}</p>
                {!!m.sources?.length && <div className="as-srcs">{m.sources.map((f) => <SourceChip key={f.id} f={f} />)}</div>}
                {m.note && <span className="as-note">{m.note}</span>}
              </div>)}
          {busy && <div className="as-msg as-msg--bot as-wait"><span className="lbl lbl--s">Assistant</span><p>…</p></div>}
        </div>
        <div className="as-sugg">
          {article && <button type="button" className="as-chip" onClick={() => void doTranslate()} disabled={busy}>Traduire l’article</button>}
          {SUGGESTIONS.map((s) => <button key={s} type="button" className="as-chip" onClick={() => void send(s)} disabled={busy}>{s}</button>)}
        </div>
        <form className="as-input" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
          <label className="sr" htmlFor="as-q">Question</label>
          <textarea id="as-q" rows={2} placeholder={article ? 'Pose une question sur cet article…' : 'Pose une question…'} value={draft} maxLength={600}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(draft); } }} />
          <button type="submit" className="as-send" aria-label="Envoyer" disabled={busy || !draft.trim()}>→</button>
        </form>
        <p className="lbl lbl--s as-foot">Réponses fondées sur l’article et les modules du terminal · à vérifier</p>
      </div>
    </Panel>
  );
}
