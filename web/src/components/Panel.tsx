// Panneau HUD : fond panneau, filet, coins or, en-tête 40 px avec poignée,
// losange, titre en micro-label, puces optionnelles et contrôles.
// Les contrôles sont décoratifs en P0 (la disposition libre arrive avec
// dockview) mais restent de vrais boutons étiquetés.

import type { CSSProperties, ReactNode } from 'react';
import { Icon } from './Icon';
import { IconButton } from './ui';

export type PanelControls = 'full' | 'compact' | 'none';

export function Panel({ title, label, chips, controls = 'full', children, style, bodyStyle, testId }: {
  title: string; label?: string; chips?: ReactNode; controls?: PanelControls;
  children: ReactNode; style?: CSSProperties; bodyStyle?: CSSProperties; testId?: string;
}) {
  return (
    <section className="pn" aria-label={label ?? title} style={style} data-panel={testId ?? title}>
      <div className="ph">
        <Icon name="grip" className="grip" />
        <span className="dia" />
        <h2>{title}</h2>
        {chips}
        {controls === 'full' && <>
          <IconButton icon="sliders" label="Réglages du panneau" />
          <IconButton icon="pin" label="Épingler le panneau" />
          <IconButton icon="lock" label="Verrouiller la disposition" />
          <IconButton icon="maximize" label="Agrandir le panneau" />
          <IconButton icon="close" label="Fermer le panneau" />
        </>}
        {controls === 'compact' && <>
          <IconButton icon="sliders" label="Réglages du panneau" />
          <IconButton icon="maximize" label="Agrandir le panneau" />
          <IconButton icon="close" label="Fermer le panneau" />
        </>}
      </div>
      <div style={bodyStyle}>{children}</div>
    </section>
  );
}
