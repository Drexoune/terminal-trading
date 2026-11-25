// Récap de session (P6, S4 ; commande RECAP) : une fiche par séance close (Asie, Londres, New York),
// écrite par la machine Oracle (server/recap). Faits calculés par le code, chacun avec sa source,
// son heure et l'écran qui le montre ; lecture de Gemini seulement si elle a passé le contrôle
// (aucun chiffre non sourcé), marquée « à vérifier » ; sinon « lecture automatique » (faits seuls).

import './recap.css';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Panel } from '../../components/Panel';
import { Chip, Missing } from '../../components/ui';
import { fmtHm } from '../../lib/time';
import type { Recap } from '../../recap/recap';
import { SubHeader } from '../../shell/SubHeader';

const PARIS = 'Europe/Paris';
const REFRESH_MS = 5 * 60_000;

interface Reply { configured: boolean; reason?: string; recaps: Recap[]; computed_ms: number }

function useRecaps(): { reply: Reply | null; error: string | null } {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch('/api/p1/recaps', { credentials: 'same-origin' })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<Reply>; })
      .then((d) => { if (live) { setReply(d); setError(null); } })
      .catch((e: unknown) => { if (live) setError((e as Error).message); });
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => { live = false; clearInterval(id); };
  }, []);
  return { reply, error };
}

function RecapCard({ r }: { r: Recap }) {
  const byId = new Map(r.facts.map((f) => [f.id, f]));
  return (
    <Panel title={`${r.label} · ${r.date}`} label={`Récap ${r.label} ${r.date}`} controls="none"
      chips={r.text ? <Chip variant="hot">Lecture Gemini · à vérifier</Chip> : <Chip>Lecture automatique</Chip>}>
      <div className="rc" data-testid="recap-card">
        <p className="lbl lbl--s rc-span">{`${fmtHm(r.from, PARIS)}–${fmtHm(r.to, PARIS)} (Paris) · écrit à ${fmtHm(r.generated_ms, PARIS)}`}</p>
        {r.text ? <>
          <p className="rc-text">{r.text}</p>
          <div className="rc-srcs">{r.sources.map((s) => byId.get(s)).filter(Boolean).map((f) => (
            <Link key={f!.id} className="chip chip--hot chip--s" to={f!.href ?? '/recap'} title={`${f!.label} : ${f!.value} · ${f!.source}`}>{f!.label.length > 36 ? `${f!.label.slice(0, 35)}…` : f!.label}</Link>
          ))}</div>
        </> : <p className="rc-text rc-text--auto">{r.reason ?? 'Faits de la séance seulement.'}</p>}
        <table className="rc-facts">
          <thead><tr><th className="lbl">Fait</th><th className="lbl">Valeur</th><th className="lbl">Source</th></tr></thead>
          <tbody>{r.facts.map((f) => (
            <tr key={f.id}>
              <td>{f.href ? <Link to={f.href}>{f.label}</Link> : f.label}</td>
              <td className="num">{f.value}</td>
              <td className="rc-src">{f.source}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Panel>
  );
}

export function RecapScreen() {
  const { reply, error } = useRecaps();
  const recaps = reply?.recaps ?? [];
  const reason = error ? `récaps injoignables : ${error}` : reply && !reply.configured ? `non configuré : ${reply.reason ?? ''}`
    : reply ? 'aucun récap encore : le premier part 5 min après la clôture de la prochaine séance (machine Oracle)' : 'chargement…';
  return (
    <>
      <SubHeader icon="recap" title="Récap de session · Asie, Londres, New York"
        chips={<Chip variant="hot" round>{recaps[0] ? `Dernier : ${recaps[0].label} ${recaps[0].date}` : 'Dernier : —'}</Chip>} />
      <div className="content rc-list" data-screen="recap">
        {recaps.length ? recaps.slice(0, 9).map((r) => <RecapCard key={r.key} r={r} />)
          : <Panel title="Récap de session" controls="none"><div className="rc-empty"><Missing reason={reason} /><span>{reason}</span></div></Panel>}
      </div>
    </>
  );
}
