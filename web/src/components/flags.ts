// Drapeaux (design/assets/flags/<code>.svg) : URL d'un drapeau par code ISO, ou undefined.
const FLAGS = import.meta.glob('@design/assets/flags/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const BY_CODE = Object.fromEntries(Object.entries(FLAGS).map(([p, url]) => [p.split('/').pop()!.replace('.svg', ''), url]));

export const flagUrl = (code: string): string | undefined => BY_CODE[code];
