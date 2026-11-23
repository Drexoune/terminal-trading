# Journal des décisions

Chaque décision est datée et ne se modifie pas après coup. Une décision qui change donne lieu à une nouvelle entrée qui remplace l'ancienne et la cite.

| ID | Date | Sujet | Décision |
| --- | --- | --- | --- |
| T-000 | 19/10/2026 | Dépôt | Le terminal vit dans un dépôt séparé `Drexoune/terminal-trading`, jamais dans drexbot |
| T-001 | 19/10/2026 | Système de la tour | Windows natif, Python sans WSL, comme drexbot |
| T-002 | 19/10/2026 | Bus | Diffusion en mémoire dans la passerelle en P0 ; bus externe (NATS) seulement si un deuxième consommateur l'exige |
| T-003 | 19/10/2026 | Stockage | Parquet + DuckDB pour l'historique, SQLite pour les tables relationnelles, pas de base serveur |
| T-004 | 19/10/2026 | Hébergement du front | Front déployé sur Vercel ; passerelle sur la tour |
| T-005 | 19/10/2026 | Watchlist hors crypto | Reportée à P1 ; « — » en P0 |
| T-006 | 19/10/2026 | Noms | TERMINAL et « Assistant » restent provisoires |
| T-007 | 20/10/2026 | Plan P0 | Plan P0 validé par Clément ; dockview reporté à P1 |
| T-008 | 20/10/2026 | Domaine OKX | Domaine EEA (`eea.okx.com`, `wseea.okx.com`) par défaut |
| T-009 | 20/10/2026 | Bandes de session | Valeurs de la maquette : Asie 09:00–15:00 Tokyo, Londres 08:00–16:30, New York 09:30–16:00 |
| T-010 | 20/10/2026 | Panneau BTC | Open interest et volume d'OKX seul, volume en BTC |
| T-011 | 20/10/2026 | Modes de fonctionnement | Trois modes, Online, Local et Tour, choisis par appareil dans l'écran Paramètres ; remplace `VITE_GATEWAY_URL` de T-004 |
| T-012 | 20/10/2026 | Supabase | Pour le Mode Online seulement : collecteur planifié et journal dans un projet dédié en Europe ; exception assumée à T-003 ; aucune clé dans le front |
| T-013 | 20/10/2026 | Fonctions Vercel | Proxy du REST OKX (qui refuse le CORS) en région Europe ; temps réel du Mode Online lu par le navigateur |
| T-014 | 20/10/2026 | Mode Local | Passerelle sur le Mac, par `scripts/dev.py` ou par un agent launchd utilisateur |
| T-015 | 11/11/2026 | Porte P1 | Moins d'1 s entre la première mise en ligne observée sur bls.gov et l'affichage ; délai total depuis 08:30 mesuré et affiché. Visée : CPI de novembre, le 10/12/2026 |
| T-016 | 11/11/2026 | Capture des chiffres | Le Mac capte en Mode Local et fait foi pour la porte ; la tour prendra le relais plus tard |
| T-017 | 11/11/2026 | P1 en Mode Online | Supabase relève seul l'agenda ForexFactory chaque heure ; ni capture ni fil d'actus en Mode Online |
| T-018 | 11/11/2026 | Archive ForexFactory | Archive privée de nos relevés, jamais exposée ; aucun jeu tiers ; z à partir de 8 publications |
| T-019 | 11/11/2026 | Traduction | Pas de traduction en P1 : titres dans leur langue d'origine |
| T-020 | 11/11/2026 | Alertes sur le téléphone | Bot Telegram, envoyé par la passerelle du Mac |
| T-021 | 11/11/2026 | Tree of Alpha | Flux gratuit sans clé, mesuré avant tout abonnement |
| T-022 | 11/11/2026 | Chiffre provisoire | Un chiffre tiré du fil d'actus s'affiche « provisoire · fil d'actus » avant celui du BLS, jamais à sa place |
| T-023 | 11/11/2026 | Identité auprès du BLS | Adresse e-mail dédiée dans le User-Agent ; pas de clé API v2 |
| T-024 | 11/11/2026 | Exploration P1 | Scripts d'exploration lancés sur le Mac |
| T-025 | 11/11/2026 | Périmètre P1 | dockview, écrans HOURS et WATCH après la porte ; « Points clés » en P6 |
| T-026 | 11/11/2026 | Plan P1 | Plan P1 révisé (`docs/plan-p1.md`) validé par Clément ; E0 commence par la rafale sur le PPI du 13/11 |
| T-027 | 19/11/2026 | Priorité du module Bourse | B0 et B1 maintenant, en parallèle de P1 ; P1 prioritaire autour du 04/12 et du 10/12 ; B2 à B4 après le 10/12 |
| T-028 | 19/11/2026 | Couverture des données boursières | Sources gratuites d'abord : ~8 000 sociétés US (SEC), Europe partielle (ESEF) ; abonnement plus tard si besoin |
| T-029 | 19/11/2026 | LLM du module Bourse | Gemini, palier gratuit, clé `GEMINI_API_KEY` côté serveur ; documents publics seulement ; risque des conditions de Google assumé |
| T-030 | 19/11/2026 | Avis sur X | Abandonné : pas de Grok, aucune source gratuite |
| T-031 | 19/11/2026 | Stockage et accès du module Bourse | Tables Supabase privées lues par les fonctions Vercel ; protection Vercel et mot de passe d'application ; extension de T-012 |
| T-032 | 19/11/2026 | Données du Trading Desk | Import unique des lignes du PEA et des liquidités ; l'artefact reste en lecture |
| T-033 | 19/11/2026 | Écrans Bourse | Conçus directement avec le design system, sans maquette ; captures à 1 440 et 390 px |
| T-034 | 19/11/2026 | Note de l'action | Percentiles descriptifs sur quatre axes, détail affiché, marquée « non testée » |
| T-035 | 19/11/2026 | Calendrier P1 révisé | Rafale de mesure sur le rapport emploi du 04/12 ; répétition sur la productivité du 08/12 ; porte inchangée le 10/12 |
| T-036 | 19/11/2026 | Plan Bourse | Plan révisé (`docs/plan-bourse.md`) validé par Clément ; B0 commence par son plan détaillé |
| T-037 | 19/11/2026 | Plan B0 | Validé : exploration en ligne, session de 30 jours, porte sur les lignes du portefeuille ; menu Bourse repliable |
| T-038 | 20/11/2026 | Plan B1 | Courtier XTB ; PEA et CTO ; performances depuis le 28/09/2026 ; benchmarks MSCI World et S&P 500 ; ventilation des ETF affichée |
| T-039 | 20/11/2026 | Réalisation de B1 | Valorisation à la demande, import Baggr validé côté serveur, TRI non annualisé sous un an, rattrapage US par Tiingo |
| T-040 | 23/11/2026 | Rattrapage d'une capture manquée | Relecture du communiqué (`.nr0`, page complète, copie archivée à la date) par le même parseur ; l'API v1 seulement si la page reste illisible, chiffre marqué « recalculé » ; révisions par l'API v1 |

