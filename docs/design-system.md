# Design system — TERMINAL

DA noir et or façon HUD : fond noir, un seul accent or, cyan pour ce qui monte, corail pour ce qui baisse, neutres chauds. Les valeurs exactes sont dans `design/tokens.css` (et `design/tokens.json`). Les maquettes de `design/maquettes/` montrent chaque composant en situation.

Règle de base : **aucune couleur, taille ou police en dur dans les composants**. Tout passe par les variables CSS de `tokens.css`. Si un besoin manque, on ajoute un token, on ne contourne pas.

## Couleurs

| Rôle | Token | Valeur | Usage |
| --- | --- | --- | --- |
| Fond | `--bg-app` | #000000 | arrière-plan |
| Chrome | `--bg-chrome` | #050504 | barre du haut, menu, sous-en-têtes, barre de flux |
| Panneau | `--bg-panel` | #0A0A09 | surface des modules |
| Panneau 2 | `--bg-panel-2` | #121110 | survol, champs, infobulles, en-têtes de groupe |
| Sélection | `--bg-selected` | #16130A | ligne ou élément sélectionné |
| Filet | `--line` | #22201E | bordures, séparateurs |
| Filet fort | `--line-strong` | #3A3835 | contours de boutons, puces, champs |
| Or | `--gold` | #E4C24A | accent, actif, prix, liens |
| Or vif | `--gold-hi` | #F6D44E | chiffres clés, survol |
| Or moyen | `--gold-mid` | #8A7533 | coins HUD, contours actifs |
| Or profond | `--gold-deep` | #2B2511 | fonds teintés, sélection |
| Hausse | `--up` | #5CCBE3 | variations positives, au-dessus de l'attendu |
| Baisse | `--down` | #D95B55 | variations négatives, en dessous de l'attendu |
| Texte 1 | `--text-1` | #EDEAE6 | titres et valeurs |
| Texte 2 | `--text-2` | #ABA7A2 | secondaire |
| Texte 3 | `--text-3` | #85817A | micro-labels, minimum 4,5:1 sur panneau |

Contraintes :

- Texte ≥ 4,5:1 partout, y compris les labels de 10–11 px. `--text-3` est le gris le plus clair autorisé pour du texte ; jamais sur `--gold-deep` (3,9:1).
- La couleur ne porte jamais seule l'information : toujours une flèche (▲ ▼), un signe (+ / −) ou un mot (BULLISH, RISK-OFF).
- Les cellules de heatmap ont cinq niveaux (`--cell-*`), du corail profond au cyan franc ; les niveaux diffèrent aussi en luminosité, pas seulement en teinte.

## Typographie

| Usage | Police | Taille / graisse | Détail |
| --- | --- | --- | --- |
| Chiffre clé | Rajdhani | 48–64 px / 600 | `--gold-hi`, chiffres tabulaires |
| Titre d'écran, logo | Rajdhani | 20–28 px / 700 | capitales, interlettrage .12–.16 em |
| Titre d'article | Barlow | 22–27 px / 600 | |
| Texte courant | Barlow | 14–15,5 px / 400–500 | interligne 1,5–1,65 |
| Micro-label | JetBrains Mono | 10–11 px / 500 | capitales, interlettrage .16 em, `--text-3` |
| Données | JetBrains Mono | 12–13 px / 400–700 | chiffres tabulaires, alignés à droite |

Polices locales dans `design/assets/fonts/` (licence SIL OFL), ou Google Fonts. Format des nombres : `fr-FR` (virgule décimale, espace fine pour les milliers, espace insécable avant %, M$, Md$, pb). Signe moins typographique « − ».

## Disposition

- **Barre du haut (56 px)** : bloc logo de la largeur du menu (248 px, dégradé or très sombre), bouton Assistant avec orbe or, micro, Personnaliser, barre de commande (Ctrl K), horloges TOK / LON / PAR / NY (point or = marché ouvert, NY en or quand la séance US est ouverte), heure UTC, latence du flux principal, cloche, avatar.
- **Menu latéral (248 px)** : sections GLOBAL, NEWS, MACRO, POSITIONNEMENT & SENTIMENT, ANALYSE, COMPTE. Élément actif : texte or, filet or de 2 px à gauche, fond dégradé `--gold-deep` → transparent. Bouton « Réduire » en tête.
- **Sous-en-tête (36 px)** : icône, point or, titre en micro-label, curseur or plein, puis à droite une puce or arrondie (contexte) et une puce neutre (état).
- **Zone de contenu** : panneaux séparés de 12 px, marge 16 px. Barre de flux en pied de page (sources connectées, dernière synchro).
- **Responsive** : menu + contenu dans une rangée `flex-wrap` (contenu `flex: 999 1 560px; min-width: 0`), donc le menu passe au-dessus sur téléphone ; les barres d'outils passent à la ligne ; les tableaux larges défilent dans une boîte `overflow-x: auto`. Aucune barre de défilement horizontale sur la page à 390 px.

