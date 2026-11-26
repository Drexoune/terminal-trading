// Portée de l'aide : l'écran courant (identifiant du module) fournit la case explicative de la page
// et les bulles des panneaux. La case se replie par page ; un réglage global la masque partout.

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { PAGES, panelHelp, type Help } from './content';

const Scope = createContext<string | null>(null);
export function HelpScope({ id, children }: { id: string; children: ReactNode }) { return <Scope.Provider value={id}>{children}</Scope.Provider>; }
export const useHelpScope = () => useContext(Scope);

/** Aide d'un panneau de l'écran courant (par son libellé, puis son titre), ou null. */
export function usePanelHelp(title: string, label?: string): Help | null {
  const id = useContext(Scope);
  return id ? panelHelp(id, title, label) : null;
}

const KEY = (id: string) => `help:guide:${id}`;
export const GLOBAL_HIDE = 'help:guides-hidden';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* navigation privée */ } };

/** État de la case d'une page : ouverte par défaut, repliable, mémorisée dans ce navigateur. */
export function useGuide(id: string | null): [boolean, () => void] {
  const [open, setOpen] = useState(() => !!id && read(GLOBAL_HIDE) !== '1' && read(KEY(id)) !== 'closed');
  const toggle = () => { if (!id) return; setOpen((o) => { write(KEY(id), o ? 'closed' : null); return !o; }); };
  return [open, toggle];
}

export function GuideButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`guide-btn${open ? ' guide-btn--on' : ''}`} aria-expanded={open} aria-controls="page-guide" onClick={onClick}
      title={open ? 'Masquer l’explication de la page' : 'Afficher l’explication de la page'}>
      <Icon name="info" size={13} />Guide
    </button>
  );
}

export function PageGuide({ id }: { id: string }) {
  const p = PAGES[id];
  if (!p) return null;
  return (
    <section id="page-guide" className="guide" aria-label="Explication de la page">
      <div className="guide-col guide-col--intro">
        <p className="guide-h">À quoi sert cette page</p>
        <p>{p.intro}</p>
      </div>
      <div className="guide-col">
        <p className="guide-h">Comment la lire</p>
        <ul>{p.read.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
      <div className="guide-col">
        <p className="guide-h">Comment s’en servir</p>
        <ul>{p.use.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
      <p className="guide-foot">Survoler ou toucher les pastilles <span className="ht-btn ht-btn--static" aria-hidden="true">i</span> pour le détail de chaque élément. Rien ici n’est un conseil d’investissement.</p>
    </section>
  );
}
