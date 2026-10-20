# Maquettes

Huit écrans à 1440 px, DA noir et or, données fictives. Trois formats du même contenu :

| Dossier | Usage |
| --- | --- |
| `png/` | captures pleine page, référence visuelle à comparer avec le rendu de l'application |
| `html/` | pages statiques autonomes : ouvrir `html/Main.html` dans un navigateur ; le menu latéral relie les écrans ; polices et drapeaux sont locaux |
| `source/` | sources `.dc.html` du canvas Design : balisage avec styles en ligne, et dans le bloc `<script>` final, `renderVals()` qui génère les données d'exemple et les tracés |

| Écran | Fichier | Phase |
| --- | --- | --- |
| Vue d'ensemble | `Main` | P0 |
| Calendrier économique | `Calendrier` | P1 |
| Fil d'actus et assistant | `Actus` | P1 (fil), P6 (assistant) |
| Probabilités de taux | `Taux` | P2 |
| Heatmap fondamentale | `Heatmap` | P3 |
| Sentiment de risque | `Risque` | P4 |
| Microstructure BTC | `Microstructure` | P5 |
| Design system | `DesignSystem` | référence |

## Comment s'en servir

- Les pages statiques montrent l'état par défaut. Les interactions (filtres, onglets, sélection d'une devise, choix d'un article) sont décrites dans `docs/ecrans.md` et jouables dans le canvas en ligne (mode Play).
- Les sources `.dc.html` ne sont pas du code à copier : elles servent à lire les mesures exactes (tailles, marges, couleurs) et la forme des données de chaque panneau. L'application se construit en composants React avec `design/tokens.css`.
- Les graphiques des maquettes sont tracés à partir de séries pseudo-aléatoires déterministes (fonctions `rng`, `anch`, `spark`) : ils montrent la forme attendue, pas des données réelles.
