# Spécification des écrans

Huit maquettes haute fidélité, toutes à 1440 px de large, données fictives. Pour chaque écran : `design/maquettes/png/<Nom>.png` (capture), `design/maquettes/html/<Nom>.html` (page statique ouvrable dans un navigateur, liens entre écrans actifs) et `design/maquettes/source/<Nom>.dc.html` (source : balisage, styles en ligne et données d'exemple dans `renderVals()`).

Les maquettes fixent la mise en page, la hiérarchie et les composants. Les chiffres qu'elles contiennent sont inventés : ils servent de jeu de données de démonstration, jamais de valeurs par défaut en production.

Règles communes à tous les écrans :

- Coque identique partout : barre du haut, menu latéral, sous-en-tête, barre de flux en pied de page (voir `docs/design-system.md`).
- Chaque widget affiche sa source et l'heure de sa dernière mise à jour ; au-delà d'un seuil propre à la source, badge « périmé ».
- Heures affichées à Paris, stockées en UTC ; fuseaux IANA pour les sessions et les marchés.
- Chaque écran a une commande dans la palette (Ctrl K) et une URL.

## 1. Vue d'ensemble — `Main` · phase P0 (+ widgets des phases suivantes)

Page d'accueil : ce qui bouge maintenant et ce qui arrive.

| Panneau | Contenu | Données et source | Phase |
| --- | --- | --- | --- |
| BTC-USDT perpétuel | dernier prix (Rajdhani 48 px, or), variation 24 h, haut / bas 24 h, funding 8 h, open interest, volume 24 h ; graphique intraday 00:00–24:00 UTC avec bandes de session Asie / Londres / New York, PDH / PDL en pointillés, VWAP ; boutons 1 J / 5 J / 1 M | WebSocket OKX (trades, ticker, funding, OI) ; agrégats multi-plateformes ensuite | P0 |
| Watchlist | 11 lignes : actif, sous-titre, dernier, variation jour, sparkline de séance, état du marché | crypto : OKX ; autres actifs : source gratuite à choisir en P0 (jamais Yahoo ni Finnhub) ; ETF du PEA : voir décision 5 de `CLAUDE.md` | P0 |
| Prochains événements | 5 publications à venir : drapeau, libellé, devise, date et heure, impact (3 barres), compte à rebours J-n ; lien vers le calendrier | table `releases` | P1 |
| Sentiment de risque | mini-jauge 0–100, pastille de zone, variations 1 S et 1 M ; lien vers l'écran détaillé | service de score de risque | P4 |
| Alertes actives | règle, catégorie, état (Armée / Déclenchée hh:mm) | table `alerts` | P1 |
| Titres urgents | 4 derniers titres à fort impact : heure, catégorie, titre traduit ; lien vers le fil d'actus | table `news` | P1 |

Interactions : période du graphique ; clic sur un événement → calendrier filtré ; clic sur un titre → article. Fini quand : le prix BTC se met à jour en direct, la latence est affichée dans la barre du haut, et les horloges sont justes à travers les changements d'heure (Europe le 25/10/2026, États-Unis le 01/11/2026).

## 2. Calendrier économique — `Calendrier` · phase P1

| Zone | Contenu |
| --- | --- |
| Barre d'outils | semaine précédente / suivante, filtres devises (bascules avec drapeau), filtres impact Fort / Moyen / Faible, recherche d'indicateur |
| Publications de la semaine | groupées par jour (« Aujourd'hui » marqué) ; colonnes heure, devise, impact, événement, réel, consensus, précédent, surprise z. Ligne « Nouveau » sur fond sélection pendant 15 min après une publication. Ligne « En attente » avec compte à rebours jusqu'à la publication. Réel en cyan ou corail selon la surprise. |
| Fiche indicateur | indicateur sélectionné : réel (chiffre clé), consensus, précédent, surprise ; barres des publications sur 5 ans par date de publication avec la cible de 2 % ; trou explicite quand une publication n'a pas eu lieu (novembre 2025, shutdown) ; table des publications enregistrées (date, réel, consensus, z) |
| Réaction BTC | prix BTC de −5 à +30 min autour de la dernière publication de l'indicateur, variation à +30 min |

Données : agenda + consensus (flux ForexFactory), chiffre réel capté à la source (BLS, BEA, Eurostat, INSEE…), table `releases` avec première publication et révisions séparées. Surprise : z = (réel − consensus) / σ des surprises passées du même indicateur. Fini quand : la porte de P1 est passée (CPI US capté et affiché en moins d'une seconde après publication), et chaque ligne garde son heure de capture.

## 3. Fil d'actus et assistant — `Actus` · phases P1 (fil) et P6 (assistant)

Trois colonnes à 1440 px (elles s'empilent en dessous) :

- **Fil** : catégories en bascules (Tout, Banque centrale, Macro, Crypto, Matières premières), filtre texte, liste des titres (heure, catégorie, « Fort impact », titre traduit, type de source). L'élément ouvert est surligné.
- **Lecture** : catégorie, source, date, heure, temps de lecture, titre, image (emplacement), corps traduit, encadré « Points clés », actifs liés avec leur variation.
- **Assistant** : orbe or, puces « Article chargé » et « Muet », conversation (questions de l'utilisateur à droite, réponses à gauche avec puces-sources qui renvoient vers l'article ou vers un autre écran), suggestions, champ de saisie avec bouton d'envoi or.

Règles : traduction titre par titre (pas de phrases collées) ; l'assistant ne reçoit que nos données, cite chaque chiffre et n'effectue aucun calcul lui-même ; mention « à vérifier » sous ses réponses. Fini quand : la porte de P6 est passée, et un titre urgent apparaît dans le fil en moins de 2 s après sa réception.

## 4. Probabilités de taux — `Taux` · phase P2

| Zone | Contenu |
| --- | --- |
| Onglets | FED, BCE, BOE, BOJ, BNS, BOC, RBA, RBNZ ; en-tête : nom de la banque, taux actuel (chiffre clé), fourchette ou libellé du taux, prochaine réunion et J-n |
| Trajectoire implicite | taux attendu à chacune des 10 prochaines réunions (marches or + valeurs), taux actuel en pointillés ; en dessous, variation attendue par réunion en points de base (barres cyan / corail autour de zéro) |
| Prochaine réunion | barres groupées par issue (−25 pb, statu quo, +25 pb), une couleur par source (futures, Polymarket, Kalshi), « — » quand un marché n'est pas coté ; puce d'écart maximal entre sources avec le seuil d'alerte ; note de méthode |
| Évolution des probabilités | 60 jours, statu quo et principale alternative, publications clés marquées (NFP, IPC) |
| Comités et votes | par banque : dernière décision, répartition des votes et dissidents, date de décision, prochaine réunion ; la ligne de l'onglet actif est surlignée |

Données : Polymarket et Kalshi (gratuits) d'abord, calcul maison via les futures plus tard ; instantané enregistré chaque minute (table `probabilities`). Probabilité futures d'un mouvement de 25 pb = (taux implicite − taux actuel) / 0,25. Fini quand : les probabilités de la prochaine réunion de la Fed se mettent à jour chaque minute et l'alerte d'écart entre sources fonctionne.

## 5. Heatmap fondamentale — `Heatmap` · phase P3

| Zone | Contenu |
| --- | --- |
| Classement relatif | 8 devises triées par score (−100 à +100, somme nulle) : rang, drapeau, code, barre divergente autour de zéro, score, biais. Clic = sélection. |
| Fiche devise | banque centrale, taux directeur (chiffre clé), précédent et date, dernier mouvement (HIKE / CUT / STATU QUO), prochaine réunion ; règle inflation (IPC et sous-jacente contre la cible) ; graphique 10 ans taux directeur (marches cyan) et inflation (or) avec la cible en pointillés |
| Matrice | devises × thèmes (taux, inflation, croissance, emploi, activité, sentiment, surprises) : valeur dans chaque cellule, couleur sur 5 niveaux relatifs aux 7 autres devises ; colonne biais ; clic sur une devise = sélection |
| Lecture fondamentale | 4 à 6 lignes rédigées par l'assistant à partir des seuls chiffres affichés, datées |
| Paire | devise sélectionnée contre l'USD (contre l'EUR si l'USD est sélectionné) : 7 indicateurs, écart coloré selon qu'il favorise l'une ou l'autre, verdict |

Score : z = (x − moyenne des 8) / σ par thème, somme pondérée, ramenée à ±100 ; biais relatif (3 meilleures BULLISH, 3 dernières BEARISH, 2 NEUTRAL). Porte P3 : le score est testé sur l'historique avant de servir à décider ; tant que ce n'est pas fait, l'écran l'indique.

## 6. Sentiment de risque — `Risque` · phase P4

- **Indice composite** : grande jauge 0–100 en 5 zones, valeur, pastille, repère pointillé de la valeur d'il y a une semaine, variations 1 S et 1 M, légende des zones.
- **Composantes** : 7 lignes (VIX, tendance actions, crédit, AUD/JPY, cuivre / or, actions contre refuge, momentum crypto) avec description, valeur brute, barre de percentile sur 1 an (252 séances) et percentile ; ligne MOYENNE = l'indice.
- **Historique** : l'indice sur 1 M / 3 M / 1 A (bascules) sur fond des 5 zones, dernière valeur étiquetée.
- **S&P 500 et VIX sur 1 an** : niveau, variation, seuils VIX 20 et 30 en pointillés.

Données : FRED (VIX, S&P 500, crédit), changes, matières premières, exchanges pour la crypto. Fini quand : chaque composante affiche sa source et sa fraîcheur, et l'indice se recalcule à la clôture.

## 7. Microstructure BTC — `Microstructure` · phase P5

| Zone | Contenu |
| --- | --- |
| Carte de profondeur | 60 min × prix, liquidité au repos en 4 niveaux d'or, prix en blanc, bulles d'achats et de ventes agressifs (taille = volume), annotation des murs retirés (taille, prix, heure) |
| Carnet d'ordres agrégé | 10 niveaux de chaque côté au pas de 10 $, taille et cumul, barres de profondeur, dernier prix et spread au milieu, déséquilibre sur 10 niveaux |
| CVD spot contre perpétuel | 4 h, deux courbes, puce « Divergence » et phrase de lecture quand elles divergent |
| Liquidations | flux 1 h : heure, plateforme, côté, montant, prix ; lignes ≥ 10 M$ surlignées ; totaux longs / shorts. Note obligatoire : Binance ne diffuse qu'une liquidation par symbole et par seconde, son total est un minimum. |
| Funding et open interest | OKX, Binance, Bybit, Hyperliquid + total : funding ramené à 8 h (Hyperliquid paie toutes les heures), prochain paiement, OI, variation 24 h, prime perp / spot |

Données : WebSockets des plateformes. Fini quand : une séance entière se suit depuis ce seul écran, sans interruption de flux non signalée.

## 8. Design system — `DesignSystem`

Planche de référence, pas un écran de l'application : couleurs, typographie, boutons, puces, cellules, sous-en-tête, panneau, jauge, barre de percentile, infobulle, sparkline, statuts de flux, palette de commandes. À reproduire en composants React réutilisables (voir `docs/design-system.md`).
