# TERMINAL — terminal de trading personnel · brief pour Claude Code

Ce fichier cadre le projet : périmètre, règles non négociables, stack, décisions ouvertes, ordre de construction et méthode. Il ne contient pas de signatures d'API : elles se vérifient dans la documentation officielle avant d'être écrites.

## 1. Contexte

- Terminal personnel inspiré du Bloomberg Terminal et du terminal Trade Sider. On reprend l'esprit des modules de Trade Sider, jamais son identité (nom, logo, textes, nom d'assistant).
- Un seul utilisateur, Clément. Usage strictement personnel, sans redistribution : c'est ce qui rend les sources gratuites ou « usage personnel » utilisables.
- Marchés : BTC en priorité (bot et trading manuel), les 8 devises majeures pour la lecture macro, les indices US, les ETF du PEA (Nasdaq, S&P 500).
- Machines : la tour Windows collecte et calcule 24 h/24 ; le MacBook affiche et sert au développement ; accès entre les deux par Tailscale.
- Projet voisin : le bot BTC `drexbot` (dépôt `Drexoune/drexbot`). Le terminal lit le bot, jamais l'inverse. Lire `docs/integration-drexbot.md` avant toute décision d'architecture.

## 2. Références à lire avant de coder

| Fichier | Contenu |
| --- | --- |
| `docs/plan.md` | plan complet : 24 modules, sources, formules (surprise z, scores, probabilités), architecture, roadmap, budget, risques |
| `docs/ecrans.md` | spécification écran par écran : panneaux, données, interactions, critère de fin |
| `docs/design-system.md`, `design/tokens.css` | direction artistique, tokens, composants, règles d'accessibilité |
| `design/maquettes/` | maquettes des 8 écrans : `png/` (captures 1440 px), `html/` (pages statiques), `source/` (sources `.dc.html`) |
| `docs/integration-drexbot.md` | ce qui existe dans le bot et les règles pour s'y brancher |
| `docs/prompt-demarrage.md` | prompts de lancement, phase par phase |

Les maquettes sont la référence visuelle. Leurs chiffres sont fictifs : ils servent de données de démonstration, jamais de valeurs par défaut.

## 3. Règles non négociables

- **Secrets** : aucune clé dans le code ni dans le dépôt. `.env` ignoré par git, `.env.example` documenté. Les clés restent côté serveur ; le front n'en voit aucune.
- **Aucun ordre** : le terminal ne passe jamais d'ordre. Clés d'exchange en lecture seule uniquement.
- **Sources interdites** : Yahoo Finance et Finnhub (refusées par Clément) ; niveaux de liquidation estimés (Coinglass et équivalents) ; cartes de stops inférées. Jamais d'information non publique.
- **Horodatage** : chaque donnée porte l'heure de la source et l'heure de réception. Stockage en UTC, affichage à Paris, fuseaux IANA pour les sessions, les marchés et les horloges. Aucune heure de session codée en dur en UTC.
- **Fraîcheur** : chaque widget affiche sa source et l'heure de sa dernière mise à jour. Un flux muet au-delà de son seuil passe en « périmé » et déclenche une alerte.
- **IA** : l'assistant, les traductions et les lectures ne reçoivent que nos données, citent chaque chiffre et ne calculent rien eux-mêmes. Sorties mises en cache ; plus petit modèle suffisant pour la traduction.
- **Données manquantes** : afficher « — » avec la raison, jamais une valeur inventée ou une valeur de maquette.
- **drexbot** : lecture seule, pas de collecteur en double, ressources des services du terminal plafonnées sur la tour.
- **Robustesse** : reconnexion avec délai croissant, journal des trous, arrêt propre, redémarrage automatique des services.

## 4. Stack visée (plan du 19/10/2026)