## T-000 — Dépôt séparé · 19/10/2026

**Contexte.** La session de travail était ouverte dans le dépôt drexbot. `docs/integration-drexbot.md` (règle 1) impose un dépôt séparé.

**Décision.** Code, docs et design du terminal dans `Drexoune/terminal-trading`. Aucune modification de drexbot depuis ce projet.

## T-001 — Système de la tour · 19/10/2026

**Contexte.** `drexbot/docs/deploiement.md` décrit une tour Windows en Python 3.14 natif, sans WSL, supervisée par tâches planifiées et `superviser-service.ps1`. `drexbot/CLAUDE.md` (macOS) et `drexbot/dashboard/README.md` (WSL2) sont en retard sur ce document.

**Décision.** Les services du terminal tournent en **Python natif sous Windows**, sans WSL. Le code reste portable (macOS pour le développement).

**Conséquences.** Supervision calquée sur les patrons de drexbot (superviseur, fichier d'arrêt, contrôle d'horloge). Aucune dépendance qui exige Linux.

## T-002 — Bus · 19/10/2026

**Contexte.** Le plan prévoyait Redis Streams, sans version Windows officielle.

**Décision.** En P0, le collecteur OKX tourne dans le process asyncio de la passerelle. Celle-ci garde le dernier état en mémoire et le diffuse aux clients WebSocket. Le bus est une interface abstraite. Un bus externe (NATS, natif sous Windows) n'arrive que lorsqu'un deuxième consommateur l'exige.

**Conséquences.** Un crash de la passerelle coupe aussi le collecteur d'affichage. C'est acceptable : ce flux sert l'écran et n'alimente aucun historique de référence (drexbot garde le sien).

## T-003 — Stockage · 19/10/2026

**Décision.** Parquet + DuckDB pour l'historique (ticks, bougies), SQLite pour les tables relationnelles (`releases`, `meetings`, `probabilities`, `alerts`, `news`…). On n'ajoute une base serveur que sur un besoin mesuré.

## T-004 — Hébergement du front · 19/10/2026

**Recommandation présentée.** Front servi par la passerelle sur la tour, et lancé sur le Mac en développement.

**Décision de Clément.** Le front tourne sur **Vercel**.

**Conséquences à respecter :**

- La page Vercel est servie en HTTPS : elle ne peut joindre la passerelle qu'en `wss://`/`https://`. La passerelle est exposée sur le tailnet par `tailscale serve`, avec un certificat `*.ts.net`. Seuls les appareils du tailnet reçoivent des données ; ailleurs, la page s'affiche avec « — » et le statut « Déconnecté ».
- L'URL de la passerelle est une variable de build (`VITE_GATEWAY_URL`), sans aucun secret. Un test vérifie qu'aucune clé ne figure dans le bundle.
- La passerelle n'accepte que les origines autorisées (domaine Vercel, `localhost` en développement).
- Recommandé : activer la protection de déploiement Vercel, pour que l'interface elle-même ne soit pas publique.
- À vérifier par un essai en P0 : Chrome peut demander une autorisation d'« accès au réseau local » quand une page publique joint une adresse Tailscale (100.64.0.0/10).
- En développement, Vite tourne en local sur le Mac, avec la même variable.

## T-005 — Watchlist hors crypto · 19/10/2026

**Décision.** En P0, seules les cryptos (OKX) sont en direct. Les autres lignes (indices, DXY, taux, or, changes, ETF du PEA) affichent « — » avec la raison « source à choisir », jamais un chiffre de maquette. Le choix de la source se fait en P1, après un script d'exploration. Candidats : Alpha Vantage, Stooq, FRED, Alpaca IEX. Yahoo et Finnhub restent exclus.

