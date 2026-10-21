// Icônes du terminal : tracés de la maquette (style Lucide, trait 1,6, 24 × 24).
// Toujours décoratives (aria-hidden) : le libellé est porté par le bouton ou le texte.

const PATHS = {
  logo: ['M3 3h18v18H3z', 'M8 17v-3M12 17v-6M16 17V8'],
  overview: ['M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'],
  charts: ['M4 19h16M5 15l4-4 3 3 6-7'],
  recap: ['M6 4h12v16H6zM9 8h6M9 12h6M9 16h4'],
  hours: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2'],
  assistant: ['M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z'],
  calendar: ['M5 6h14v14H5zM5 10h14M9 4v4M15 4v4'],
  news: ['M5 5h11v14H5zM16 8h3v9a2 2 0 0 1-2 2M8 9h5M8 12h5M8 15h3'],
  bank: ['M4 10l8-5 8 5M6 10v7M10 10v7M14 10v7M18 10v7M4 19h16'],
  squawk: ['M4 12h2M8 8v8M12 5v14M16 8v8M20 11v2'],
  macro: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18'],
  rates: ['M19 5L5 19M7 5a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM17 15a2 2 0 1 0 0 4a2 2 0 1 0 0-4z'],
  retail: ['M9 11a3 3 0 1 0 0-6a3 3 0 1 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M18 15c2 .5 3 2 3 5'],
  cot: ['M5 20V10M10 20V4M15 20v-8M20 20v-5'],
  bankpos: ['M4 8h16v11H4zM9 8V5h6v3M4 13h16'],
  risk: ['M5 17a7 7 0 1 1 14 0M12 17l3-5'],
  watch: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z'],
  micro: ['M4 6h10M4 10h14M4 14h8M4 18h12'],
  season: ['M3 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0'],
  heatmap: ['M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16'],
  techmap: ['M4 4h16v16H4zM4 12h16M12 4v16'],
  indicators: ['M3 12h4l3-7 4 14 3-7h4'],
  liquidity: ['M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z'],
  track: ['M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z'],
  calculator: ['M6 3h12v18H6zM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01M9 18h6'],
  collapse: ['M11 6l-6 6 6 6M19 6l-6 6 6 6'],
  expand: ['M13 6l6 6-6 6M5 6l6 6-6 6'],
  sliders: ['M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4'],
  search: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4-4'],
  micOff: ['M12 4a3 3 0 0 1 3 3v4M9 9v2a3 3 0 0 0 5 2.2M6 11a6 6 0 0 0 9.5 4.9M18 11a6 6 0 0 1-.3 1.9M12 17v3M4 4l16 16'],
  bell: ['M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 20a2 2 0 0 0 4 0'],
  grip: ['M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01'],
  pin: ['M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7'],
  lock: ['M7 11h10v9H7zM9 11V8a3 3 0 0 1 6 0v3'],
  maximize: ['M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7'],
  close: ['M6 6l12 12M18 6L6 18'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size, className = '', style }: {
  name: IconName; size?: number; className?: string; style?: React.CSSProperties;
}) {
  const paths = PATHS[name];
  return (
    <svg className={`ic ${className}`} viewBox="0 0 24 24" aria-hidden="true"
      style={size ? { width: size, height: size, ...style } : style}>
      {paths.map((d, i) => (
        <path key={i} d={d} style={name === 'logo' && i === 1 ? { strokeWidth: 2.4 } : undefined} />
      ))}
    </svg>
  );
}
