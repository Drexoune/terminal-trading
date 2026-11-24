import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ALL_MODULES, SECTIONS } from '../modules';

/**
 * Sections repliables : ajoutées après la maquette (module Bourse, T-036 ; Backtest, T-061).
 * Repliées par défaut pour que le menu garde les mesures de la maquette Main ;
 * ouvertes d'office quand l'écran affiché en fait partie.
 */
const COLLAPSIBLE: Record<string, string> = { Bourse: '/bourse/', Backtest: '/backtest' };

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(
    Object.entries(COLLAPSIBLE).map(([s, prefix]) => [s, pathname.startsWith(prefix)])));

  useEffect(() => {
    for (const [s, prefix] of Object.entries(COLLAPSIBLE)) {
      if (pathname.startsWith(prefix)) setOpen((o) => (o[s] ? o : { ...o, [s]: true }));
    }
  }, [pathname]);

  return (
    <nav className={`nav sidebar${collapsed ? ' sidebar--collapsed' : ''}`} aria-label="Navigation principale">
      <div className="sidebar__top">
        <button type="button" className="btn sidebar__collapse" aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}>
          <Icon name={collapsed ? 'expand' : 'collapse'} />
          <span>{collapsed ? 'Déplier' : 'Réduire'}</span>
        </button>
      </div>
      {SECTIONS.map((section) => {
        const foldable = section in COLLAPSIBLE;
        const shown = !foldable || open[section];
        const id = `nav-section-${section.toLowerCase().replace(/[^a-z]+/g, '-')}`;
        return (
          <div key={section} className="nav-section">
            {foldable
              ? <button type="button" className="lbl nav-section__title nav-section__toggle" aria-expanded={shown}
                  aria-controls={id} onClick={() => setOpen((o) => ({ ...o, [section]: !shown }))}>{section}</button>
              : <div className="lbl nav-section__title">{section}</div>}
            {shown && (
              <div id={id}>
                {ALL_MODULES.filter((m) => m.section === section).map((m) => (
                  <NavLink key={m.id} to={m.path} end title={collapsed ? m.label : undefined}>
                    <Icon name={m.icon} /><span>{m.label}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
