import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { MODULES, SECTIONS } from '../modules';

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <nav className={`nav sidebar${collapsed ? ' sidebar--collapsed' : ''}`} aria-label="Navigation principale">
      <div className="sidebar__top">
        <button type="button" className="btn sidebar__collapse" aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}>
          <Icon name={collapsed ? 'expand' : 'collapse'} />
          <span>{collapsed ? 'Déplier' : 'Réduire'}</span>
        </button>
      </div>
      {SECTIONS.map((section) => (
        <div key={section} className="nav-section">
          <div className="lbl nav-section__title">{section}</div>
          {MODULES.filter((m) => m.section === section).map((m) => (
            <NavLink key={m.id} to={m.path} end title={collapsed ? m.label : undefined}>
              <Icon name={m.icon} /><span>{m.label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
