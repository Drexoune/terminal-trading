import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { MODULES, SETTINGS_PATH } from './modules';
import { CommandPalette, usePaletteShortcut } from './palette/CommandPalette';
import { Charts } from './screens/charts/Charts';
import { DesignSystem } from './screens/design-system/DesignSystem';
import { Overview } from './screens/overview/Overview';
import { PlaceholderScreen } from './screens/placeholder/Placeholder';
import { SettingsScreen } from './screens/settings/Settings';
import { AppShell } from './shell/AppShell';

const IMPLEMENTED: Record<string, () => React.JSX.Element> = { overview: Overview, charts: Charts };

function Shell() {
  const [palette, setPalette] = useState(false);
  usePaletteShortcut(setPalette);
  return (
    <>
      <AppShell onOpenPalette={() => setPalette(true)}>
        <Routes>
          {MODULES.map((m) => {
            const Screen = IMPLEMENTED[m.id];
            return <Route key={m.id} path={m.path}
              element={Screen ? <Screen /> : <PlaceholderScreen module={m} />} />;
          })}
          {/* Paramètres : hors menu, ouvert par l'avatar ou la commande SET. */}
          <Route path={SETTINGS_PATH} element={<SettingsScreen />} />
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
