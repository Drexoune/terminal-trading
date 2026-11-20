// Écran Portefeuille du module Bourse (commande PTF, étape B1, docs/plan-b1.md § 6) :
// valorisation par enveloppe et totale, lignes, performance (TWR, Dietz, TRI)
// contre les benchmarks, allocation, risques, dividendes, opérations et import.
// Chaque montant porte sa date de valeur ; un calcul impossible : « — » et sa raison.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ColorType, createChart, LineSeries, type IChartApi, type Time } from 'lightweight-charts';
import { Panel } from '../../components/Panel';
import { Button, Chip, Missing, Segmented } from '../../components/ui';
import {
  deleteBatch, getPortfolio, getTransactions, logout, postImport, type BatchReply, type BucketReply, type ImportReply,
  type LineReply, type PortfolioReply, type TransactionReply,
} from '../../bourse/api';
import { fmtDecimalText, fmtParis, fmtValueDate } from '../../bourse/format';
import { readSheet, sha256Hex } from '../../bourse/xlsx';
import { DASH, fmtNumber, fmtPctChange, fmtSigned, NBSP } from '../../lib/format';
import { SubHeader } from '../../shell/SubHeader';
import { BourseGate } from './BourseGate';

const REFRESH_MS = 5 * 60_000;

const KIND_LABEL: Record<string, string> = {
  achat: 'Achat', vente: 'Vente', dividende: 'Dividende', remboursement_capital: 'Remboursement de capital',
  actions_gratuites: 'Actions gratuites', split: 'Split', transfert_entrant: 'Transfert entrant', transfert_sortant: 'Transfert sortant',
  depot: 'Versement', retrait: 'Retrait', change: 'Change', interets: 'Intérêts', frais: 'Frais', remboursement_frais: 'Remboursement de frais', taxes: 'Taxes',
};

const num = (t: string | null | undefined) => (t === null || t === undefined ? null : Number(t));
const eur = (x: number | string | null | undefined, signed = false) => {
  const n = typeof x === 'string' ? Number(x) : x;
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return `${signed ? fmtSigned(n, 2) : fmtNumber(n, 2)}${NBSP}€`;
};
const tone = (x: number | null | undefined) => (x === null || x === undefined || x === 0 ? '' : x > 0 ? 'up' : 'down');

export function PortfolioScreen() {
  return (
    <>
      <SubHeader icon="portfolio" title="Bourse · Portefeuille" chips={<Chip>Étape B1</Chip>} />
      <BourseGate>{(onLogout) => <PortfolioBody onLogout={onLogout} />}</BourseGate>
    </>
  );
}

type Load<T> = { state: 'loading' } | { state: 'error'; reason: string } | { state: 'ok'; data: T };

function PortfolioBody({ onLogout }: { onLogout: () => void }) {
  const [envelope, setEnvelope] = useState<number | null>(null);
  const [load, setLoad] = useState<Load<PortfolioReply>>({ state: 'loading' });
  const [ops, setOps] = useState<{ transactions: TransactionReply[]; batches: BatchReply[] } | null>(null);
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    const [r, t] = await Promise.all([getPortfolio(envelope), getTransactions(envelope)]);
    if (!r.ok && r.status === 401) { onLogout(); return; }
    setLoad(r.ok ? { state: 'ok', data: r.data } : { state: 'error', reason: r.detail });
    setOps(t.ok ? t.data : null);
  }, [envelope, onLogout]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const data = load.state === 'ok' ? load.data : null;
  const envOptions = [{ value: 'all', label: 'Total' }, ...(data?.envelopes ?? []).map((e) => ({ value: String(e.id), label: e.name }))];

  return (
    <div className="bourse" data-screen="bourse-portfolio">
      <div className="ptf-bar">
        {data && data.envelopes.length > 0 && (
          <Segmented label="Enveloppe" options={envOptions} value={envelope === null ? 'all' : String(envelope)}
            onChange={(v) => setEnvelope(v === 'all' ? null : Number(v))} />
        )}
        <span className="lbl lbl--s ptf-bar__note">{data ? `Calculé ${fmtParis(data.generated_at)} · origine ${fmtValueDate(data.perf_start)}` : 'Chargement…'}</span>
        <Button onClick={() => setImporting((x) => !x)}>{importing ? 'Fermer l’import' : 'Importer un fichier'}</Button>
        <Button onClick={() => void refresh()}>Actualiser</Button>
        <Button variant="ghost" onClick={() => void logout().then(onLogout)}>Se déconnecter</Button>
      </div>
      {importing && <ImportPanel onDone={() => { setImporting(false); void refresh(); }} />}
      {load.state === 'error' && <Panel title="Portefeuille" controls="none"><div className="ptf-pad"><Missing reason={load.reason} /> <span className="lbl lbl--s">{load.reason}</span></div></Panel>}
      {data && data.envelopes.length === 0 && (
        <Panel title="Portefeuille" controls="none">
          <div className="placeholder"><span className="placeholder__dash" aria-hidden="true">—</span>
            <span>Aucune enveloppe : importer l’export du courtier (format d’import Baggr, feuille « Opérations »).</span></div>
        </Panel>
      )}
      {data && data.envelopes.length > 0 && <>
        <Summary data={data} />
        <Lines data={data} />
        <Performance data={data} />
        <div className="ptf-grid">
          <Allocation data={data} />
          <div className="ptf-col">
            <Risk data={data} />
            <Dividends data={data} />
          </div>
        </div>
        <Operations ops={ops} onChange={() => void refresh()} />
      </>}
    </div>
  );
}

