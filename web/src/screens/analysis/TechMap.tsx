// Heatmap technique (P7, S2 ; commande TECH ; T-075) : tendance par actif et unité de temps, à
// partir de cinq signaux explicables (EMA 20, 50, 200, MACD, RSI), calculée chaque heure par la
// machine Oracle. Un clic ouvre la fiche Indicateurs de l'actif.

import { Tip } from '../../help/Tip';
import './analysis.css';
import { Link } from 'react-router-dom';
import { useAnalysis } from '../../analysis/client';
import type { Snapshot } from '../../analysis/ta';
import { Panel } from '../../components/Panel';
import { Cell, Chip, type CellLevel } from '../../components/ui';
import { SubHeader } from '../../shell/SubHeader';
import { Empty, FreshChip } from './parts';

export interface TechCell { tf: string; snap: Snapshot | null; reason: string | null; bars: number; last_t: number | null }
export interface TechAsset { asset: string; label: string; source: string; cells: TechCell[]; closes: [number, number][] }
export interface Tech { assets: TechAsset[]; tfs: string[]; computed_ms: number }

export const TREND_LABEL = { up: 'Haussier', neutral: 'Neutre', down: 'Baissier' } as const;
export function level(score: number): CellLevel { return score >= 5 ? 'up-2' : score >= 3 ? 'up-1' : score <= -5 ? 'down-2' : score <= -3 ? 'down-1' : 'neutral'; }
export const signalsText = (s: Snapshot) => s.signals.map((x) => `${x.bull === null ? '·' : x.bull ? '+' : '−'} ${x.label}`).join('\n');

export function TechMapScreen() {
  const s = useAnalysis<Tech>('tech');
  const v = s.value;
  return (
    <>
      <SubHeader icon="techmap" title="Heatmap technique · tendance par unité de temps"
        chips={<><Chip variant="hot" round>5 signaux : EMA 20, 50, 200, MACD, RSI</Chip><Tip term="trendScore" label="Score de tendance" /></>} />
      <div className="content an" data-screen="techmap">
        <Panel title="Tendance" controls="none" chips={<FreshChip s={s} source="OKX (bougies publiques), Tiingo (clôtures ajustées)" />}>
          {!v ? <Empty reason={s.reason ?? '—'} /> : (
            <div className="an-scroll">
              <table className="an-table an-heat" data-testid="techmap">
                <thead><tr><th className="lbl">Actif</th>{v.tfs.map((tf) => <th key={tf} className="lbl">{tf}</th>)}</tr></thead>
                <tbody>{v.assets.map((a) => (
                  <tr key={a.asset}>
                    <th scope="row"><Link to={`/indicateurs?actif=${a.asset}`}>{a.label}</Link><span className="an-sub">{a.source}</span></th>
                    {a.cells.map((c) => (
                      <td key={c.tf} title={c.snap ? `${a.label} ${c.tf} · score ${c.snap.score}\n${signalsText(c.snap)}` : (c.reason ?? '—')}>
                        {c.snap?.trend ? <Link to={`/indicateurs?actif=${a.asset}`}><Cell level={level(c.snap.score)}>{`${TREND_LABEL[c.snap.trend]} ${c.snap.score > 0 ? '+' : c.snap.score < 0 ? '−' : ''}${Math.abs(c.snap.score)}`}</Cell></Link>
                          : <span className="an-na" title={c.reason ?? 'historique insuffisant'}>—</span>}
                      </td>
                    ))}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Panel>
        <p className="an-foot lbl lbl--s">Score : +1 par signal haussier, −1 par signal baissier ; haussier à +3 ou plus, baissier à −3 ou moins. Bougie en cours exclue. « — » : raison au survol.</p>
      </div>
    </>
  );
}