## T-006 — Noms · 19/10/2026

**Décision.** « TERMINAL » et « Assistant » restent provisoires jusqu'à P6. Chacun est défini par une seule constante dans le code.

## T-007 — Plan P0 validé · 20/10/2026

**Décision de Clément.** Il accepte le plan P0 tel que proposé, avec deux points :
- **dockview reporté à P1** : en P0, une grille CSS fixe reproduit la maquette. Le composant `Panel` est prêt à être hébergé par dockview.
- **bandes de session** : voir T-009.

## T-008 — Domaine OKX européen · 20/10/2026

**Constat.** La doc OKX (« Regional API Domain Requirement ») impose aux comptes ouverts sur `my.okx.com` les domaines `eea.okx.com` (REST) et `wseea.okx.com` (WebSocket). Les perpétuels BTC-USDT et ETH-USDT y sont listés, avec les mêmes paramètres de contrat que sur le domaine mondial.

**Décision.** `OKX_REGION=eea` par défaut. Détail dans `docs/okx.md`.

## T-009 — Bandes de session · 20/10/2026

**Contexte.** Dans le plan P0, j'avais proposé une bande Asie de 09:00 à 18:00, heure de Tokyo. La maquette `Main.html` dessine Asie de 00:00 à 06:00 UTC, soit 09:00–15:00 Asia/Tokyo.

**Décision.** On suit la maquette :
- Asie : 09:00–15:00 Asia/Tokyo ;
- Londres : 08:00–16:30 Europe/London ;
- New York : 09:30–16:00 America/New_York.

Pas de bande le week-end. Les heures sont définies dans `web/src/lib/time.ts` et testées à travers les deux changements d'heure (25/10 et 01/11/2026).

**À noter.** Les horloges de la barre du haut suivent les séances boursières complètes : Tokyo jusqu'à 15:30, avec la pause de midi. Elles ne s'arrêtent donc pas aux mêmes heures que les bandes du graphique.

## T-010 — Panneau BTC : données d'OKX seul · 20/10/2026

**Contexte.** La maquette affiche un open interest de 31,2 Md$ et un volume de 18,4 Md$, qui sont des agrégats multi-plateformes (P5).

**Décision.** En P0, ces cases affichent :
- l'open interest **d'OKX seul**, avec le libellé « Open interest OKX » ;
- le volume 24 h **en BTC** (`volCcy24h`).

Un volume en dollars demanderait une estimation (volume BTC × dernier prix) : on préfère la donnée exacte. L'agrégat viendra en P5.

## T-011 — Trois modes de fonctionnement · 20/10/2026

**Demande de Clément.** Pouvoir se servir du terminal sans que la tour soit allumée, et choisir, appareil par appareil, où tourne le moteur de données.

**Décision.** Le terminal a trois modes :

- **Mode Online** : rien à lancer chez soi. Le navigateur lit directement les WebSockets publiques d'OKX, les fonctions Vercel servent le REST et Supabase héberge un collecteur planifié (T-012, T-013).
- **Mode Local** : la passerelle Python tourne sur le Mac (T-014).
- **Mode Tour** : la passerelle tourne sur la tour Windows, jointe par Tailscale en https (T-001, T-004).

Le choix est propre à chaque appareil. Il est enregistré dans le stockage local du navigateur et se règle dans le terminal : avatar → Paramètres, ou commande `SET` de la palette. Le Mac peut être en Mode Local pendant que le téléphone est en Mode Online. Le mode actif s'affiche dans la barre de flux et dans la puce de source de la Vue d'ensemble.

**Conséquences.**

- Le contrat vit dans `web/src/config/modes.ts`. Les trois sources produisent les mêmes clés de données. Les parseurs OKX en TypeScript sont vérifiés contre ceux de Python sur un fichier doré (`docs/okx.md`).
- **Remplace en partie T-004.** La variable de build `VITE_GATEWAY_URL` disparaît. Elle cède la place à `VITE_DEFAULT_MODE`, `VITE_LOCAL_GATEWAY_URL` et `VITE_TOUR_GATEWAY_URL`, qui ne sont que des valeurs par défaut : le réglage de l'appareil prime. Le reste de T-004 tient : https par `tailscale serve`, origines autorisées, protection du déploiement Vercel.
- La passerelle annonce sa machine (`host`) et son mode (`mode_hint`, variable `GATEWAY_MODE`) dans `/api/health` et `gateway:meta`, pour savoir laquelle répond.
- En Mode Online, la latence affichée va d'OKX au navigateur, sans étape de passerelle.
- Guide complet : `docs/modes.md`.
- drexbot n'est pas concerné. Aucun mode ne lit ni n'écrit ses données ou ne touche à ses collecteurs, et son dépôt n'est pas modifié.

## T-012 — Supabase pour le Mode Online seulement · 20/10/2026

**Contexte.** En Mode Online, aucune machine personnelle ne tourne. Pour avoir malgré tout un collecteur hors du navigateur et une trace de son activité, il faut un ordonnanceur et un stockage hébergés : passages, échecs, minutes manquantes. Or T-003 excluait toute base serveur.

**Décision.**

