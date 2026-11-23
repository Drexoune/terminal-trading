// Fil d'actus — écran Actus (E6/O6, docs/ecrans.md § 3) : fil et lecture en P1, assistant en P6.
// Titres publiés par la tâche « news » de Supabase (Mode Online) ; dans leur langue d'origine,
// marqués « VO » (T-019). Chaque titre montre sa source, l'heure de la source et l'heure de lecture.

import './news.css';
import { useMemo, useState } from 'react';
import { Panel } from '../../components/Panel';
import { Chip, Missing } from '../../components/ui';
import { useSettings } from '../../config/settings';
import { useKeys, useValue } from '../../data/store';
import { fmtHm, fmtHms } from '../../lib/time';
import {
  CATEGORIES, CATEGORY_LABEL, filterNews, fmtDateParis, itemTime, KIND_LABEL, readDelay, sortNews, todayCount,
  type FeedStatus, type NewsCategory, type NewsItem,
} from '../../news/news';
import { SubHeader } from '../../shell/SubHeader';
import { useNow } from '../../shell/useNow';

const PARIS = 'Europe/Paris';
export const OFFLINE_REASON = 'fil d’actus en Mode Online seulement : la tâche tourne dans Supabase (plan « Tout en ligne », O6)';

export function useNews(): NewsItem[] {
  const raw = useKeys<NewsItem>('news:item:');
  return useMemo(() => sortNews(raw.map(([, v]) => v).filter((v) => v && typeof v.title === 'string')), [raw]);
}

function ItemChips({ item }: { item: NewsItem }) {
  return (
    <span className="news-row__chips">
      <Chip small>{CATEGORY_LABEL[item.category] ?? item.category}</Chip>
      {item.urgent && <Chip small variant="hot">Fort impact</Chip>}
    </span>
  );
}