- **Front** : React + Vite + TypeScript ; dockview pour les panneaux, Lightweight Charts, TanStack Table, cmdk pour la palette de commandes ; décodage des messages dans un Web Worker ; rendu plafonné à 10–20 images/s. Tauri plus tard, pour détacher un panneau dans sa fenêtre.
- **Passerelle** : FastAPI ; une seule WebSocket multiplexée (instantané à l'abonnement, puis changements seuls) + REST.
- **Collecteurs et services** : Python asyncio ; bibliothèques officielles ou ccxt selon ce que la documentation de chaque plateforme recommande.
- **Stockage et bus** : voir les décisions 2 et 3 ci-dessous.
- **Tests** : pytest côté Python, Vitest et Playwright côté front.

## 5. Décisions à faire confirmer par Clément avant d'écrire P0

Présenter chaque point avec la recommandation, attendre sa réponse, puis consigner la décision datée dans `docs/decisions.md`.

1. **Système de la tour.** `drexbot/docs/deploiement.md` décrit du Python natif Windows, sans WSL ; le plan et d'autres documents parlent de WSL2. Recommandation : suivre drexbot (Windows natif) pour ne gérer qu'un seul environnement sur la tour.
2. **Bus.** Le plan prévoit Redis Streams, qui n'a pas de version Windows officielle. Recommandation : en P0, diffusion en mémoire dans la passerelle (un seul process asyncio, dernier état en mémoire) ; un bus externe (NATS, natif sous Windows, ou Redis via WSL) seulement quand un deuxième consommateur l'exige.
3. **Stockage.** Le plan prévoit QuestDB (ticks), Postgres (le reste) et Parquet (archive) ; drexbot a choisi DuckDB + Parquet sans base serveur. Recommandation : Parquet + DuckDB pour l'historique, SQLite pour les tables relationnelles (`releases`, `meetings`, `probabilities`, `alerts`, `news`…), et une base serveur seulement si un besoin mesuré apparaît.
4. **Où tourne le front** : servi par la passerelle sur la tour (accessible depuis le Mac et le téléphone via Tailscale) ou lancé sur le Mac en développement. Recommandation : les deux, avec la même configuration.
5. **Watchlist hors crypto et ETF du PEA** : source gratuite à retenir pour les indices, le DXY, les taux, l'or, les changes et les ETF cotés à Paris (XTB n'a plus d'API). Ne pas bloquer P0 dessus : la crypto d'abord.
6. **Noms définitifs** du terminal et de l'assistant (provisoires : TERMINAL et « Assistant »).

## 6. Ordre de construction

Une phase à la fois. Chaque phase est utilisable seule et se termine par une porte ; on ne commence pas la suivante avant de l'avoir passée.

| Phase | Contenu | Porte de sortie |
| --- | --- | --- |
| P0 — Socle temps réel | dépôt, design system en code, coque, collecteur OKX, passerelle, palette de commandes, watchlist, graphique BTC, horloges | BTC en direct à l'écran, latence affichée |
| P1 — Calendrier et actus | agenda et consensus, capture des chiffres US à la source, publications enregistrées, fil d'actus traduit, squawk, alertes | le CPI US capté et affiché en moins d'une seconde |
| P2 — Taux | écran Taux : Polymarket et Kalshi, trajectoire, historique des cotes, votes des comités | probabilités de la prochaine réunion de la Fed mises à jour chaque minute |
| P3 — Macro et heatmap | fiches des 8 économies, backfill DBnomics et BIS, scores relatifs, comparateur de paire, lecture IA | score testé sur l'historique avant de s'en servir |
| P4 — Sentiment et liquidité | jauge de risque, COT, positions des banques, ratios long/short, liquidité nette de la Fed | chaque widget affiche sa source et sa fraîcheur |
| P5 — Microstructure BTC | carnet agrégé, carte de profondeur, CVD spot / perp, liquidations multi-plateformes, funding, OI | une séance entière suivie depuis le seul terminal |
| P6 — Assistant et compte | questions sur les articles, récap de session, voix, journal, positions OKX en lecture, calculateur de risque | l'assistant ne cite que nos données, sources à l'appui |
| P7 — Extras | recherche bancaire, saisonnalité, heatmap technique, options Deribit, probabilités via les futures | seulement si un vrai besoin apparaît |

### Première tâche : P0

1. **Dépôt** : `web/` (React + Vite + TS), `gateway/` (FastAPI), `collectors/` (Python), `docs/decisions.md` ; `.env.example`, README de lancement, une commande pour tout démarrer en local.
2. **Design system en code** : `design/tokens.css` importé une fois, polices locales de `design/assets/fonts/`, composants de base (Panneau, Bouton, Puce, Bascule, Pastille, Cellule, Sparkline, Jauge), coque complète (barre du haut, menu latéral, sous-en-tête, barre de flux) fidèle à `design/maquettes/png/Main.png`.
3. **Flux** : collecteur OKX BTC-USDT perpétuel (trades, ticker, funding, open interest) → passerelle → WebSocket → front, latence mesurée de bout en bout et affichée dans la barre du haut.
4. **Écran Vue d'ensemble** : panneau BTC (prix, statistiques 24 h, graphique intraday avec bandes de session, PDH / PDL, VWAP), watchlist (crypto d'abord), horloges TOK / LON / PAR / NY calculées depuis l'UTC.
5. **Palette de commandes** (Ctrl K) : au moins `BTC GP` et la navigation entre écrans.

Porte P0 : BTC en direct, latence affichée, horloges justes au passage à l'heure d'hiver (25/10/2026 en Europe, 01/11/2026 aux États-Unis).

## 7. Méthode de travail

- Commencer chaque phase en mode plan : découpage, fichiers, tests ; attendre l'accord de Clément avant d'écrire.
- Vérifier chaque endpoint, format de message et limite de débit dans la documentation officielle. En cas de doute, écrire un petit script d'exploration qui affiche la réponse réelle (comme `scripts/explore_*.py` dans drexbot) plutôt que de deviner.
- Après chaque tâche d'interface : lancer le front, capturer l'écran à 1440 px avec Playwright, le comparer au PNG de la maquette et corriger les écarts de mise en page avant de passer à la suite. Vérifier aussi la largeur 390 px (aucun défilement horizontal).
- Tests prioritaires : reconnexion et trous de séquence, fuseaux et changements d'heure, surprise z, probabilités de taux, scores relatifs, absence de clé dans le bundle du front.
- Pas de commit ni de push sans demande de Clément. Messages de commit en français.
- Langue : interface et documentation en français ; code, identifiants et noms de fichiers techniques en anglais. Nombres au format `fr-FR` (virgule décimale, espace insécable avant les unités, signe moins « − »).
