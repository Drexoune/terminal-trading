// Track record (P6, S5 ; commande PORT) : journal de trading saisi à la main (T-074 : positions OKX
// plus tard, sans clé pour l'instant), statistiques calculées par le code, courbe des résultats.
// Écriture derrière le mot de passe d'application (porte du module Bourse). Le PEA reste suivi dans
// le module Bourse (lien).

import './track.css';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { JournalTrade } from '../../../../api/_lib/journal-core';
import { journalStats, pnl, rMultiple } from '../../account/account';
import { Panel } from '../../components/Panel';
import { Button, Chip, Missing } from '../../components/ui';
import { fmtNumber, fmtSigned, NBSP } from '../../lib/format';
import { fmtHm } from '../../lib/time';
import { BourseGate } from '../bourse/BourseGate';
import { SubHeader } from '../../shell/SubHeader';

const PARIS = 'Europe/Paris';
const day = (ms: number) => new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, day: '2-digit', month: '2-digit', year: '2-digit' }).format(ms);

async function api<T>(method: string, query = '', body?: unknown): Promise<T> {
  const r = await fetch(`/api/bourse/journal${query}`, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({})) as T & { detail?: string };
  if (!r.ok) throw new Error(data.detail ?? `HTTP ${r.status}`);
  return data;
}

interface Draft { asset: string; side: 'long' | 'short'; opened: string; closed: string; qty: string; entry: string; exit: string; stop: string; fees: string; setup: string; notes: string }
const EMPTY: Draft = { asset: 'BTC', side: 'long', opened: '', closed: '', qty: '', entry: '', exit: '', stop: '', fees: '0', setup: '', notes: '' };
const local = (s: string) => (s ? Date.parse(s) : null);           // champ datetime-local : heure du navigateur (Paris)

