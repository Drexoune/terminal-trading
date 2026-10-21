// Palette de commandes (Ctrl K ou « / ») : grammaire TICKER FONCTION.
// Entrée ouvre l'écran ; Maj + Entrée l'ouvrira dans un nouveau panneau
// quand la disposition libre existera (P1) — d'ici là, même effet.

import { Command } from 'cmdk';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { EXTRA_SCREENS, MODULES } from '../modules';
import './palette.css';

export interface PaletteEntry { command: string; description: string; category: string; path: string; phase?: string }

export const ENTRIES: PaletteEntry[] = [
  ...MODULES.map((m) => ({ command: m.command, description: m.description, category: m.category, path: m.path, phase: m.phase })),
  ...EXTRA_SCREENS.map((s) => ({ command: s.command, description: s.description, category: s.category, path: s.path })),
];

/** Filtre de la palette : chaque mot tapé doit commencer un mot de la commande ou figurer dans la description. */
export function matchEntry(entry: PaletteEntry, query: string): number {
  const q = query.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!q.length) return 1;
  const words = entry.command.toUpperCase().split(/\s+/);
  const text = `${entry.description} ${entry.category}`.toUpperCase();
  if (q.every((w) => words.some((x) => x.startsWith(w)))) return 1;
  if (q.every((w) => text.includes(w))) return 0.5;
  return 0;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 0); }, [open]);

  if (!open) return null;
  const go = (path: string) => { onClose(); navigate(path); };

  return (
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Command className="palette" label="Palette de commandes" loop
        filter={(value, search) => {
          const e = ENTRIES.find((x) => x.command === value);
          return e ? matchEntry(e, search) : 0;
        }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}>
        <label className="palette__input">
          <Icon name="search" size={18} />
          <span className="sr">Commande</span>
          <Command.Input ref={input} placeholder="BTC GP, USD ECO, FED WIRP…" />
          <kbd className="chip">Échap</kbd>
        </label>
        <Command.List className="palette__list">
          <Command.Empty className="palette__empty lbl">Aucune commande</Command.Empty>
          {ENTRIES.map((e) => (
            <Command.Item key={e.command} value={e.command} onSelect={() => go(e.path)} className="palette__item">
              <span className="num palette__cmd">{e.command}</span>
              <span className="palette__desc">{e.description}</span>
              <span className="lbl lbl--s">{e.phase && e.phase !== 'P0' ? `${e.category} · ${e.phase}` : e.category}</span>
            </Command.Item>
          ))}
        </Command.List>
        <div className="lbl lbl--s palette__foot">
          <span>↑ ↓ naviguer</span><span>Entrée ouvrir</span><span>Maj + Entrée nouveau panneau</span>
        </div>
      </Command>
    </div>
  );
}

/** Raccourcis globaux : Ctrl K (ou Cmd K) et « / » hors d'un champ de saisie. */
export function usePaletteShortcut(setOpen: (v: boolean | ((o: boolean) => boolean)) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
}