export function NewsScreen() {
  const { mode } = useSettings();
  const now = useNow();
  const items = useNews();
  const feeds = useValue<Record<string, FeedStatus>>('news:feeds');
  const [cat, setCat] = useState<NewsCategory | 'tout'>('tout');
  const [text, setText] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const shown = useMemo(() => filterNews(items, cat, text), [items, cat, text]);
  const open = shown.find((i) => i.id === openId) ?? shown[0] ?? null;
  const blocked = feeds ? Object.entries(feeds).filter(([, f]) => f.status !== 'ok') : [];
  const total = feeds ? Object.keys(feeds).length : 0;
  const unavailable = items.length ? null : mode !== 'online' ? OFFLINE_REASON : !feeds ? 'aucun titre reçu : tâche « news » pas encore passée' : null;

  return (
    <>
      <SubHeader icon="news" title="Fil d’actus · lecture"
        chips={<>
          <Chip variant="hot">{`${todayCount(items, now)} titre${todayCount(items, now) > 1 ? 's' : ''} aujourd’hui`}</Chip>
          <Chip variant={blocked.length ? 'down' : feeds ? 'live' : 'neutral'}
            title={blocked.map(([k, f]) => `${k} : ${f.last_error ?? f.status}`).join('\n') || undefined}>
            {!feeds ? 'Flux · —' : `${total - blocked.length}/${total} flux${blocked.length ? ` · ${blocked.length} en défaut` : ''}`}
          </Chip>
        </>} />
      <div className="content" data-screen="news">
        <div className="news-grid">
          <Panel title="Fil d’actus" controls="none" chips={<Chip variant="live" dot="up">Direct</Chip>}>
            <div className="news-tools">
              <div className="cal-toggles news-cats" role="group" aria-label="Catégories">
                {CATEGORIES.map((c) => (
                  <button key={c.value} type="button" className="cal-toggle" aria-pressed={cat === c.value} onClick={() => setCat(c.value)}>
                    {c.label}
                  </button>
                ))}
              </div>
              <label className="news-search">
                <span className="sr">Filtrer les titres</span>
                <input type="search" placeholder="Filtrer les titres…" value={text} onChange={(e) => setText(e.target.value)} />
              </label>
            </div>
            {unavailable ? <div style={{ padding: 14 }}><Missing reason={unavailable} /></div> : shown.length === 0 ? (
              <div style={{ padding: 14 }}><Missing reason="aucun titre pour ce filtre" /></div>
            ) : (
              <ul className="news-list" aria-label="Titres">
                {shown.slice(0, 300).map((i) => (
                  <li key={i.id}>
                    <button type="button" className={`news-row${i.backfill ? ' news-row--backfill' : ''}`} aria-current={open?.id === i.id}
                      onClick={() => setOpenId(i.id)}>
                      <span className="news-row__time" title={fmtDateParis(itemTime(i))}>{fmtHm(itemTime(i), PARIS)}</span>
                      <span className="news-row__body">
                        <ItemChips item={i} />
                        <span className="news-row__title" lang={i.lang}>{i.title}</span>
                        <span className="lbl lbl--s" title="Titre dans sa langue d’origine (T-019)">{`${KIND_LABEL[i.kind]} · ${i.source} · VO`}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Lecture${open ? ` · ${CATEGORY_LABEL[open.category] ?? ''}` : ''}`} label="Article" controls="none">
            {!open ? <div style={{ padding: 14 }}><Missing reason={unavailable ?? 'aucun titre sélectionné'} /></div> : (
              <article className="news-read" data-testid="news-read">
                <span className="news-row__chips">
                  <Chip variant="hot">{CATEGORY_LABEL[open.category]}</Chip>
                  {open.urgent && <Chip variant="hot">Fort impact</Chip>}
                  {open.backfill && <Chip title="Lu au premier passage ou plus de 2 h après publication : jamais annoncé">Arriéré</Chip>}
                </span>
                <p className="news-read__meta">
                  {`${KIND_LABEL[open.kind]} · ${open.source} · ${fmtDateParis(itemTime(open))} · ${fmtHm(itemTime(open), PARIS)} (Paris)`}
                </p>
                <h2 className="news-read__title" lang={open.lang}>{open.title}</h2>
                {open.figure && (
                  <div className="news-read__figure" aria-label="Chiffre publié">
                    {([['Publié', open.figure.actual], ['Prévision', open.figure.forecast], ['Précédent', open.figure.previous], ['Révisé', open.figure.revised]] as const)
                      .map(([k, v], n) => (
                        <div key={k}>
                          <span className="lbl lbl--s">{k}</span>
                          <span className={`num${n === 0 ? ' is-actual' : ''}`}>{v ?? '—'}</span>
                        </div>
                      ))}
                  </div>
                )}
                {open.summary
                  ? <p className="news-read__summary" lang={open.lang}>{open.summary}</p>
                  : <Missing reason="aucun résumé dans le flux : titre seul" />}
                <dl className="news-read__facts">
                  <dt className="lbl lbl--s">Heure de la source</dt>
                  <dd>{open.published_ms !== null ? `${fmtHms(open.published_ms, PARIS)} Paris · « ${open.published_raw} »` : `— · date illisible (« ${open.published_raw ?? 'absente'} »)`}</dd>
                  <dt className="lbl lbl--s">Lu par Supabase</dt>
                  <dd>{`${fmtHms(open.received_ms, PARIS)} Paris${readDelay(open) ? ` · ${readDelay(open)}` : ''}`}</dd>
                  <dt className="lbl lbl--s">Classement</dt>
                  <dd>{`${open.rule ?? 'aucune règle'} · règles ${open.rules_version}`}</dd>
                  <dt className="lbl lbl--s">Langue</dt>
                  <dd>VO (anglais) · pas de traduction en P1 (T-019)</dd>
                </dl>
                {open.url && <a className="news-read__link" href={open.url} target="_blank" rel="noopener noreferrer">Lire à la source ↗</a>}
              </article>
            )}
          </Panel>

          <Panel title="Assistant" controls="none" chips={<Chip variant="pending">P6</Chip>}>
            <div className="placeholder" style={{ minHeight: 300 }}>
              <span className="placeholder__dash" aria-hidden="true">—</span>
              <span>Questions sur l’article, réponses citées depuis nos seules données.</span>
              <span className="lbl lbl--s">Disponible en P6</span>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
