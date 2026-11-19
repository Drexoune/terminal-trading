// Écran Sources du module Bourse (commande BSRC, étape B0) : état de chaque
// relevé planifié, quota Alpha Vantage du jour, EUR/USD de la BCE, et la
// dernière clôture de chaque cotation suivie avec sa source, sa date de valeur
// et son heure de réception. Toute valeur absente : « — » et sa raison.

import { useCallback, useEffect, useState } from 'react';
import { Panel } from '../../components/Panel';
import { Button, Chip, FeedDot, Missing } from '../../components/ui';
import { getSources, logout, type JobReply, type ListingReply, type SourcesReply } from '../../bourse/api';
import { fmtDecimalText, fmtParis, fmtValueDate, isStaleClose } from '../../bourse/format';
import { SubHeader } from '../../shell/SubHeader';
import { BourseGate } from './BourseGate';

const REFRESH_MS = 60_000;

/** Nom affiché d'une source de cours (colonne price_source). */
const PRICE_SOURCE: Record<string, string> = { alphavantage: 'Alpha Vantage', massive: 'Massive', tiingo: 'Tiingo', saisie: 'Saisie manuelle' };

export function SourcesScreen() {
  return (
    <>
      <SubHeader icon="sources" title="Bourse · Sources" chips={<Chip>Étape B0</Chip>} />
      <BourseGate>{(onLogout) => <SourcesBody onLogout={onLogout} />}</BourseGate>
    </>
  );
}

type Load = { state: 'loading' } | { state: 'error'; reason: string } | { state: 'ok'; data: SourcesReply; at: number };

