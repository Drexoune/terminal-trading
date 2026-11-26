// Bulle du glossaire posée à côté d'un libellé : <Tip term="funding" label="Funding" />.
import { TERMS, type Term } from './content';
import { HelpTip } from './HelpTip';

export function Tip({ term, label }: { term: Term; label: string }) {
  return <HelpTip help={TERMS[term]} label={label} />;
}
