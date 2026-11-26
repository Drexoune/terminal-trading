// Recherche bancaire (P7 ; commande RES ; T-075) : flux RSS public d'ING THINK, en lecture seule pour
// Clément (usage personnel). Titre, thème, date, résumé fourni par ING et lien vers l'article ; le
// texte des articles n'est jamais repris.

import './analysis.css';
import { useAnalysis } from '../../analysis/client';
import { Panel } from '../../components/Panel';
import { Chip } from '../../components/ui';
import { SubHeader } from '../../shell/SubHeader';
import { Empty, fmtDayHm, FreshChip } from './parts';

export interface ResearchItem { id: string; title: string; link: string; summary: string | null; topic: string | null; published_ms: number | null; seen_ms: number }
interface Research { source: string; url: string; items: ResearchItem[]; fetched_ms: number; ok: boolean; error: string | null }

export function ResearchScreen() {
  const s = useAnalysis<Research>('research');
  const v = s.value;
  return (
    <>
      <SubHeader icon="bank" title="Recherche bancaire · ING THINK" chips={<Chip variant="hot" round>Lecture seule · usage personnel</Chip>} />
      <div className="content an" data-screen="research">
        <Panel title="Dernières publications" controls="none"
          chips={<>{v && !v.ok && <Chip small variant="down" title={v.error ?? ''}>Flux en erreur</Chip>}<FreshChip s={s} source="ING THINK, flux RSS public" /></>}>
          {!v ? <Empty reason={s.reason ?? '—'} /> : !v.items.length ? <Empty reason={v.error ?? 'flux vide'} /> : (
            <ul className="an-research" data-testid="research-list">{v.items.map((i) => (
              <li key={i.id}>
                <div className="an-research__meta lbl lbl--s">
                  <span className="num">{i.published_ms ? fmtDayHm(i.published_ms) : `vu ${fmtDayHm(i.seen_ms)}`}</span>
                  {i.topic && <Chip small>{i.topic}</Chip>}
                </div>
                <a className="an-research__title" href={i.link} target="_blank" rel="noopener noreferrer">{i.title}</a>
                {i.summary && <p className="an-research__sum">{i.summary}</p>}
              </li>
            ))}</ul>
          )}
        </Panel>
        <p className="an-foot lbl lbl--s">Source : ING THINK (think.ing.com), résumés d’ING. Les articles s’ouvrent chez ING ; rien n’est republié (T-075).</p>
      </div>
    </>
  );
}