- Un **projet Supabase dédié** au terminal, en région Europe (Paris ou Francfort), jamais partagé avec drexbot ni avec une autre application.
- Un **collecteur planifié** : l'Edge Function `okx-collector`, appelée chaque minute par pg_cron et pg_net. Elle relève le REST public d'OKX EEA (ticker, funding, open interest, bougies 1 min closes). Elle écrit `okx_snapshots`, `okx_candles_1m`, `collector_runs` (le journal) et `collector_gaps` (les minutes manquantes, signalées, jamais comblées). Rétention de 90 jours.
- **Exception assumée à T-003**, limitée au Mode Online : Postgres hébergé ne sert qu'à ce collecteur et à son journal. Les Modes Local et Tour, ainsi que tout historique de référence à venir, restent sous T-003 : Parquet + DuckDB, SQLite.
- **Aucune clé dans le front.** Le navigateur n'appelle jamais Supabase. La RLS est activée sans aucune politique, de sorte que seules deux clés secrètes lisent la base : celle de l'Edge Function, fournie par la plateforme, et celle des fonctions Vercel (`SUPABASE_SECRET_KEY`), gardée côté serveur. L'appel du collecteur est protégé par `COLLECTOR_SECRET`, comparé à temps constant.

**Conséquences.**

- Mise en place pas à pas, volumes et coût : `supabase/README.md`. L'ensemble est prévu pour l'offre gratuite ; le nombre de projets actifs et la mise en pause d'un projet inactif restent à vérifier.
- Ce collecteur est à la minute. Il surveille, mais ne remplace pas le temps réel, qui vient du navigateur (T-013).
- Il n'alimente aucun historique de référence. Il ne double aucun jeu de données de drexbot, qui ne collecte pas OKX (règle d'intégration 3).

## T-013 — Fonctions Vercel du Mode Online · 20/10/2026

**Constats** (`docs/okx.md`, 20/10/2026) :

- OKX accepte les WebSockets ouvertes depuis une page web, quelle que soit leur origine ;
- son REST refuse le CORS : le préflight répond 403 et aucune réponse ne porte `Access-Control-Allow-Origin` ;
- les fonctions Vercel ne gardent pas de connexion WebSocket ouverte.

**Décision.**

- Le temps réel du Mode Online est **lu par le navigateur**. Le worker s'abonne directement à `wss://wseea.okx.com`, avec les mêmes canaux et les mêmes clés que la passerelle : maintien en vie, reconnexion à délai croissant, journal des trous.
- Le REST passe par des **fonctions Vercel** `api/*.ts`, servies à la même origine que le front :
  - `/api/chart`, `/api/instruments` et `/api/okx-time` relaient en lecture `eea.okx.com`, avec une liste blanche d'instruments et un cache CDN court ;
  - `/api/collector-health` lit le journal Supabase ;
  - `/api/health` répond sur l'état des fonctions.
- **Région Europe** : `cdg1` (Paris), fixée dans `vercel.json`, au plus près d'OKX EEA et de Supabase.
- En développement, le middleware `web/vite-plugins/api-dev.ts` sert les mêmes fonctions depuis Vite, sans `vercel dev`.

**Conséquences.**

- Les fonctions ne relaient que des routes publiques d'OKX, en GET : aucune donnée privée, aucune clé d'exchange.
- L'adresse IP de sortie des fonctions est partagée, et les limites de débit d'OKX par IP s'appliquent à elle. Les bougies sont donc mises en cache 15 s.
- Les signatures Vercel restent à vérifier au premier déploiement (export `GET`, exclusion des dossiers préfixés « _ », région) : vercel.com n'était pas joignable depuis l'environnement de développement.

## T-014 — Mode Local : passerelle sur le Mac · 20/10/2026

**Décision.** La passerelle de la tour tourne aussi sur le Mac, à l'adresse `http://127.0.0.1:8710`, de deux façons :

- `python scripts/dev.py` (`--mode local`, le défaut) pendant le développement, avec Vite ;
- un **agent launchd utilisateur** (`deploy/macos/`, label `com.terminal-trading.gateway`), pour qu'elle tourne dès l'ouverture de session.

L'agent reprend le patron de la tour (T-001) :

- relance après un plantage (`KeepAlive` → `SuccessfulExit = false`), au plus une fois toutes les 30 s ;
- arrêt propre par le même fichier d'arrêt (`logs/_control/gateway.stop`), puis `launchctl bootout` ;
- priorité basse (`ProcessType = Background`), journaux dans `logs/`, `GATEWAY_MODE=local`.

La veille n'est pas inhibée. Le Mode Local s'arrête quand le Mac dort, et c'est assumé : le suivi 24 h/24 relève du Mode Tour ou du Mode Online.

**Conséquences.**

- Pour ouvrir le front de Vercel en Mode Local, le domaine Vercel doit figurer dans le `GATEWAY_ALLOWED_ORIGINS` du Mac. Chrome peut demander l'autorisation d'accéder au réseau local (à vérifier).
- `scripts/dev.py` ne lance pas de seconde passerelle quand celle de l'agent répond déjà.
- Les scripts n'ont été vérifiés qu'avec un `launchctl` simulé (`gateway/tests/test_macos_agent.py`). Le comportement du vrai launchd reste à vérifier sur le Mac, au premier usage.

## Décisions P1 · 11/11/2026

Douze questions posées à Clément sur le plan P1 (`docs/plan-p1.md`, § 16), chacune avec une recommandation. Ses réponses suivent.

## T-015 — Porte P1 · 11/11/2026

