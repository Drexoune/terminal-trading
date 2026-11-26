// Bulle d'aide « i » : s'ouvre au survol, au focus clavier et au toucher ; se ferme en sortant, à la
// touche Échap ou en touchant ailleurs. Rendue dans document.body, en position fixe et bornée à la
// fenêtre : elle ne décale jamais la mise en page et ne crée aucun défilement horizontal (390 px).

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Help } from './content';

export function HelpBody({ h }: { h: Help }) {
  return <>
    <p className="ht-what">{h.what}</p>
    {h.read && <p><b>Lecture.</b> {h.read}</p>}
    {h.use && <p><b>En pratique.</b> {h.use}</p>}
    {h.calc && <p className="ht-calc"><b>Calcul.</b> {h.calc}</p>}
  </>;
}

export function HelpTip({ help, label, children, className }: { help?: Help; label: string; children?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const wasOpen = useRef(false);                 // état au moment de l'appui : le focus du toucher ouvre déjà la bulle
  const id = useId();

  const show = useCallback(() => { if (closeTimer.current) window.clearTimeout(closeTimer.current); setOpen(true); }, []);
  const hideSoon = useCallback(() => { if (closeTimer.current) window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(() => setOpen(false), 120); }, []);

  useLayoutEffect(() => {
    if (!open || !btn.current || !tip.current) return;
    const b = btn.current.getBoundingClientRect(), t = tip.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight, m = 8;
    const left = Math.max(m, Math.min(b.left + b.width / 2 - t.width / 2, vw - t.width - m));
    const above = b.bottom + 6 + t.height > vh - m && b.top - 6 - t.height > m;
    setPos({ left, top: above ? b.top - 6 - t.height : b.bottom + 6, above });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const away = (e: PointerEvent) => { const n = e.target as Node; if (!btn.current?.contains(n) && !tip.current?.contains(n)) setOpen(false); };
    const off = () => setOpen(false);
    // Défilement : seulement s'il déplace la pastille (page ou conteneur parent), pas une liste voisine qui défile en direct.
    const scrolled = (e: Event) => { const t = e.target; if (t === document || (t instanceof Node && t.contains(btn.current))) setOpen(false); };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', away);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', off);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', away); window.removeEventListener('scroll', scrolled, true); window.removeEventListener('resize', off); };
  }, [open]);
  useEffect(() => { if (!open) setPos(null); }, [open]);

  return (
    <span className={`ht ${className ?? ''}`} onMouseEnter={show} onMouseLeave={hideSoon}>
      <button ref={btn} type="button" className="ht-btn" aria-label={`Explication : ${label}`} aria-expanded={open}
        aria-describedby={open ? id : undefined} data-help={label}
        onPointerDown={() => { wasOpen.current = open; }} onFocus={show} onBlur={hideSoon}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (closeTimer.current) window.clearTimeout(closeTimer.current); setOpen(!wasOpen.current); wasOpen.current = !wasOpen.current; }}>i</button>
      {open && createPortal(
        <div ref={tip} id={id} role="tooltip" className={`ht-pop${pos?.above ? ' ht-pop--above' : ''}`}
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }} onMouseEnter={show} onMouseLeave={hideSoon}>
          <p className="ht-title">{label}</p>
          {help ? <HelpBody h={help} /> : children}
        </div>, document.body)}
    </span>
  );
}