function SourcesBody({ onLogout }: { onLogout: () => void }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  const refresh = useCallback(async () => {
    const r = await getSources();
    if (r.ok) setLoad({ state: 'ok', data: r.data, at: Date.now() });
    else if (r.status === 401) onLogout();
    else setLoad({ state: 'error', reason: r.detail });
  }, [onLogout]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const signOut = async () => { await logout(); onLogout(); };

  return (
    <div className="bourse" data-screen="bourse-sources">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span className="lbl lbl--s" style={{ flex: '1 1 240px' }}>
          {load.state === 'ok' ? `Mis à jour ${fmtParis(load.data.generated_at)} · actualisé chaque minute` : 'Chargement…'}
        </span>
        <Button onClick={() => void refresh()}>Actualiser</Button>
        <Button variant="ghost" onClick={() => void signOut()}>Se déconnecter</Button>
      </div>
      {load.state === 'error' && (
        <Panel title="Sources" controls="none"><div style={{ padding: 14 }}><Missing reason={load.reason} /> <span className="lbl lbl--s">{load.reason}</span></div></Panel>
      )}
      {load.state === 'ok' && <>
        <Overview data={load.data} />
        <Listings listings={load.data.listings} now={load.at} />
        <Jobs jobs={load.data.jobs} />
      </>}
    </div>
  );
}

function Overview({ data }: { data: SourcesReply }) {
  const { fx, quota } = data;
  return (
    <Panel title="Change et quota" controls="none">
      <div className="bkv">
        <div className="bkv__item">
          <span className="lbl lbl--s">EUR/USD · BCE</span>
          {fx ? <>
            <span className="num bkv__value">{fmtDecimalText(fx.per_eur, 4)}</span>
            <span className="lbl lbl--s">Valeur du {fmtValueDate(fx.value_date)} · reçu {fmtParis(fx.received_at)}</span>
          </> : <span className="bkv__value"><Missing reason="aucun cours BCE relevé : la tâche ecb-fx n’a pas encore tourné" /></span>}
        </div>
        <div className="bkv__item">
          <span className="lbl lbl--s">Alpha Vantage · aujourd’hui (UTC)</span>
          <span className="num bkv__value">{quota.used} / {quota.max ?? '—'}</span>
          <span className="lbl lbl--s">{quota.max === null ? 'aucune requête aujourd’hui' : `${Math.max(0, quota.max - quota.used)} requête(s) restante(s)`}</span>
        </div>
      </div>
    </Panel>
  );
}

function Listings({ listings, now }: { listings: ListingReply[]; now: number }) {
  return (
    <Panel title="Cotations suivies" controls="none" chips={<Chip small>{`${listings.length} ligne(s)`}</Chip>}>
      {listings.length === 0
        ? <div className="placeholder"><span className="placeholder__dash" aria-hidden="true">—</span><span>Aucune cotation suivie : les lignes s’ajoutent dans Supabase (docs/plan-b0.md), puis par l’import du portefeuille en B1.</span></div>
        : (
          <div className="btable">
            <table>
              <thead><tr className="lbl lbl--s">
                <th>Ligne</th><th>ISIN</th><th>PEA</th><th className="r">Clôture</th><th>Date de valeur</th><th>Source</th><th>Reçue</th>
              </tr></thead>
              <tbody>
                {listings.map((l) => {
                  const stale = l.last ? isStaleClose(l.last.value_date, now) : true;
                  return (
                    <tr key={l.id}>
                      <td data-label="Ligne"><span className="btable__name">{l.name}</span><span className="lbl lbl--s btable__sub">{l.symbol} · {l.source_symbol}</span></td>
                      <td data-label="ISIN" className="num">{l.isin ?? <Missing reason="ISIN non renseigné" />}</td>
                      <td data-label="PEA">{l.pea_eligible === null ? <Missing reason={l.pea_reason ?? 'éligibilité non établie'} />
                        : <span title={l.pea_reason ?? undefined}>{l.pea_eligible ? 'Oui' : 'Non'}</span>}</td>
                      <td data-label="Clôture" className="r num">
                        {l.last ? `${fmtDecimalText(l.last.close)} ${l.last.currency}` : <Missing reason="aucune clôture relevée" />}
                      </td>
                      <td data-label="Date de valeur" className="num">
                        {l.last ? <>{fmtValueDate(l.last.value_date)}{stale && <> <Chip small variant="pending" title="plus ancienne que le dernier jour ouvré">périmée</Chip></>}</> : '—'}
                      </td>
                      <td data-label="Source">{l.last?.source ?? PRICE_SOURCE[l.price_source] ?? l.price_source}</td>
                      <td data-label="Reçue" className="num">{fmtParis(l.last?.received_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </Panel>
  );
}

function Jobs({ jobs }: { jobs: JobReply[] }) {
  return (
    <Panel title="Relevés planifiés" controls="none">
      <div className="btable">
        <table>
          <thead><tr className="lbl lbl--s">
            <th>Relevé</th><th>Source</th><th>Dernier passage</th><th>Résultat</th><th className="r">Lignes</th><th>Prochain passage</th>
          </tr></thead>
          <tbody>
            {jobs.map((j) => {
              const run = j.last_run;
              return (
                <tr key={j.job}>
                  <td data-label="Relevé"><span className="btable__name">{j.label}</span><span className="lbl lbl--s btable__sub">{j.job}</span></td>
                  <td data-label="Source">{j.source}</td>
                  <td data-label="Dernier passage" className="num">{run ? fmtParis(run.finished_at) : <Missing reason="jamais lancé" />}</td>
                  <td data-label="Résultat">
                    {run ? <>
                      <FeedDot state={run.ok ? 'live' : 'down'}>{run.ok ? 'Réussi' : 'Échec'}</FeedDot>
                      {run.note && <span className="btable__note btable__sub">{run.note}</span>}
                      {run.error && <span className="btable__err btable__sub">{run.error}</span>}
                    </> : '—'}
                  </td>
                  <td data-label="Lignes" className="r num">{run ? run.rows : '—'}</td>
                  <td data-label="Prochain passage" className="num">{fmtParis(j.next_run)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
