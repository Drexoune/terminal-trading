import '../overview/overview.css';
import { Chip } from '../../components/ui';
import { SubHeader } from '../../shell/SubHeader';
import { BtcPanel } from '../overview/BtcPanel';
import { SourceChip } from '../overview/Overview';
import { MarketTabs, NasdaqChart, useMarketTab } from '../nasdaq/Nasdaq';

/** BTC GP : le panneau BTC en pleine largeur. */
export function Charts() {
  const [tab, setTab] = useMarketTab();
  if (tab === 'nasdaq') return (
    <>
      <SubHeader icon="charts" title="Graphiques · Nasdaq 100 (QQQ)" chips={<><MarketTabs tab={tab} onChange={setTab} /><Chip variant="hot" round>QQQ · Tiingo</Chip></>} />
      <NasdaqChart />
    </>
  );
  return (
    <>
      <SubHeader icon="charts" title="Graphiques · BTC-USDT perpétuel" chips={<>
        <MarketTabs tab={tab} onChange={setTab} />
        <Chip variant="hot" round>BTC-USDT · Perp · OKX</Chip>
        <SourceChip />
      </>} />
      <div className="content">
        <div className="col" style={{ flex: '1 1 560px' }}><BtcPanel /></div>
      </div>
    </>
  );
}
