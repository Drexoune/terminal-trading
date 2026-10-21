import '../overview/overview.css';
import { Chip } from '../../components/ui';
import { SubHeader } from '../../shell/SubHeader';
import { BtcPanel } from '../overview/BtcPanel';
import { SourceChip } from '../overview/Overview';

/** BTC GP : le panneau BTC en pleine largeur. */
export function Charts() {
  return (
    <>
      <SubHeader icon="charts" title="Graphiques · BTC-USDT perpétuel" chips={<>
        <Chip variant="hot" round>BTC-USDT · Perp · OKX</Chip>
        <SourceChip />
      </>} />
      <div className="content">
        <div className="col" style={{ flex: '1 1 560px' }}><BtcPanel /></div>
      </div>
    </>
  );
}
