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
