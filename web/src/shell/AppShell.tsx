import type { ReactNode } from 'react';
import { useAnnouncements } from '../squawk/announce';
import { FeedBar } from './FeedBar';
import { ReleaseBanner } from './ReleaseBanner';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell({ children, onOpenPalette }: { children: ReactNode; onOpenPalette: () => void }) {
  useAnnouncements();
  return (
    <div className="app">
      <TopBar onOpenPalette={onOpenPalette} />
      <div className="body-row">
        <Sidebar />
        <main className="main">
          <ReleaseBanner />
          {children}
          <FeedBar />
        </main>
      </div>
    </div>
  );
}
