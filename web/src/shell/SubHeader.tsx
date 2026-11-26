import type { ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { PAGES } from '../help/content';
import { GuideButton, PageGuide, useGuide, useHelpScope } from '../help/scope';
import { useLink } from '../workspace/link';

/** Sous-en-tête (36 px) : icône, point or, titre en micro-label, bouton « Guide », curseur, puces à
 *  droite ; la case explicative de la page (help/content.ts) s'ouvre en dessous. */
export function SubHeader({ icon, title, chips }: { icon: IconName; title: string; chips?: ReactNode }) {
  const id = useHelpScope();
  const has = !!id && !!PAGES[id];
  const inWorkspace = useLink() !== null;               // dans un espace de travail : case repliée par défaut
  const [open, toggle] = useGuide(has ? id : null, inWorkspace);
  return (
    <>
      <div className="subheader">
        <Icon name={icon} size={14} className="gold" />
        <span className="dot dot--gold" />
        <h1 className="lbl">{title}</h1>
        <span className="cursor" />
        {has && <GuideButton open={open} onClick={toggle} />}
        <span className="spacer" />
        {chips}
      </div>
      {has && open && <PageGuide id={id!} />}
    </>
  );
}
