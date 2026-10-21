import type { ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';

/** Sous-en-tête (36 px) : icône, point or, titre en micro-label, curseur, puces à droite. */
export function SubHeader({ icon, title, chips }: { icon: IconName; title: string; chips?: ReactNode }) {
  return (
    <div className="subheader">
      <Icon name={icon} size={14} className="gold" />
      <span className="dot dot--gold" />
      <h1 className="lbl">{title}</h1>
      <span className="cursor" />
      <span className="spacer" />
      {chips}
    </div>
  );
}
