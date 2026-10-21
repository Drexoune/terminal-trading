import { Panel } from '../../components/Panel';
import { Chip } from '../../components/ui';
import type { ModuleDef } from '../../modules';
import { SubHeader } from '../../shell/SubHeader';

/** Écran d'une phase future : son URL et sa commande existent déjà, ses données non. */
export function PlaceholderScreen({ module }: { module: ModuleDef }) {
  return (
    <>
      <SubHeader icon={module.icon} title={module.label} chips={<Chip>{`Phase ${module.phase}`}</Chip>} />
      <div className="content">
        <Panel title={module.label} controls="none" style={{ flex: '1 1 560px' }}
          chips={<Chip variant="pending">{module.command}</Chip>}>
          <div className="placeholder" style={{ minHeight: 240 }}>
            <span className="placeholder__dash" aria-hidden="true">—</span>
            <span>Cet écran arrive en {module.phase}. Aucune donnée n’est affichée d’ici là.</span>
            <span className="lbl lbl--s">Spécification : docs/ecrans.md</span>
          </div>
        </Panel>
      </div>
    </>
  );
}
