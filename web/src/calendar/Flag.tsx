// Drapeau d'une devise (design/assets/flags), ou son code quand il n'y en a pas.
import { flagCode } from './calendar';

const FLAGS = import.meta.glob('@design/assets/flags/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const byCode = Object.fromEntries(Object.entries(FLAGS).map(([path, url]) => [path.split('/').pop()!.replace('.svg', ''), url]));

export function Flag({ currency }: { currency: string }) {
  const code = flagCode(currency);
  const url = code ? byCode[code] : undefined;
  return url ? <img className="flag" src={url} alt="" width={20} height={14} /> : <span className="flag flag--none" aria-hidden="true" />;
}