function Curve({ points }: { points: { t: number; cum: number }[] }) {
  if (points.length < 2) return <div className="tr-empty"><Missing reason="au moins 2 trades clos" /><span>Courbe : au moins 2 trades clos.</span></div>;
  const vals = [0, ...points.map((p) => p.cum)];
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const y = (v: number) => (((hi - v) / span) * 140).toFixed(1);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${((i / (vals.length - 1)) * 1000).toFixed(1)} ${y(v)}`).join('');
  return (
    <div className="tr-curve">
      <svg viewBox="0 0 1000 140" preserveAspectRatio="none" aria-label="Résultat cumulé des trades clos" role="img">
        <path className="tr-zero" d={`M0 ${y(0)}H1000`} />
        <path className={`tr-line ${points[points.length - 1].cum >= 0 ? 'up' : 'dn'}`} d={d} />
      </svg>
    </div>
  );
}

function Body() {
  const [trades, setTrades] = useState<JournalTrade[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [d, setD] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<{ trades: JournalTrade[] }>('GET').then((r) => { setTrades(r.trades); setErr(null); }).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('POST', '', { asset: d.asset, side: d.side, opened_ms: local(d.opened), closed_ms: local(d.closed), qty: d.qty, entry: d.entry,
        exit: d.exit || null, stop: d.stop || null, fees: d.fees || 0, setup: d.setup, notes: d.notes });
      setD({ ...EMPTY, asset: d.asset });
      await load();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  async function remove(id: number) {
    if (!window.confirm('Supprimer ce trade du journal ?')) return;
    try { await api('DELETE', `?id=${id}`); await load(); } catch (x) { setErr((x as Error).message); }
  }

  const s = trades ? journalStats(trades) : null;
  const kpi = (label: string, v: string | null, tone = '') => (
    <div className="tr-kpi"><span className="lbl lbl--s">{label}</span><span className={`num tr-kpi__v ${tone}`}>{v ?? '—'}</span></div>
  );
  return (
    <div className="content tr" data-screen="track">
      {err && <p className="field__error" role="alert">{err}</p>}
      <Panel title="Statistiques · trades clos" controls="none" chips={<Chip>{s ? `${s.closed} clos · ${s.open} ouverts` : '—'}</Chip>}>
        <div className="tr-kpis" data-testid="track-stats">
          {kpi('Résultat total', s ? `${fmtSigned(s.total, 2)}${NBSP}$` : null, s && s.total >= 0 ? 'up' : 'dn')}
          {kpi('Taux de réussite', s?.winRate != null ? `${fmtNumber(s.winRate * 100, 1)}${NBSP}%` : null)}
          {kpi('Profit factor', s?.profitFactor != null ? fmtNumber(s.profitFactor, 2) : null)}
          {kpi('Espérance', s?.expectancyR != null ? `${fmtSigned(s.expectancyR, 2)}${NBSP}R (${s.rCount} avec stop)` : null)}
          {kpi('Gain moyen / perte moyenne', s?.avgWin != null && s.avgLoss != null ? `${fmtNumber(s.avgWin, 0)} / ${fmtNumber(s.avgLoss, 0)}` : null)}
          {kpi('Pire série de pertes', s ? String(s.worstStreak) : null)}
        </div>
        {s && <Curve points={s.curve} />}
      </Panel>

      <Panel title="Nouveau trade" controls="none" chips={<Chip title="Positions OKX en lecture : plus tard, sans clé pour l’instant (T-074)">Saisie manuelle</Chip>}>
        <form className="tr-form" onSubmit={(e) => void add(e)}>
          <label className="field"><span className="lbl lbl--s">Actif</span><input className="input" value={d.asset} onChange={(e) => set('asset', e.target.value)} /></label>
          <label className="field"><span className="lbl lbl--s">Sens</span>
            <select className="input" value={d.side} onChange={(e) => set('side', e.target.value as Draft['side'])}><option value="long">Long</option><option value="short">Short</option></select></label>
          <label className="field"><span className="lbl lbl--s">Entrée (date, heure)</span><input className="input" type="datetime-local" value={d.opened} onChange={(e) => set('opened', e.target.value)} required /></label>
          <label className="field"><span className="lbl lbl--s">Quantité</span><input className="input num" inputMode="decimal" value={d.qty} onChange={(e) => set('qty', e.target.value)} required /></label>
          <label className="field"><span className="lbl lbl--s">Prix d’entrée</span><input className="input num" inputMode="decimal" value={d.entry} onChange={(e) => set('entry', e.target.value)} required /></label>
          <label className="field"><span className="lbl lbl--s">Stop</span><input className="input num" inputMode="decimal" value={d.stop} onChange={(e) => set('stop', e.target.value)} /></label>
          <label className="field"><span className="lbl lbl--s">Sortie (date, heure)</span><input className="input" type="datetime-local" value={d.closed} onChange={(e) => set('closed', e.target.value)} /></label>
          <label className="field"><span className="lbl lbl--s">Prix de sortie</span><input className="input num" inputMode="decimal" value={d.exit} onChange={(e) => set('exit', e.target.value)} /></label>
          <label className="field"><span className="lbl lbl--s">Frais</span><input className="input num" inputMode="decimal" value={d.fees} onChange={(e) => set('fees', e.target.value)} /></label>
          <label className="field"><span className="lbl lbl--s">Setup</span><input className="input" value={d.setup} maxLength={80} onChange={(e) => set('setup', e.target.value)} /></label>
          <label className="field tr-notes"><span className="lbl lbl--s">Notes</span><input className="input" value={d.notes} maxLength={2000} onChange={(e) => set('notes', e.target.value)} /></label>
          <Button variant="primary" type="submit" disabled={busy}>Ajouter au journal</Button>
        </form>
      </Panel>

      <Panel title="Journal" controls="none" chips={<Link className="chip" to="/bourse/portefeuille">PEA : module Bourse</Link>}>
        <div className="tr-scroll">
          {!trades ? <div className="tr-empty"><span className="lbl">Chargement…</span></div>
            : !trades.length ? <div className="tr-empty"><Missing reason="journal vide" /><span>Aucun trade saisi.</span></div>
              : <table className="tr-table" data-testid="track-table">
                  <thead><tr>{['Entrée', 'Actif', 'Sens', 'Qté', 'Prix', 'Stop', 'Sortie', 'Frais', 'Résultat', 'R', 'Setup', ''].map((h) => <th key={h} className="lbl">{h}</th>)}</tr></thead>
                  <tbody>{trades.map((t) => {
                    const p = pnl(t), r = rMultiple(t);
                    return (
                      <tr key={t.id}>
                        <td className="num">{`${day(t.opened_ms)} ${fmtHm(t.opened_ms, PARIS)}`}</td>
                        <td>{t.asset}</td><td className={t.side === 'long' ? 'up' : 'dn'}>{t.side === 'long' ? 'Long' : 'Short'}</td>
                        <td className="num">{fmtNumber(t.qty, 4)}</td><td className="num">{fmtNumber(t.entry, 2)}</td>
                        <td className="num">{t.stop !== null ? fmtNumber(t.stop, 2) : '—'}</td>
                        <td className="num">{t.exit !== null ? fmtNumber(t.exit, 2) : <Chip small>Ouvert</Chip>}</td>
                        <td className="num">{fmtNumber(t.fees, 2)}</td>
                        <td className={`num ${p === null ? '' : p >= 0 ? 'up' : 'dn'}`}>{p === null ? '—' : fmtSigned(p, 2)}</td>
                        <td className="num">{r === null ? '—' : fmtSigned(r, 2)}</td>
                        <td title={t.notes ?? undefined}>{t.setup ?? '—'}</td>
                        <td><button type="button" className="tr-del" aria-label={`Supprimer le trade ${t.id}`} onClick={() => void remove(t.id)}>×</button></td>
                      </tr>
                    );
                  })}</tbody>
                </table>}
        </div>
      </Panel>
    </div>
  );
}

export function TrackScreen() {
  return (
    <>
      <SubHeader icon="track" title="Track record · journal de trading" chips={<Chip variant="hot" round>Saisie manuelle</Chip>} />
      <BourseGate>{() => <Body />}</BourseGate>
    </>
  );
}