**Décision de Clément.** La porte se mesure à partir de la première mise en ligne observée : le chiffre est affiché moins d'une seconde après la première réponse de bls.gov qui le contient. Le délai total depuis 08:30:00 (heure de New York) est mesuré et affiché à chaque publication.

**Pourquoi.** Le BLS bloque en temps réel les robots qui l'interrogent plusieurs fois par seconde (bls.gov/bls/pss.htm). À une requête par seconde, l'attente moyenne vaut déjà 0,5 s, plus un délai de mise en ligne que le BLS ne publie pas.

**Conséquences.**

- Le CPI du 10/11/2026, visé par le plan du 27/10, est passé pendant l'arbitrage. La porte vise le CPI suivant (novembre), annoncé pour le **jeudi 10/12/2026 à 08:30 New York, soit 14:30 Paris** : date relevée sur des calendriers tiers, à confirmer sur le calendrier du BLS par l'exploration.
- Répétition générale : rapport sur l'emploi du **vendredi 04/12/2026 à 14:30 Paris**.
- Le financement fédéral court jusqu'au 11/12/2026 : un nouveau shutdown après cette date n'affecte pas le CPI du 10/12, mais le calendrier doit savoir signaler les publications suspendues.

## T-016 — Capture des chiffres sur le Mac · 11/11/2026

**Décision de Clément.** Pour la porte, la capture tourne dans la passerelle du Mac, en Mode Local. La tour n'est pas encore en service ; elle reprendra ce rôle plus tard, par une nouvelle décision.

**Conséquences.**

- Le Mac doit être allumé, éveillé et connecté à 14:30 les jours de publication. Le plan propose que la passerelle empêche la veille pendant la fenêtre de capture (T−15 min à T+10 min), et seulement pendant cette fenêtre.
- Une seule machine capte à la fois depuis la maison : le service de capture ne démarre que si `GATEWAY_SERVICES` l'active.
- La table `releases` du Mac est la référence. Les écarts éventuels avec une autre source sont signalés, jamais fusionnés en silence.

## T-017 — P1 en Mode Online · 11/11/2026

**Décision de Clément.** En Mode Online, une Edge Function Supabase relève seule l'agenda ForexFactory chaque heure, appelée par pg_cron comme `okx-collector`. Le Mode Online n'a ni capture à l'heure H ni fil d'actus en P1 : ces panneaux affichent « — » avec la raison « Mode Local ou Tour ».

**Conséquences.**

- **Extension de T-012** : nouvelles tables `calendar_snapshots` et `calendar_events` dans le projet Supabase existant. Comme les autres, elles ont la RLS sans aucune politique et ne sont lues que par une fonction Vercel avec la clé secrète (`/api/calendar`).
- Deux archives de l'agenda coexistent : celle du Mac (Mode Local) et celle de Supabase (Mode Online). Elles ne sont pas fusionnées. Les prévisions retenues pour la surprise viennent de l'archive du Mac.
- L'IP de sortie de Supabase est partagée : un refus de ForexFactory est possible. Il s'affiche comme flux « périmé » avec la raison, sans contournement.

## T-018 — Archive ForexFactory · 11/11/2026

**Décision de Clément.** On garde nos propres relevés horaires de l'agenda ForexFactory, privés, jamais exposés publiquement ni redistribués. On n'importe aucun jeu de données tiers.

**Conséquences.**

- La surprise brute (réel − prévision) s'affiche dès la première publication captée.
- La surprise z s'affiche à partir de 8 publications enregistrées avec leur prévision, marquée « provisoire (n = …) » jusqu'à 24. Avant cela : « — · historique insuffisant (n/8) ». Pour un indicateur mensuel, cela fait environ 8 mois.
- Les barres « 5 ans » de la fiche indicateur montrent les premières publications reconstruites depuis les communiqués archivés du BLS, sans prévision avant notre archive.

## T-019 — Pas de traduction en P1 · 11/11/2026

**Décision de Clément.** Aucune traduction par IA en P1. Les titres s'affichent dans leur langue d'origine, avec la mention « VO ». Aucune clé Anthropic n'est nécessaire en P1.

**Conséquences.**

- Le plan propose que le squawk annonce en français, par des modèles de phrase remplis avec nos données, les chiffres captés et les décisions de banque centrale. Il lit les autres titres urgents dans leur langue d'origine, avec une voix de cette langue.
- La traduction, ses contrôles (nombres conservés, texte parasite) et son cache sont reportés à une phase ultérieure, à décider.

## T-020 — Alertes sur le téléphone : Telegram · 11/11/2026

**Décision de Clément.** Les alertes arrivent sur le téléphone par un bot Telegram, envoyé par la passerelle du Mac.

**Conséquences.**

- Clément crée le bot avec @BotFather. `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID` vont dans le `.env` du Mac, jamais dans le front ni dans le dépôt.
- Mac endormi ou passerelle arrêtée : pas d'alerte sur le téléphone. C'est assumé jusqu'à la mise en service de la tour.
- L'envoi passe par une interface commune : un autre canal (ntfy, Pushover) pourra s'ajouter sans toucher au moteur d'alertes.

## T-021 — Tree of Alpha : flux gratuit mesuré · 11/11/2026

**Décision de Clément.** On se connecte au flux principal de Tree of Alpha sans clé. Cet accès fonctionne en pratique mais n'est pas documenté. Le volume et le délai sont mesurés sur quelques jours (étape E0) avant d'envisager l'abonnement.