// --- synthèse ------------------------------------------------------------------------

function Kpi({ label, value, sub, cls }: { label: string; value: React.ReactNode; sub?: React.ReactNode; cls?: string }) {
  return (
    <div className="bkv__item">
      <span className="lbl lbl--s">{label}</span>
      <span className={`num bkv__value ${cls ?? ''}`}>{value}</span>
      {sub && <span className="lbl lbl--s">{sub}</span>}
    </div>
  );
}

function Summary({ data }: { data: PortfolioReply }) {
  const s = data.summary;
  const origin = data.performance.periods.find((p) => p.key === 'ORIGIN');
  return (
    <Panel title="Valorisation" controls="none" chips={<Chip small>{`au ${fmtValueDate(data.as_of)}`}</Chip>}>
      <div className="bkv">
        <Kpi label="Valeur totale" value={s.value === null ? <Missing reason={`valorisation incomplète : ${s.missing.join(', ')}`} /> : eur(s.value)}
          sub={s.value === null ? `partielle : ${eur(s.partial_value)}` : `${data.lines.length} ligne(s) et liquidités`} />
        <Kpi label="Dernière séance" cls={tone(s.day_change)}
          value={s.day_change === null ? <Missing reason="pas deux séances valorisées" /> : eur(s.day_change, true)}
          sub={s.day_change === null ? undefined : `${fmtPctChange(s.day_change_pct)} · ${fmtValueDate(s.day_change_date)}`} />
        <Kpi label="Plus-value latente" cls={tone(num(s.unrealized))} value={s.unrealized === null ? <Missing reason="valorisation incomplète" /> : eur(s.unrealized, true)}
          sub={`investi ${eur(s.invested)}`} />
        <Kpi label="Performance (TWR) depuis l’origine" cls={tone(origin?.twr)}
          value={origin?.twr == null ? <Missing reason={origin?.reason ?? 'non calculable'} /> : fmtPctChange(origin.twr)}
          sub={`TRI de la période ${fmtPctChange(origin?.irr)} · Dietz ${fmtPctChange(origin?.dietz)}`} />
        <Kpi label="Frais et taxes · revenus" value={`${eur(-s.costs, true)} · ${eur(s.income, true)}`} sub={`depuis le ${fmtValueDate(data.perf_start)} · ${s.transactions} opération(s)`} />
      </div>
    </Panel>
  );
}

// --- lignes --------------------------------------------------------------------------

