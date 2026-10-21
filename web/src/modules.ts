// Registre des écrans : menu latéral, URL, commande de la palette, phase.
// Chaque écran a une URL et une commande (docs/ecrans.md, règles communes).

import type { IconName } from './components/Icon';

export type Phase = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7';

export interface ModuleDef {
  id: string;
  label: string;
  section: string;
  path: string;
  icon: IconName;
  phase: Phase;
  command: string;     // grammaire TICKER FONCTION
  category: string;    // libellé à droite dans la palette
  description: string; // ligne de la palette
}

export const SECTIONS = ['Global', 'News', 'Macro', 'Positionnement & sentiment', 'Analyse', 'Compte'];

export const MODULES: ModuleDef[] = [
  { id: 'overview', label: 'Vue d’ensemble', section: 'Global', path: '/', icon: 'overview', phase: 'P0', command: 'HOME', category: 'Global', description: 'Vue d’ensemble' },
  { id: 'charts', label: 'Graphiques', section: 'Global', path: '/graphiques', icon: 'charts', phase: 'P0', command: 'BTC GP', category: 'Graphiques', description: 'Graphique BTC-USDT perpétuel' },
  { id: 'recap', label: 'Récap de session', section: 'Global', path: '/recap', icon: 'recap', phase: 'P6', command: 'RECAP', category: 'Global', description: 'Récap de session' },
  { id: 'hours', label: 'Horaires des marchés', section: 'Global', path: '/horaires', icon: 'hours', phase: 'P1', command: 'HOURS', category: 'Global', description: 'Horaires des marchés' },
  { id: 'assistant', label: 'Assistant', section: 'Global', path: '/assistant', icon: 'assistant', phase: 'P6', command: 'ASK', category: 'Global', description: 'Assistant' },
  { id: 'calendar', label: 'Calendrier', section: 'News', path: '/calendrier', icon: 'calendar', phase: 'P1', command: 'USD ECO', category: 'News', description: 'Calendrier économique' },
  { id: 'news', label: 'Fil d’actus', section: 'News', path: '/actus', icon: 'news', phase: 'P1', command: 'TOP', category: 'News', description: 'Fil d’actus' },
  { id: 'research', label: 'Recherche bancaire', section: 'News', path: '/recherche', icon: 'bank', phase: 'P7', command: 'RES', category: 'News', description: 'Recherche bancaire' },
  { id: 'squawk', label: 'Squawk', section: 'News', path: '/squawk', icon: 'squawk', phase: 'P1', command: 'SQK', category: 'News', description: 'Squawk' },
  { id: 'macro', label: 'Macro', section: 'Macro', path: '/macro', icon: 'macro', phase: 'P3', command: 'USD MACRO', category: 'Macro', description: 'Fiches macro des 8 économies' },
  { id: 'rates', label: 'Taux', section: 'Macro', path: '/taux', icon: 'rates', phase: 'P2', command: 'FED WIRP', category: 'Macro', description: 'Probabilités de taux' },
  { id: 'retail', label: 'Sentiment retail', section: 'Positionnement & sentiment', path: '/sentiment-retail', icon: 'retail', phase: 'P4', command: 'BTC LSR', category: 'Sentiment', description: 'Sentiment retail' },
  { id: 'cot', label: 'COT', section: 'Positionnement & sentiment', path: '/cot', icon: 'cot', phase: 'P4', command: 'COT', category: 'Sentiment', description: 'Rapport COT de la CFTC' },
  { id: 'bankpos', label: 'Positions des banques', section: 'Positionnement & sentiment', path: '/positions-banques', icon: 'bankpos', phase: 'P4', command: 'BPR', category: 'Sentiment', description: 'Positions des banques' },
  { id: 'risk', label: 'Sentiment de risque', section: 'Positionnement & sentiment', path: '/risque', icon: 'risk', phase: 'P4', command: 'RISK', category: 'Sentiment', description: 'Sentiment de risque' },
  { id: 'watch', label: 'Markets Watch', section: 'Analyse', path: '/markets-watch', icon: 'watch', phase: 'P1', command: 'WATCH', category: 'Analyse', description: 'Markets Watch' },
  { id: 'micro', label: 'Microstructure BTC', section: 'Analyse', path: '/microstructure', icon: 'micro', phase: 'P5', command: 'BTC BOOK', category: 'Microstructure', description: 'Microstructure BTC' },
  { id: 'season', label: 'Saisonnalité', section: 'Analyse', path: '/saisonnalite', icon: 'season', phase: 'P7', command: 'SEAS', category: 'Analyse', description: 'Saisonnalité' },
  { id: 'heatmap', label: 'Heatmap fondamentale', section: 'Analyse', path: '/heatmap', icon: 'heatmap', phase: 'P3', command: 'JPY FA', category: 'Analyse', description: 'Heatmap fondamentale' },
  { id: 'techmap', label: 'Heatmap technique', section: 'Analyse', path: '/heatmap-technique', icon: 'techmap', phase: 'P7', command: 'TECH', category: 'Analyse', description: 'Heatmap technique' },
  { id: 'indicators', label: 'Indicateurs', section: 'Analyse', path: '/indicateurs', icon: 'indicators', phase: 'P7', command: 'IND', category: 'Analyse', description: 'Indicateurs' },
  { id: 'liquidity', label: 'Liquidité', section: 'Analyse', path: '/liquidite', icon: 'liquidity', phase: 'P4', command: 'LIQ', category: 'Analyse', description: 'Liquidité nette de la Fed' },
  { id: 'track', label: 'Track record', section: 'Compte', path: '/track-record', icon: 'track', phase: 'P6', command: 'PORT', category: 'Compte', description: 'Track record' },
  { id: 'calculator', label: 'Calculateur de risque', section: 'Compte', path: '/calculateur', icon: 'calculator', phase: 'P6', command: 'CALC', category: 'Compte', description: 'Calculateur de risque' },
];

/** Écrans hors menu (paramètres, planche de référence) : le menu reste celui de la maquette. */
export const EXTRA_SCREENS = [
  { id: 'settings', path: '/parametres', command: 'SET', description: 'Paramètres · mode de fonctionnement (Online, Local, Tour)', category: 'Réglages' },
  { id: 'design-system', path: '/design-system', command: 'DS', description: 'Planche du design system', category: 'Référence' },
];

export const SETTINGS_PATH = '/parametres';

export function moduleByPath(path: string): ModuleDef | undefined {
  return MODULES.find((m) => m.path === path);
}