**Conséquences.** Si le flux gratuit se ferme ou reste trop clairsemé, le fil repose sur les banques centrales et FinancialJuice, et l'écran le dit.

## T-022 — Chiffre provisoire tiré du fil d'actus · 11/11/2026

**Décision de Clément.** Un chiffre lu dans un titre FinancialJuice avant la capture du BLS s'affiche « provisoire · fil d'actus », dans un style distinct. Le chiffre du BLS le remplace dès qu'il est capté. Un désaccord entre les deux déclenche une alerte. Le chiffre provisoire ne compte jamais pour la porte.

## T-023 — Identité auprès du BLS · 11/11/2026

**Décision de Clément.** Le User-Agent envoyé au BLS est `terminal-trading/0.1 (<adresse dédiée>)`, sans URL. L'adresse est un alias créé par Clément pour le terminal, gardé dans le `.env` du Mac (`BLS_CONTACT_EMAIL`), jamais dans le code ni dans le dépôt. La passerelle refuse de démarrer la capture sans cette adresse. Pas de clé pour l'API v2 du BLS.

**Conséquences.** Le rattrapage par l'API se limite à la v1 sans clé (25 requêtes par jour). L'historique des premières publications vient des communiqués archivés du BLS, téléchargés une fois, au rythme d'une page toutes les 5 s.

## T-024 — Exploration P1 sur le Mac · 11/11/2026

**Décision de Clément.** Les scripts d'exploration de P1 (BLS, Tree of Alpha, banques centrales, FinancialJuice) se lancent sur le Mac, depuis l'IP qui captera. Clément les lance et transmet les fichiers produits. Ces fichiers deviennent les fichiers de référence des tests.

## T-025 — Périmètre de P1 · 11/11/2026

**Décision de Clément.** dockview (reporté à P1 par T-007) et les écrans HOURS et WATCH viennent après la porte de P1. Les « Points clés » d'un article, rédigés par l'IA, restent en P6 avec l'assistant.

## T-026 — Plan P1 validé · 11/11/2026

**Décision de Clément.** Il valide le plan P1 révisé (`docs/plan-p1.md`, version du 11/11/2026) et demande de commencer par E0, avec la mesure en rafale du PPI du vendredi 13/11/2026 à 14:30 Paris.

## T-027 — Priorité du module Bourse · 19/11/2026

**Contexte.** Le 18/11, Clément demande un module « Bourse et patrimoine » (screener, comptes historiques, initiés, DCF, portefeuille, dividendes, 13F, calendrier, transcripts, watchlists). P1 est en cours, avec la répétition du 04/12 et la porte du 10/12. Le plan (`docs/plan-bourse.md`) le découpe en étapes B0 à B4.

**Décision de Clément.** B0 (fondations) et B1 (portefeuille) commencent maintenant, en parallèle de P1. Autour du 04/12 et du 10/12, P1 passe avant tout. B2 à B4 attendent la porte du 10/12.

**Conséquences.** Dérogation assumée à la règle « une phase à la fois » de `CLAUDE.md`, limitée à B0 et B1. Le module Bourse ne touche ni la capture BLS ni la passerelle du Mac : un défaut de l'un ne peut pas bloquer l'autre.

## T-028 — Couverture des données boursières · 19/11/2026

**Contexte.** « 50 000+ actions » et « 40 ans d'historique » n'existent que chez des fournisseurs payants (relevés dans `docs/plan-bourse.md` § 1 et § 8).

