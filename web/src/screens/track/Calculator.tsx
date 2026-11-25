// Calculateur de risque (P6, S5 ; commande CALC) : taille de position à partir du capital, du risque
// et du stop ; contrats OKX arrondis au pas de l'instrument (paramètres lus sur OKX) ; contrôle des
// règles d'une société de financement (relevées le 24/11/2026, backtest/diagnostics.ts). Tout est
// calculé dans le navigateur, rien n'est envoyé.

import './track.css';
import { useMemo, useState } from 'react';
import { firmCheck, positionSize, SizeError, type SizeResult } from '../../account/account';
import { firms } from '../../backtest/diagnostics';
import { Panel } from '../../components/Panel';
import { Chip, Missing } from '../../components/ui';
import type { InstrumentMeta } from '../../data/protocol';
import { useValue } from '../../data/store';
import { fmtNumber, NBSP } from '../../lib/format';
import { SubHeader } from '../../shell/SubHeader';

const n = (s: string) => { const v = Number(s.replace(/[\s  ]/g, '').replace(',', '.')); return s.trim() && Number.isFinite(v) ? v : null; };

export function CalculatorScreen() {
  const [capital, setCapital] = useState('10000');
  const [riskPct, setRiskPct] = useState('1');
  const [riskAmt, setRiskAmt] = useState('');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [inst, setInst] = useState('BTC-USDT-SWAP');
  const [firm, setFirm] = useState('');
  const [today, setToday] = useState('0');
  const [balance, setBalance] = useState('');
  const meta = useValue<InstrumentMeta>(`instrument:${inst}`);
  const all = useMemo(() => firms(), []);

  let res: SizeResult | null = null, error: string | null = null;
  if (n(entry) !== null && n(stop) !== null) {
    try {
      res = positionSize({ capital: n(capital) ?? 0, riskPct: n(riskPct), riskAmount: n(riskAmt), entry: n(entry)!, stop: n(stop)!,
        ctVal: inst === 'autre' ? null : meta?.ct_val ?? null, lotSz: inst === 'autre' ? null : meta?.lot_sz ?? null });
    } catch (e) { error = e instanceof SizeError ? e.message : String(e); }
  }
  const f = all.find((x) => x.id === firm);
  const check = res && f ? firmCheck(f, res.lossAtStop, n(today) ?? 0, n(balance) ?? f.account) : null;
  const asset = inst === 'autre' ? 'unités' : inst.split('-')[0];
  const field = (label: string, v: string, on: (s: string) => void, ph = '') => (
    <label className="field"><span className="lbl lbl--s">{label}</span><input className="input num" inputMode="decimal" value={v} placeholder={ph} onChange={(e) => on(e.target.value)} /></label>
  );

  return (
    <>
      <SubHeader icon="calculator" title="Calculateur de risque · taille de position" chips={<Chip variant="hot" round>Calcul local, rien n’est envoyé</Chip>} />
      <div className="content tr" data-screen="calculator">
        <div className="tr-row">
          <Panel title="Saisie" controls="none" style={{ flex: '1 1 340px' }}>
            <div className="tr-form tr-form--calc">
              {field('Capital ($)', capital, setCapital)}
              {field('Risque (% du capital)', riskPct, setRiskPct)}
              {field('ou risque ($, prioritaire)', riskAmt, setRiskAmt)}
              <label className="field"><span className="lbl lbl--s">Instrument</span>
                <select className="input" value={inst} onChange={(e) => setInst(e.target.value)}>
                  <option value="BTC-USDT-SWAP">BTC-USDT perp (OKX)</option><option value="ETH-USDT-SWAP">ETH-USDT perp (OKX)</option><option value="autre">Autre (sans contrats)</option>
                </select></label>
              {field('Prix d’entrée', entry, setEntry, '60 000')}
              {field('Stop', stop, setStop, '59 500')}
              <label className="field"><span className="lbl lbl--s">Société de financement</span>
                <select className="input" value={firm} onChange={(e) => setFirm(e.target.value)}>
                  <option value="">Aucune</option>{all.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select></label>
              {f && <>{field('Résultat du jour ($)', today, setToday)}{field(`Solde du compte ($, défaut ${fmtNumber(f.account, 0)})`, balance, setBalance)}</>}
            </div>
          </Panel>
          <Panel title="Résultat" controls="none" style={{ flex: '1 1 340px' }}>
            <div className="tr-res" data-testid="calc-result">
              {error ? <div className="tr-empty"><Missing reason={error} /><span>{error}</span></div>
                : !res ? <div className="tr-empty"><Missing reason="entrée et stop à saisir" /><span>Saisir l’entrée et le stop.</span></div> : <>
                  <dl className="tr-dl">
                    <dt>Sens</dt><dd className={res.side === 'long' ? 'up' : 'dn'}>{res.side === 'long' ? 'Long (stop sous l’entrée)' : 'Short (stop au-dessus)'}</dd>
                    <dt>Risque</dt><dd className="num">{`${fmtNumber(res.risk, 2)}${NBSP}$`}</dd>
                    <dt>Distance du stop</dt><dd className="num">{`${fmtNumber(res.distance, 2)}${NBSP}$ (${fmtNumber(res.distancePct, 2)}${NBSP}%)`}</dd>
                    <dt>Taille</dt><dd className="num tr-big">{`${fmtNumber(res.qty, 4)}${NBSP}${asset}`}{res.contracts !== null && ` · ${fmtNumber(res.contracts, 2)} contrats`}</dd>
                    <dt>Valeur de la position</dt><dd className="num">{`${fmtNumber(res.notional, 2)}${NBSP}$`}</dd>
                    <dt>Levier</dt><dd className="num">{fmtNumber(res.leverage, 2)}</dd>
                    <dt>Perte au stop</dt><dd className="num dn">{`${fmtNumber(res.lossAtStop, 2)}${NBSP}$`}</dd>
                  </dl>
                  {inst !== 'autre' && <p className="lbl lbl--s tr-src">{meta ? `Contrat OKX : ${meta.ct_val} ${meta.ct_val_ccy}, pas de ${meta.lot_sz} contrat` : 'paramètres du contrat OKX pas encore reçus : taille en unités seulement'}</p>}
                  {res.warnings.map((w) => <p key={w} className="tr-warn">{w}</p>)}
                  {check && <div className="tr-firm" data-testid="calc-firm"><span className={`chip ${check.ok ? 'chip--live' : 'chip--down'}`}>{`${check.firm} : ${check.ok ? 'règles respectées' : 'règle franchie au stop'}`}</span>
                    <ul>{check.lines.map((l) => <li key={l.label} className={l.ok ? '' : 'dn'}>{`${l.label} : ${l.ok ? 'OK' : 'franchie'} · ${l.detail}`}</li>)}</ul>
                    <p className="lbl lbl--s tr-src">{f!.source}</p></div>}
                </>}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