## Composants

À construire une fois et réutiliser partout. Chaque composant a ses états : chargement, vide, erreur, source périmée.

| Composant | Spécification |
| --- | --- |
| Panneau | fond `--bg-panel`, filet 1 px `--line`, rayon 3 px, coins HUD or (10 px, haut-gauche et bas-droite). En-tête 40 px : poignée (6 points, décor), losange or 6 px, titre en micro-label, puces optionnelles, contrôles (réglages, épingler, verrouiller, agrandir, fermer) en boutons icônes de 28 px avec `aria-label`. |
| Bouton | 34 px de haut, rayon 3 px. Principal : fond or, texte noir (une action principale par écran au plus). Secondaire : contour `--line-strong`. Fantôme : texte or. Survol : contour `--gold-mid`, texte `--gold-hi`. |
| Puce | 22 px, mono 10 px capitales. Variantes : neutre, active (or), temps réel (cyan avec point), baisse (corail), « Nouveau » (fond or), « En attente » (pointillés + compte à rebours). |
| Bascule | puce cliquable avec `aria-pressed` ; état pressé : fond `--gold-deep`, contour `--gold-mid`, texte `--gold-hi`. |
| Pastille de biais | 24 px, rayon 12 px : BULLISH, NEUTRAL, BEARISH, RISK-OFF. |
| Cellule d'état | 40 px de haut, mono 12,5 px gras, cinq niveaux `--cell-*`. Sélection : contour or 1 px décalé de 2 px. |
| Surprise z | cellule 56 × 24 px, `+0,8` / `−1,9` / `0,0`, couleur selon le signe au-delà de ±0,25. |
| Jauge 0–100 | demi-cercle en 5 zones (`--gauge-1…5`), aiguille `--text-1`, repère pointillé de la valeur précédente. |
| Barre de percentile | 10 px, remplissage coloré par zone, repère central à 50. |
| Sparkline | 28 px de haut, trait 1,4 px, cyan si la variation est positive, corail sinon. |
| Infobulle de graphique | fond `--bg-panel-2`, contour `--gold-mid`, titre micro-label or, grille de valeurs mono. |
| Palette de commandes | Ctrl K ou « / ». Grammaire TICKER FONCTION (`BTC GP`, `USD ECO`, `FED WIRP`, `JPY FA`, `BTC BOOK`). Ligne active : fond `--gold-deep`, filet or à gauche. Pied : ↑ ↓ naviguer, Entrée ouvrir, Maj + Entrée nouveau panneau. |
| Statut de flux | point cyan connecté, or retard > 2 s, corail déconnecté ; toujours accompagné du nom de la source. |

## Graphiques

- Lightweight Charts pour les séries de prix ; SVG maison (ou une petite lib) pour les jauges, barres et heatmaps.
- Fond du graphique = fond du panneau ; grille `--line` ; axes en mono 10–11 px `--text-3` ; dernière valeur dans une étiquette pleine (or pour le prix, `--text-1` pour la microstructure).
- Bandes de session (Asie, Londres, New York) en aplats à 4–6 % d'opacité, calculées en fuseaux IANA, jamais en heures UTC codées en dur.
- Les niveaux de référence (PDH / PDL, cible d'inflation, seuils VIX 20 / 30) sont en pointillés avec leur libellé.
- Rafraîchissement d'écran plafonné à 10–20 images/s ; flash de 300 ms sur changement de prix.

## Accessibilité et icônes

- Vrais `<button>`, `<a href>`, `<input>` + `<label>` ; `aria-label` sur chaque bouton icône ; `aria-pressed` sur les bascules ; `aria-current="page"` sur l'entrée de menu active.
- Icônes : trait 1,6 px, 24 × 24, style Lucide (`lucide-react` convient). Pas d'emoji. Les SVG décoratifs portent `aria-hidden="true"`.
- Cibles de clic : 34 px minimum pour les contrôles principaux ; les contrôles de panneau à 28 px sont acceptés sur desktop.

## Identité

- Nom provisoire **TERMINAL**, logo original (trois barres montantes dans un cadre, or). Rien de Trade Sider : ni nom, ni logo, ni textes, ni nom d'assistant.
- Interface en français ; jargon de marché en anglais quand c'est l'usage (BULLISH, RISK-OFF, perp, funding, open interest).
