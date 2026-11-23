// Texte du fil d'actus avec les mots surlignés (T-050).
import { segments } from './highlight';

export function Highlighted({ text, words }: { text: string; words: readonly string[] }) {
  return <>{segments(text, words).map((s, i) => (s.hit ? <mark key={i} className="news-hl">{s.text}</mark> : s.text))}</>;
}
