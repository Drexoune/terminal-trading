// Assistant IA de la section Backtest (S3, T-063) : décrire une stratégie, joindre une capture
// d'écran ou partir d'une stratégie connue ; Gemini (offre gratuite) écrit le Pine, notre moteur le
// compile et le teste, et les erreurs repartent en réparation (3 fois au plus). La lecture des
// résultats ne cite que nos mesures. Derrière le mot de passe d'application (appels comptés).

import { useEffect, useState } from 'react';
import { Panel } from '../../components/Panel';
import { Button, Chip, Missing } from '../../components/ui';
import { AiError, aiExplain, aiStatus, explainFacts, generateAndCompile, readImage, type AiStatus, type GenerateReply, type Step } from '../../backtest/ai';
import type { RunError } from '../../backtest/engine';
import type { Metrics } from '../../backtest/metrics';
import { KNOWN, knownById } from '../../backtest/strategies';

export interface AssistantProps {
  asset: string; tf: string; cur: string; editorCode: string;
  compile: (code: string) => Promise<RunError | null>;
  onAccepted: (code: string) => void;          // code chargé dans l'éditeur et backtest lancé
  metrics: Metrics | null; extra: { is_sharpe?: number | null; oos_sharpe?: number | null; mc_ruin_pct?: number | null };
}

const errText = (e: unknown) => (e instanceof AiError ? e.message : `assistant injoignable : ${(e as Error).message}`);

export function AssistantPanel(p: AssistantProps) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [prompt, setPrompt] = useState('');
  const [base, setBase] = useState('');
  const [image, setImage] = useState<{ mime: string; data: string; name: string } | null>(null);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<GenerateReply | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reading, setReading] = useState<{ text?: string; reason?: string } | null>(null);
  const [reader, setReader] = useState(false);

  const refresh = () => aiStatus().then(setStatus, (e) => setStatus({ configured: false, reason: errText(e) }));
  useEffect(() => { void refresh(); }, []);

  async function pick(f: File | null | undefined) {
    setImgErr(null);
    if (!f) return;
    try { setImage(await readImage(f)); } catch (e) { setImgErr((e as Error).message); setImage(null); }
  }

  async function generate() {
    setBusy(true); setErr(null); setSteps([]); setReply(null);
    const base_code = base === 'editor' ? p.editorCode : base ? knownById(base)?.source : undefined;
    try {
      const r = await generateAndCompile({ prompt, image: image ? { mime: image.mime, data: image.data } : undefined, base_code, context: { asset: p.asset, tf: p.tf } },
        p.compile, (s) => setSteps((l) => [...l, s]));
      setReply(r.reply);
      if (r.code) p.onAccepted(r.code);
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
    void refresh();
  }

  async function explain() {
    if (!p.metrics) return;
    setReader(true); setReading(null);
    try {
      const r = await aiExplain({ facts: explainFacts(p.metrics, p.cur, p.extra), context: { asset: p.asset, tf: p.tf } });
      setReading(r.ok ? { text: r.text } : { reason: r.reason });
    } catch (e) { setReading({ reason: errText(e) }); }
    setReader(false);
    void refresh();
  }

  const quota = status?.configured ? `${status.calls_today ?? 0} / ${status.daily_calls ?? '—'} appels aujourd’hui` : null;
  return (
    <Panel title="Assistant IA" label="Assistant IA" controls="none"
      chips={<Chip title="Offre gratuite de Gemini seulement (T-063) : quota épuisé = « quota gratuit atteint », jamais de bascule payante">
        {status?.model ? `${status.model} · gratuit` : 'Gemini · gratuit'}</Chip>}>
      {status && !status.configured ? <div className="bt-ai-empty"><Missing reason={status.reason ?? 'clé absente'} />{status.reason ?? 'clé Gemini absente des variables de Vercel'}</div> : null}
      <div className="bt-ai">
        <label className="bt-field"><span className="lbl lbl--s">Décrire la stratégie</span>
          <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)}
            onPaste={(e) => { const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); void pick(f); } }}
            placeholder="Ex. : long quand le RSI 2 passe sous 10 au-dessus de la moyenne 200, sortie quand il repasse au-dessus de 70. Une capture peut être collée ici." /></label>
        <div className="bt-ai-row">
          <label className="bt-field"><span className="lbl lbl--s">Partir de</span>
            <select value={base} onChange={(e) => setBase(e.target.value)}>
              <option value="">Rien (nouvelle stratégie)</option>
              <option value="editor">Code de l’éditeur</option>
              {KNOWN.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select></label>
          <label className="bt-field"><span className="lbl lbl--s">Capture d’écran (PNG, JPEG, WebP, 3 Mo)</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void pick(e.target.files?.[0])} /></label>
        </div>
        {image && <p className="bt-note">{`Capture jointe : ${image.name}`} <button type="button" className="bt-link" onClick={() => setImage(null)}>retirer</button></p>}
        {imgErr && <p className="bt-note bt-warn">{imgErr}</p>}
        <div className="bt-run">
          <Button variant="primary" disabled={busy || !status?.configured || (!prompt.trim() && !image && !base)} onClick={() => void generate()}>
            {busy ? 'Génération…' : 'Générer et tester'}</Button>
          {quota && <span className="lbl lbl--s bt-meta">{quota}</span>}
        </div>
        {err && <div className="bt-error" role="alert"><b>Assistant indisponible.</b> {err}</div>}
        {steps.length > 0 && <ol className="bt-steps" aria-label="Étapes de la génération">{steps.map((s, i) => <li key={i} className={`bt-step bt-step--${s.kind}`}>{s.text}</li>)}</ol>}
        {reply?.ok && (
          <div className="bt-ai-reply">
            <b>{reply.title}</b>{reply.cached && <span className="lbl lbl--s"> · réponse en cache</span>}
            <p>{reply.summary}</p>
            {reply.assumptions?.length ? <ul>{reply.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul> : null}
          </div>
        )}
        <div className="bt-ai-explain">
          <Button variant="secondary" disabled={reader || !p.metrics || !status?.configured} onClick={() => void explain()}>
            {reader ? 'Lecture…' : 'Expliquer ces résultats'}</Button>
          {!p.metrics && <span className="lbl lbl--s bt-meta">lancer un backtest d’abord</span>}
          {reading?.text && <p className="bt-ai-reading" data-testid="ai-reading">{reading.text}</p>}
          {reading?.reason && <p className="bt-note bt-warn">{reading.reason}</p>}
        </div>
      </div>
      <div className="lbl lbl--s bt-src" data-fresh>Gemini écrit le code et la lecture ; notre moteur compile, exécute et mesure. Chaque chiffre de la lecture est contrôlé contre nos mesures. Envoyés à Google : la demande, la capture, le code, les mesures ; aucune clé ni donnée de compte.</div>
    </Panel>
  );
}