**Décision de Clément.** Commencer avec les sources gratuites et légales : environ 8 000 sociétés américaines par la SEC (comptes structurés depuis 2009-2011, soit 16 à 17 exercices), sociétés européennes déposant au format ESEF (depuis l'exercice 2020, sans l'Allemagne ni l'Irlande). Un abonnement s'envisagera plus tard, module par module, si le gratuit ne suffit pas.

**Conséquences.** Chaque écran dit ce qu'il ne couvre pas, avec « — » et la raison. Pas de cours européens en masse : le screener européen filtre sur les fondamentaux, les cours ne sont suivis que pour les lignes et les watchlists.

## T-029 — Gemini, palier gratuit · 19/11/2026

**Contexte.** Clément veut une API Gemini gratuite pour toutes les fonctions qui demandent un LLM. Les conditions de Google exigent le palier payant pour une application utilisée depuis l'Espace économique européen, et Google peut utiliser les échanges du palier gratuit, y compris par relecture humaine.

**Décision de Clément.** Palier gratuit, en connaissance de ce risque. La clé `GEMINI_API_KEY` vit dans les variables d'environnement serveur de Vercel (type Secret), jamais dans le front ni dans le dépôt.

**Conséquences.**

- Gemini ne reçoit que des documents publics (rapports, transcripts, communiqués) : jamais une position, un montant ni une performance du portefeuille.
- Quotas faibles : chaque résultat est calculé une fois par document et par version du prompt, puis gardé. Quota atteint : « — · quota atteint », reprise plus tard.
- Chaque chiffre cité par l'IA porte une citation exacte, vérifiée mot pour mot dans le document ; sinon « — ». L'IA ne calcule rien (`CLAUDE.md`).
- Passer au palier payant ne changera pas le code : seule la clé change.

## T-030 — Pas d'avis sur X · 19/11/2026

**Contexte.** L'avis communautaire sur X passait par Grok avec la recherche X, environ 0,35 $ par avis. Grok n'a pas de palier gratuit, l'API de X non plus.

**Décision de Clément.** Pas de Grok. La fonction « avis sur X » est retirée du module.

## T-031 — Stockage et accès du module Bourse · 19/11/2026

**Contexte.** Le portefeuille est une donnée personnelle. T-012 limitait Supabase au Mode Online.

**Décision de Clément.** Extension de T-012 : les données du module Bourse vivent dans des tables Supabase privées (RLS active, aucune politique), lues et écrites seulement par les fonctions Vercel et les tâches planifiées avec la clé secrète. Le navigateur n'appelle jamais Supabase. Les relevés de la nuit passent par pg_cron et des Edge Functions, comme `okx-collector`.

**Conséquences.**

- La protection de déploiement Vercel (« All Deployments ») reste obligatoire.
- Les routes du module exigent en plus un mot de passe d'application : seule son empreinte est dans les variables de Vercel ; la session tient dans un cookie signé, `HttpOnly`, `Secure`, `SameSite=Strict`.
- Le module fonctionne quel que soit le mode des données de marché (Online, Local, Tour).

## T-032 — Import du Trading Desk · 19/11/2026

**Décision de Clément.** Les lignes du PEA et les liquidités de l'artefact Trading Desk sont importées une fois dans le module. L'artefact reste en lecture : rien n'y est écrit. Des morceaux de son code (table des ETF éligibles au PEA, reconnaissance des saisies, formats français, donut, table des lignes) sont réécrits avec les composants du terminal.

## T-033 — Écrans du module Bourse · 19/11/2026

**Décision de Clément.** Pas de maquette préalable : les écrans sont conçus directement avec le design system (`design/tokens.css`, composants de P0). Chaque écran est capturé à 1 440 px et à 390 px (aucun défilement horizontal) et relu avant de passer à la suite.

## T-034 — Note de l'action · 19/11/2026

**Décision de Clément.** La note est descriptive et transparente : quatre axes (qualité, croissance, valorisation, solidité), chacun en percentile dans l'univers couvert, avec le détail des mesures affiché. Elle est marquée « non testée » : elle n'a été validée sur aucun historique et ne prédit rien.

**Conséquences.** Aucune pondération cachée. Une mesure manquante se voit (« — » et la raison) et ne compte pas comme une note basse.

## T-035 — Calendrier P1 révisé · 19/11/2026

**Contexte.** La mesure en rafale prévue sur le PPI du 13/11 n'a pas été lancée. D'après le calendrier du BLS (relevé par recherche, bls.gov n'étant pas joignable depuis l'environnement de développement), aucune autre publication à 08:30 New York n'a lieu avant le rapport emploi du 04/12 ; la semaine du 23/11 est celle de Thanksgiving.

**Décision de Clément.**

- **Ven. 04/12, 14:30 Paris** : rapport emploi de novembre, mesure en rafale par `scripts/explore_bls.py` (mesure seule, aucun chiffre lu).
- **Mar. 08/12, 14:30 Paris** : productivité et coûts du 3e trimestre (révisé), **répétition générale** de la capture complète, à la place du 04/12.
- **Jeu. 10/12, 14:30 Paris** : CPI de novembre, **porte** inchangée (T-015).

**Conséquences.** Deux jours seulement entre la répétition et la porte, sans autre publication du BLS entre les deux : les défauts vus le 08/12 se corrigent le 09/12. La capture et le script d'exploration savent lire le communiqué trimestriel de productivité (`prod2`, période « 2026-Q3 »). Les dates restent à confirmer sur le calendrier du BLS par la sonde du Mac.

## T-036 — Plan Bourse validé · 19/11/2026

**Décision de Clément.** Il valide le plan révisé du module Bourse (`docs/plan-bourse.md`, version du 19/11/2026, décisions T-027 à T-034). Comme pour chaque phase, B0 commence par un plan détaillé (`docs/plan-b0.md`), validé avant d'écrire du code.

## T-037 — Plan B0 validé · 19/11/2026

**Décision de Clément.** Il valide le plan B0 (`docs/plan-b0.md`) et demande de coder sans attendre :

- **Exploration en ligne**, pas sur le Mac : les sources sans clé depuis l'environnement de développement (adresses ouvertes dans un environnement personnel « Trading »), les sources à clé et la SEC par la tâche `explore` de l'Edge Function `bourse-jobs`, c'est-à-dire depuis l'adresse IP qui fera les relevés ;
- **session de 30 jours** ;
- **porte sur les lignes de son portefeuille** et EUR/USD, plutôt que sur des titres d'exemple.

**Conséquences.**

- Le PEA ne compte que des titres européens : la porte repose sur Alpha Vantage (six requêtes par nuit sur un budget de 20) et sur la BCE ; Massive n'a rien à relever tant qu'aucune ligne américaine n'est suivie.
- Les lignes suivies s'insèrent par un script SQL gardé hors du dépôt (données personnelles) jusqu'à l'import de B1.
- La section « Bourse » du menu est repliable et repliée par défaut : dépliée, elle allongeait la page au-delà de la maquette Main.
- Mot de passe : PBKDF2-SHA256 (WebCrypto) au lieu de scrypt, pour un même code sur Vercel, Vite et Vitest.

## T-038 — Plan B1 : réponses de Clément · 20/11/2026

**Décision de Clément** sur les questions du plan B1 (`docs/plan-b1.md` § 10) :

- **Courtier** : XTB. L'import .xlsx part de l'export de l'historique du compte XTB.
- **Enveloppes** : le PEA seul en B1.
- **Point de départ des performances** : le 28/09/2026.
- **Benchmarks** : MSCI World (`CW8.PAR`) et S&P 500 (`ESE.PAR`), sans le CAC 40.
- **Ventilation des ETF** : elle est affichée.

**Conséquences.**

- Les performances partent du 28/09/2026. Il faut donc les opérations depuis cette date : l'export XTB devient la source principale, et le Trading Desk ne sert plus qu'à contrôler les positions du jour. B1.4 (import .xlsx) passe avant B1.3.
- Un benchmark déjà suivi comme ligne ne coûte rien de plus ; `CW8.PAR` ajoute au plus une requête Alpha Vantage par nuit, dans le budget de 20.
- Aucune source gratuite ne donne la composition des ETF. La ventilation par pays, secteur et devise est saisie depuis la fiche de chaque émetteur, avec l'adresse et la date de la fiche, puis affichée avec sa source et sa date. Une fiche de plus de 3 mois est marquée « périmée ». La part non couverte reste « Non ventilé ».

**Complément du 20/11/2026, après lecture des exports XTB** (fichiers au format d'import Baggr, gardés hors du dépôt comme les lignes suivies) :

- **Le CTO entre dans B1** (décision de Clément). Ses titres américains sont relevés par Massive, sans coût de quota ; ses intérêts et ses taxes sont des opérations du compte.
- **Une ligne se suit sur la place où elle a été achetée.** L'export indique la place de chaque achat ; le script des lignes, hors dépôt, est corrigé en conséquence.
- **L'aperçu de l'import contrôle la cohérence entre ISIN et mnémonique** à l'aide du référentiel (OpenFIGI) et propose l'ISIN du référentiel. Un export saisi à la main peut en effet porter l'ISIN d'un autre fonds de la même gamme.

## T-039 — Réalisation de B1 · 20/11/2026

**Contexte.** Le plan B1 prévoyait une tâche de valorisation chaque nuit et une table `daily_valuations`.

**Décision.** La valorisation se calcule à chaque demande : avec quelques dizaines d'opérations, le calcul est immédiat et reste toujours cohérent avec les dernières clôtures. Le détail des écarts au plan est dans `docs/plan-b1.md` § 11.

**Conséquences.** Les performances suivent les clôtures relevées chaque nuit sans tâche supplémentaire. Un cours manquant rend la valeur totale « — » avec sa raison, et la valeur partielle reste affichée.

## T-040 — Rattrapage d'une capture manquée et révisions · 23/11/2026

**Contexte.** Le plan P1 (§ 3) prévoyait le rattrapage « par l'API v1 ». Vérifié le 23/11/2026 sur une réponse réelle de l'API (12 séries, 2023-2026) et le corpus de 124 communiqués : pour la dernière période de chacun des 10 indicateurs lisibles, la variation recalculée depuis les indices publiés (trois décimales, arrondi au dixième) redonne exactement la première publication. Les écarts sur les périodes plus anciennes sont de vraies révisions (emploi de septembre 2026 : 29 k publié, 60 k aujourd'hui ; coefficients saisonniers de l'IPC révisés en février). L'API ne donne cependant ni texte à citer ni date de publication.

**Question posée à Clément.** Source du rattrapage : la page, l'API, ou la page puis l'API.

**Décision de Clément.** La page, puis l'API :

- une publication suivie restée sans chiffre (Mac en veille, passerelle arrêtée, page en ligne après T+5 min) est rattrapée à partir de T+10 min en relisant le communiqué : `.nr0`, puis la page complète si elle est vide ou corrompue, puis la copie archivée à la date (`news.release/archives/<clé>_<MMJJAAAA>.htm`) si une publication plus récente est déjà en ligne. Même parseur, même citation ; nature « rattrapage », aucun délai affiché ;
- l'API v1 ne sert que si la page reste illisible, à partir de T+1 h, et seulement si la période attendue se déduit de la dernière publication enregistrée et que l'API la marque comme la plus récente. Le chiffre porte la série, les niveaux utilisés et la mention « recalculé » ; nature « rattrapage API », exclu du calcul de σ. Refusé pour le communiqué révisé de la productivité : l'API ne dit pas si la valeur est déjà la révisée ;
- les **révisions** se lisent dans l'API v1 : à T+15 min et T+60 min après chaque publication suivie, et chaque jour ouvré à 12:00 New York, une relecture au plus par passage, 20 requêtes par jour au plus sur les 25 permises (réserve pour les scripts d'exploration). Une valeur différente de la dernière connue devient une ligne de `release_revisions` ; la première publication n'est jamais modifiée. Sur une publication de moins de 7 jours, une valeur égale à une valeur antérieure est un retard de l'API (ignoré) ; une autre valeur est un « écart » à vérifier, signalé dans le journal.

**Conséquences.** Migration 4 (`release_revisions`, `release_reactions`). Série du PPI renseignée (`WPSFD4`) ; le PPI sous-jacent reste sans série (question ouverte avant le 15/12). Code : `bls_api.py`, `reaction.py`, `release_service.py` ; tests sur la réponse réelle (`gateway/tests/fixtures/bls/api_v1_2026-11-23.json.gz`).
