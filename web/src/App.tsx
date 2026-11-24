import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ALL_MODULES, MODULES, SETTINGS_PATH } from './modules';
import { CommandPalette, usePaletteShortcut } from './palette/CommandPalette';
import { PortfolioScreen } from './screens/bourse/Portfolio';
import { AlertsScreen } from './screens/alerts/Alerts';
import { CalendarScreen } from './screens/calendar/Calendar';
import { SourcesScreen } from './screens/bourse/Sources';
import { Charts } from './screens/charts/Charts';
import { DesignSystem } from './screens/design-system/DesignSystem';
import { Overview } from './screens/overview/Overview';
import { PlaceholderScreen } from './screens/placeholder/Placeholder';
import { SettingsScreen } from './screens/settings/Settings';
import { SquawkScreen } from './screens/squawk/Squawk';
import { NewsScreen } from './screens/news/News';
import { HoursScreen } from './screens/hours/Hours';
import { MarketsWatchScreen } from './screens/watch/MarketsWatch';
import { RatesScreen } from './screens/rates/Rates';
import { AppShell } from './shell/AppShell';
import { ALERTS_PATH } from './shell/Notifications';

const IMPLEMENTED: Record<string, () => React.JSX.Element> = { overview: Overview, charts: Charts, sources: SourcesScreen, portfolio: PortfolioScreen, calendar: CalendarScreen, squawk: SquawkScreen, news: NewsScreen, hours: HoursScreen, watch: MarketsWatchScreen, rates: RatesScreen };

function Shell() {
  const [palette, setPalette] = useState(false);
  usePaletteShortcut(setPalette);
  return (
    <>
      <AppShell onOpenPalette={() => setPalette(true)}>
        <Routes>
          {ALL_MODULES.map((m) => {
            const Screen = IMPLEMENTED[m.id];
            return <Route key={m.id} path={m.path}
              element={Screen ? <Screen /> : <PlaceholderScreen module={m} />} />;
          })}
          {/* Paramètres : hors menu, ouvert par l'avatar ou la commande SET. */}
          <Route path={SETTINGS_PATH} element={<SettingsScreen />} />
          {/* Alertes (E4) : hors menu (la maquette n'en a pas), cloche ou commande ALRT. */}
          <Route path={ALERTS_PATH} element={<AlertsScreen />} />
          <Route path="*" element={<PlaceholderScreen module={{ ...MODULES[0], label: 'Écran inconnu', phase: 'P0', command: 'HOME' }} />} />
        </Routes>
      </AppShell>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/design-system" element={<DesignSystem />} />
        <Route path="*" element={<Shell />} />
      </Routes>
    </BrowserRouter>
  );
}