function Lines({ data }: { data: PortfolioReply }) {
  return (
    <Panel title="Lignes" controls="none" chips={<Chip small>{`${data.lines.length} ligne(s)`}</Chip>}>
      <div className="btable">
        <table>
          <thead><tr className="lbl lbl--s">
            <th>Ligne</th><th className="r">Quantité</th><th className="r">PRU</th><th className="r">Cours</th><th>Date · source</th>
            <th className="r">Valeur</th><th className="r">Poids</th><th className="r">+/− latente</th><th>PEA</th>
          </tr></thead>
          <tbody>
            {data.lines.map((l) => <LineRow key={l.listing_id} l={l} />)}
            {data.cash.map((c) => (
              <tr key={c.currency}>
                <td data-label="Ligne"><span className="btable__name">Liquidités</span><span className="lbl lbl--s btable__sub">{c.currency}</span></td>
                <td data-label="Quantité" className="r num">—</td><td data-label="PRU" className="r num">—</td><td data-label="Cours" className="r num">—</td>
                <td data-label="Date · source">—</td>
                <td data-label="Valeur" className="r num">{c.value_eur === null ? <Missing reason={`cours BCE ${c.currency}/EUR absent`} /> : eur(c.value_eur)}</td>
                <td data-label="Poids" className="r num">{c.value_eur && data.allocation.total > 0 ? fmtNumber((Number(c.value_eur) / data.allocation.total) * 100, 1) + NBSP + '%' : DASH}</td>
                <td data-label="+/− latente" className="r num">—</td><td data-label="PEA">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function LineRow({ l }: { l: LineReply }) {
  const unreal = num(l.unrealized);
  return (
    <tr>
      <td data-label="Ligne"><span className="btable__name">{l.name}</span><span className="lbl lbl--s btable__sub">{l.symbol} · {l.isin ?? 'ISIN —'}</span></td>
      <td data-label="Quantité" className="r num">{fmtDecimalText(l.quantity, 0)}</td>
      <td data-label="PRU" className="r num">{l.pru ? `${fmtDecimalText(l.pru, 2)}${NBSP}€` : DASH}</td>
      <td data-label="Cours" className="r num">{l.close ? `${fmtDecimalText(l.close.value, 2)}${NBSP}${l.currency ?? ''}` : <Missing reason={l.missing_reason ?? 'aucune clôture'} />}</td>
      <td data-label="Date · source" className="num">
        {l.close ? <>{fmtValueDate(l.close.date)} · {l.close.source ?? '—'}{l.close.stale && <> <Chip small variant="pending" title="plus ancienne que le dernier jour ouvré">périmée</Chip></>}</> : '—'}
      </td>
      <td data-label="Valeur" className="r num">{l.value === null ? <Missing reason={l.missing_reason ?? 'valeur inconnue'} /> : eur(l.value)}</td>
      <td data-label="Poids" className="r num">{l.weight === null ? DASH : `${fmtNumber(l.weight * 100, 1)}${NBSP}%`}</td>
      <td data-label="+/− latente" className={`r num ${tone(unreal)}`}>{unreal === null ? DASH : <>{eur(unreal, true)}<span className="btable__sub lbl lbl--s">{fmtPctChange(l.unrealized_pct)}</span></>}</td>
      <td data-label="PEA">{l.pea_eligible === null ? <Missing reason={l.pea_reason ?? 'éligibilité non établie'} /> : <span title={l.pea_reason ?? undefined}>{l.pea_eligible ? 'Oui' : 'Non'}</span>}</td>
    </tr>
  );
}

// --- performance ---------------------------------------------------------------------

function token(name: string): string { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function PerfChart({ data }: { data: PortfolioReply }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: token('--text-3'), fontFamily: 'JetBrains Mono, monospace', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: token('--line') } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      localization: { locale: 'fr-FR', priceFormatter: (p: number) => fmtNumber(p, 1) },
      handleScroll: false, handleScale: false,
    });
    chartRef.current = chart;
    const series = [
      { label: 'Portefeuille', color: token('--series-price'), width: 2 as const, points: data.performance.chart.map((p) => ({ date: p.date, index: p.index })) },
      ...data.performance.benchmarks.map((b, k) => ({ label: b.label, color: token(k === 0 ? '--series-vwap' : '--gold-mid'), width: 1 as const, points: b.series })),
    ];
    for (const s of series) {
      const line = chart.addSeries(LineSeries, { color: s.color, lineWidth: s.width, priceLineVisible: false, lastValueVisible: true, title: s.label });
      line.setData(s.points.filter((p) => p.index !== null).map((p) => ({ time: p.date as Time, value: p.index as number })));
    }
    chart.timeScale().fitContent();
    return () => { chart.remove(); chartRef.current = null; };
  }, [data]);
  return <div ref={host} className="ptf-chart" role="img" aria-label="Indice de performance du portefeuille et des benchmarks, base 100 à l’origine" />;
}

function Performance({ data }: { data: PortfolioReply }) {
  const benches = data.performance.benchmarks;
  return (
    <Panel title="Performance" controls="none" chips={<Chip small>{`base 100 au ${fmtValueDate(data.perf_start)}`}</Chip>}>
      <div className="ptf-legend lbl lbl--s">
        <span><i className="ptf-key ptf-key--port" />Portefeuille (TWR)</span>
        {benches.map((b, k) => <span key={b.key}><i className={`ptf-key ptf-key--b${k}`} />{b.label} · {b.symbol ?? '—'}{b.reason && <> <Missing reason={b.reason} /></>}</span>)}
      </div>
      <PerfChart data={data} />
      <div className="btable">
        <table>
          <thead><tr className="lbl lbl--s">
            <th>Période</th><th className="r">TWR</th><th className="r">Dietz modifié</th><th className="r">TRI</th>
            {benches.map((b) => <th key={b.key} className="r">{b.label}</th>)}
          </tr></thead>
          <tbody>
            {data.performance.periods.map((p) => (
              <tr key={p.key}>
                <td data-label="Période"><span className="btable__name">{p.label}</span><span className="lbl lbl--s btable__sub">{fmtValueDate(p.from)} → {fmtValueDate(p.to)}</span></td>
                <td data-label="TWR" className={`r num ${tone(p.twr)}`}>{p.twr === null ? <Missing reason={p.reason ?? 'non calculable'} /> : fmtPctChange(p.twr)}</td>
                <td data-label="Dietz modifié" className={`r num ${tone(p.dietz)}`}>{p.dietz === null ? DASH : fmtPctChange(p.dietz)}</td>
                <td data-label="TRI" className={`r num ${tone(p.irr)}`} title={p.irr_annualized ? 'TRI annualisé' : 'TRI de la période, non annualisé (moins d’un an)'}>
                  {p.irr === null ? DASH : <>{fmtPctChange(p.irr)}<span className="btable__sub lbl lbl--s">{p.irr_annualized ? 'annualisé' : 'sur la période'}</span></>}
                </td>
                {benches.map((b) => { const v = p.benchmarks.find((x) => x.key === b.key)?.twr ?? null; return <td key={b.key} data-label={b.label} className={`r num ${tone(v)}`}>{fmtPctChange(v)}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ptf-note lbl lbl--s">TWR : rendement pondéré par le temps, flux en début de journée. TRI : comme XIRR d’Excel, non annualisé sous un an. Benchmarks : ETF capitalisants, clôtures relevées chaque nuit.</p>
    </Panel>
  );
}

// --- allocation ----------------------------------------------------------------------

function Bars({ title, items }: { title: string; items: BucketReply[] }) {
  return (
    <div className="ptf-bars">
      <span className="lbl lbl--s">{title}</span>
      {items.length === 0 ? <Missing reason="aucune valeur" /> : items.map((b) => (
        <div key={b.label} className="ptf-bars__row">
          <span className="ptf-bars__label" title={b.label}>{b.label}</span>
          <span className="ptf-bars__track"><span className="ptf-bars__fill" style={{ width: `${Math.max(0, Math.min(100, b.pct * 100))}%` }} /></span>
          <span className="num ptf-bars__pct">{fmtNumber(b.pct * 100, 1)}{NBSP}%</span>
        </div>
      ))}
    </div>
  );
}

function Allocation({ data }: { data: PortfolioReply }) {
  const a = data.allocation;
  return (
    <Panel title="Allocation" controls="none">
      <div className="ptf-alloc">
        <Bars title="Par ligne" items={a.lines} />
        <Bars title="Par devise de cotation" items={a.currency} />
        <Bars title="Par pays" items={a.country} />
        <Bars title="Par secteur" items={a.sector} />
      </div>
      <div className="ptf-pad lbl lbl--s">
        {a.sources.length === 0
          ? 'Ventilation des ETF : aucune fiche d’émetteur saisie, part « Non ventilé ».'
          : <>Ventilation des ETF d’après les fiches des émetteurs : {a.sources.map((s, k) => (
            <span key={s.url}>{k > 0 && ' · '}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.instrument}</a> ({s.label}, {fmtValueDate(s.as_of)}{s.stale && ', périmée'})</span>
          ))}</>}
      </div>
    </Panel>
  );
}

// --- risques et dividendes -----------------------------------------------------------

function Risk({ data }: { data: PortfolioReply }) {
  const r = data.risk;
  return (
    <Panel title="Risques" controls="none" chips={<Chip small>{`${r.days} jour(s) ouvré(s)`}</Chip>}>
      <div className="bkv">
        <Kpi label="Volatilité annualisée" value={r.volatility === null ? <Missing reason={r.reason ?? 'non calculable'} /> : `${fmtNumber(r.volatility * 100, 1)}${NBSP}%`} />
        <Kpi label="Perte maximale" cls="down" value={r.max_drawdown ? fmtPctChange(r.max_drawdown.value) : DASH}
          sub={r.max_drawdown && r.max_drawdown.value < 0 ? `${fmtValueDate(r.max_drawdown.peak)} → ${fmtValueDate(r.max_drawdown.trough)}` : undefined} />
        {r.vs.map((v) => (
          <Kpi key={v.key} label={`Bêta · corrélation (${v.label})`}
            value={v.beta === null ? <Missing reason={r.reason ?? 'pas assez de jours communs'} /> : `${fmtNumber(v.beta, 2)} · ${fmtNumber(v.correlation, 2)}`}
            sub={v.days ? `${v.days} jours communs` : `${r.min_days} jours au moins`} />
        ))}
      </div>
    </Panel>
  );
}

function Dividends({ data }: { data: PortfolioReply }) {
  const d = data.dividends;
  return (
    <Panel title="Dividendes reçus" controls="none" chips={<Chip small>{eur(d.total)}</Chip>}>
      {d.items.length === 0
        ? <div className="ptf-pad lbl lbl--s">Aucun dividende reçu depuis l’origine (les ETF capitalisants n’en versent pas).</div>
        : <div className="btable btable--compact"><table><tbody>
          {d.items.map((x, k) => <tr key={k}><td>{fmtValueDate(x.date)}</td><td>{x.name}</td><td className="r num">{eur(x.net)}</td></tr>)}
        </tbody></table></div>}
    </Panel>
  );
}

// --- opérations et import ------------------------------------------------------------

function Operations({ ops, onChange }: { ops: { transactions: TransactionReply[]; batches: BatchReply[] } | null; onChange: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  if (!ops) return null;
  const undo = async (id: number) => {
    if (armed !== id) { setArmed(id); return; }
    setBusy(id);
    await deleteBatch(id);
    setBusy(null); setArmed(null); onChange();
  };
  return (
    <Panel title="Opérations" controls="none" chips={<Chip small>{`${ops.transactions.length} opération(s)`}</Chip>}>
      {ops.batches.length > 0 && (
        <div className="ptf-pad ptf-batches">
          {ops.batches.map((b) => (
            <span key={b.id} className="lbl lbl--s">
              {b.file_name ?? 'import'} · {b.inserted}/{b.rows} ligne(s) · {fmtParis(b.imported_at)}{' '}
              <Button variant="ghost" disabled={busy === b.id} onClick={() => void undo(b.id)}>{armed === b.id ? 'Confirmer l’annulation' : 'Annuler ce lot'}</Button>
            </span>
          ))}
        </div>
      )}
      <div className="btable">
        <table>
          <thead><tr className="lbl lbl--s"><th>Date</th><th>Type</th><th>Titre</th><th className="r">Quantité</th><th className="r">Prix</th><th className="r">Montant</th><th className="r">Frais · taxes</th></tr></thead>
          <tbody>
            {ops.transactions.map((t) => (
              <tr key={t.id}>
                <td data-label="Date" className="num">{fmtValueDate(t.trade_date)}</td>
                <td data-label="Type">{KIND_LABEL[t.kind] ?? t.kind}</td>
                <td data-label="Titre">{t.name ? <><span className="btable__name">{t.symbol}</span><span className="lbl lbl--s btable__sub">{t.name}</span></> : DASH}</td>
                <td data-label="Quantité" className="r num">{t.quantity ? fmtNumber(Number(t.quantity), Number.isInteger(Number(t.quantity)) ? 0 : 4) : DASH}</td>
                <td data-label="Prix" className="r num">{t.price ? fmtNumber(Number(t.price), 2) : DASH}</td>
                <td data-label="Montant" className="r num">{t.amount ? `${fmtNumber(Number(t.amount), 2)}${NBSP}${t.currency}` : DASH}</td>
                <td data-label="Frais · taxes" className="r num">{Number(t.fees) || Number(t.taxes) ? `${fmtNumber(Number(t.fees), 2)} · ${fmtNumber(Number(t.taxes), 2)}` : DASH}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

type Step = { phase: 'idle' } | { phase: 'busy'; what: string } | { phase: 'preview'; report: ImportReply; payload: ImportPayload }
  | { phase: 'invalid'; report: ImportReply } | { phase: 'error'; reason: string } | { phase: 'done'; report: ImportReply };
interface ImportPayload { kind: string; broker: string; file_name: string; file_sha256: string; rows: unknown[] }

function ImportPanel({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState('PEA');
  const [broker, setBroker] = useState('XTB');
  const [step, setStep] = useState<Step>({ phase: 'idle' });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setStep({ phase: 'busy', what: 'Lecture du fichier…' });
    try {
      const buf = await f.arrayBuffer();
      const [{ rows }, sha] = await Promise.all([readSheet(buf, 'Opérations'), sha256Hex(buf)]);
      const payload = { kind, broker, file_name: f.name, file_sha256: sha, rows };
      setStep({ phase: 'busy', what: 'Vérification par le serveur…' });
      const r = await postImport({ ...payload, dry: true });
      if (r.ok) setStep({ phase: 'preview', report: r.data, payload });
      else if ('report' in r) setStep({ phase: 'invalid', report: r.report });
      else setStep({ phase: 'error', reason: r.detail });
    } catch (e) {
      setStep({ phase: 'error', reason: e instanceof Error ? e.message : String(e) });
    }
  };

  const confirm = async (payload: ImportPayload) => {
    setStep({ phase: 'busy', what: 'Import…' });
    const r = await postImport({ ...payload, dry: false });
    if (r.ok) setStep({ phase: 'done', report: r.data });
    else if ('report' in r) setStep({ phase: 'invalid', report: r.report });
    else setStep({ phase: 'error', reason: r.detail });
  };

  return (
    <Panel title="Importer des opérations" controls="none">
      <div className="ptf-import">
        <p className="lbl lbl--s">Fichier .xlsx au format d’import Baggr (feuille « Opérations », règles de la feuille « Aide »). Le fichier est vérifié en entier : la moindre erreur est signalée avec sa ligne, et rien n’est importé. Réimporter le même fichier n’ajoute rien.</p>
        <div className="ptf-import__form">
          <label className="lbl lbl--s">Enveloppe
            <select value={kind} onChange={(e) => setKind(e.target.value)}>{['PEA', 'CTO', 'PEA-PME', 'AV'].map((k) => <option key={k}>{k}</option>)}</select>
          </label>
          <label className="lbl lbl--s">Courtier <input value={broker} maxLength={40} onChange={(e) => setBroker(e.target.value)} /></label>
          <label className="lbl lbl--s">Fichier <input type="file" accept=".xlsx" onChange={(e) => void onFile(e.target.files?.[0])} /></label>
        </div>
        {step.phase === 'busy' && <span className="lbl">{step.what}</span>}
        {step.phase === 'error' && <span className="btable__err">{step.reason}</span>}
        {(step.phase === 'preview' || step.phase === 'invalid' || step.phase === 'done') && <ImportReport report={step.report} />}
        {step.phase === 'preview' && <div><Button variant="primary" onClick={() => void confirm(step.payload)}>{`Importer ${step.report.rows} opération(s) dans ${step.report.envelope}`}</Button></div>}
        {step.phase === 'done' && <div><Button variant="primary" onClick={onDone}>Voir le portefeuille</Button></div>}
      </div>
    </Panel>
  );
}

function ImportReport({ report }: { report: ImportReply }) {
  return (
    <div className="ptf-report">
      {report.result && <span className="lbl">{report.result.inserted} opération(s) ajoutée(s) sur {report.result.rows} ; {report.result.rows - report.result.inserted} déjà présente(s).</span>}
      {report.errors.length > 0 && <ul className="btable__err">{report.errors.map((e, k) => <li key={k}>Ligne {e.line} : {e.message}</li>)}</ul>}
      {report.warnings.length > 0 && <ul className="btable__note">{report.warnings.map((e, k) => <li key={k}>Ligne {e.line} : {e.message}</li>)}</ul>}
      {!report.result && report.errors.length === 0 && <span className="lbl lbl--s">{report.rows} opération(s) lue(s), aucune erreur.</span>}
    </div>
  );
}
