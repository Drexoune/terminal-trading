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
| T-041 | 23/11/2026 | PPI sous-jacent | Complété par l'API v1 (série WPSFD49104) dès sa mise à jour après la publication ; marqué « recalculé » |
| T-042 | 23/11/2026 | Tout en ligne | P1 tourne sans le Mac : capture, agenda, alertes et Telegram sur Supabase (Edge Functions, Cron) et Vercel ; remplace T-016 et T-017 ; plan `docs/plan-online.md` |
| T-043 | 23/11/2026 | Chiffre capté jusqu'à l'écran | Supabase Realtime, canal public de diffusion pour les données publiques seulement ; clé « publishable » dans le front ; révise T-012 |
| T-044 | 23/11/2026 | Offre Supabase | Offre gratuite d'abord ; passage à Pro (environ 25 $/mois) si le projet est mis en pause |
| T-045 | 23/11/2026 | Porte P1 en ligne | Capture en ligne visée pour le CPI du 10/12 ; le Mac capte en parallèle les 04/12, 08/12 et 10/12, en secours |
| T-046 | 23/11/2026 | Flux continus en ligne | Alertes de prix à la minute (haut et bas de chaque bougie) ; Tree of Alpha abandonné en ligne |
| T-047 | 23/11/2026 | Écritures des alertes en ligne | Vercel vérifie la session et relaie à l'Edge Function p1-jobs ; P1_JOBS_SECRET aussi dans Vercel ; le Mac n'envoie plus d'alertes |
| T-048 | 23/11/2026 | Réel de l'agenda | Chiffre structuré de FinancialJuice rattaché strictement à l'événement, marqué « FJ » ; jamais à la place du BLS |
| T-049 | 23/11/2026 | P2 avant la porte P1 | Plan puis code de P2 sans attendre le 10/12, sans jamais toucher la capture de P1 ; P1 reste prioritaire |
| T-050 | 23/11/2026 | Suivi de comptes X | Abandonné : aucune source gratuite et fiable ; le fil d'actus reste sur les banques centrales et FinancialJuice ; surlignage de mots-clés réglable sur ce fil |
| T-051 | 23/11/2026 | Source de la watchlist hors crypto | Tiingo gratuit toutes les 3 min (change, or, DXY recalculé, QQQ et SPY) ; FRED et clôtures de Bourse au quotidien ; remplace T-005 |
| T-052 | 23/11/2026 | Indice dollar de la watchlist | Pas de DXY recalculé (formule propriété de l'ICE) : indice large du dollar de la Fed (FRED), quotidien ; ligne DXY « — » ; remplace ce point de T-051 |
| T-053 | 24/11/2026 | P3 avant la porte P1 | Plan puis code de P3 sans attendre le 10/12, aux conditions de T-049 ; P1 reste prioritaire |
| T-054 | 24/11/2026 | Surprises hors des États-Unis | Surprise = réel FinancialJuice − consensus ForexFactory, marquée « fil d'actus » ; remplace ce point de T-048 ; compte au score après 3 mois de données |
| T-055 | 24/11/2026 | Lecture fondamentale | Texte construit par le code à partir des chiffres affichés, chacun cité, « lecture automatique » ; pas de clé Anthropic avant P6 |
| T-056 | 24/11/2026 | Sources de P3 | États-Unis : FRED ; zone euro : BCE ; 6 autres économies : API de l'OCDE ; taux : BIS ; changes : FRED ; dernier chiffre : agenda ; DBnomics écarté (copie de l'OCDE arrêtée au 16/06/2026) |
| T-057 | 24/11/2026 | Accès à l'OCDE | L'OCDE refuse Supabase (HTTP 500) : relevé par une tâche de Vercel si l'OCDE lui répond, sinon instituts nationaux |
| T-058 | 24/11/2026 | Sources nationales de P3 | L'OCDE refuse aussi Vercel : ONS, Statistics Japan et RBA (copies DBnomics), Statistics Canada et BNS (API), FRED ; IPC néo-zélandais « — » ; thème Sentiment affiché sans compter au score ; remplace le point « OCDE » de T-056 |
| T-059 | 24/11/2026 | P4 avant la porte P1 | Plan puis code de P4 sans attendre le 10/12, aux conditions de T-049 ; proxys quotidiens par des ETF (Tiingo) : CPER/GLD pour cuivre/or, SPY/TLT pour actions/refuge |
| T-060 | 24/11/2026 | Sources de P4 | VIX : Cboe (FRED en repli) ; S&P 500 : clôture de SPY (Tiingo) ; écart haut rendement : FRED ; positions des banques : catégorie « dealers » du TFF (API CFTC), BPR via Vercel s'il répond ; liquidité nette : WALCL − WDTGAL − RRPONTSYD |
| T-061 | 24/11/2026 | Section Backtest avant P5 | Nouvelle section « Backtest » avant P5, aux conditions de T-049 : stratégies connues, éditeur Pine, assistant IA (Gemini) et recherche autonome ; tuiles notées E à S ; BTC, ETH, QQQ, SPY ; long et short avec frais |
| T-062 | 24/11/2026 | Moteur du backtest | PineTS (Pine Script natif, émulateur de courtier de type TradingView), licence AGPL-3.0 pour un usage personnel sans redistribution ; appels de marge désactivés par défaut (levier 1), activables |
| T-063 | 24/11/2026 | IA du backtest | Gemini en offre gratuite seulement (0 $ par jour), modèle le moins cher (Gemini 3.1 Flash-Lite) ; quota gratuit épuisé : « quota gratuit atteint », jamais de bascule payante ; clé dans les secrets de Supabase et les variables de Vercel |
| T-068 | 25/11/2026 | Statistiques d'OKX pour P5 | Volume preneur (perp, spot) et historique de l'OI de `www.okx.com` relayés par la fonction Vercel `api/okx-time.ts` (`?stat=`), liste blanche fixe, cache CDN ; complète T-067 (ces statistiques n'acceptent pas le navigateur) |
| T-069 | 25/11/2026 | Microstructure en continu | Le moteur de P5 tourne 24 h/24 sur une machine Oracle Cloud « Always Free » (région de rattachement en France), compte jamais passé en paiement à l'usage ; machine A1 petite (1 cœur, 2 Go) pour ne pas être jugée inactive ; plan à valider avant tout code ; révise T-065 (« aucun serveur ») |
| T-070 | 25/11/2026 | Recherche du backtest sur Oracle | La boucle de `bt-jobs` tourne aussi sur la machine Oracle (service `terminal-bt`, passages de 5 min, bail de 6 min renouvelé), Supabase en repli ; secrets sur la machine : clé secrète Supabase dédiée « oracle » et GEMINI_API_KEY dans `/etc/terminal/bt.env` (0640), lus par `terminal-bt` seul ; révise T-069 (« aucun secret sur la machine ») |
| T-071 | 25/11/2026 | Alertes à la seconde | Prix BTC et ETH jugés sur chaque trade par la machine Oracle (service `terminal-alerts`), Supabase à la minute en repli, même clé de dédoublonnage ; nouvelles alertes de liquidations et de mur retiré (Oracle seulement) ; secrets Telegram et clé « oracle » dans `/etc/terminal/alerts.env` ; révise T-046 |
| T-072 | 25/11/2026 | Tree of Alpha en ligne | Flux gratuit sans clé (T-021) lu 24 h/24 par la machine Oracle (service `terminal-news`) : même table `news_items`, mêmes doublons, même diffusion et mêmes alertes que les RSS ; état `feed:toa` dans la barre de flux ; aucun nouveau secret ; révise T-046 sur Tree of Alpha |
| T-073 | 25/11/2026 | P6 avant la porte P5 | Plan puis code de P6 sans attendre la séance S4 de P5 ; P5 reste prioritaire pour S4 ; aucun déploiement les 04/12, 08/12, 10/12 |
| T-074 | 25/11/2026 | Choix de P6 | Gemini gratuit seulement (T-063) pour l'assistant, la traduction et les récaps ; traduction à la demande (T-019 inchangé) ; TERMINAL et « Assistant » définitifs (clôt T-006) ; positions OKX reportées, track record en saisie manuelle ; plafonds par usage dans bt_ai_calls |

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

## T-041 — PPI sous-jacent par l'API v1 · 23/11/2026

**Contexte.** L'indice « final demand less foods and energy » (consensus ForexFactory « Core PPI m/m ») n'est pas sur la page résumé lue à l'heure H : il n'est publié qu'au tableau 1 du communiqué complet. En E3, il restait « — ».

**Vérification.** La série de l'API v1 `WPSFD49104` porte les mêmes niveaux que le tableau 1 (156.740 en octobre 2026), et la variation recalculée redonne les cinq variations publiées de juin à octobre 2026 (0,4 ; 0,3 ; 0,2 ; 0,8 ; 0,3).

**Décision de Clément.** Le PPI sous-jacent est complété par l'API v1.

**Conséquences.** À la capture, la ligne est enregistrée vide, avec sa raison. Aux relectures de l'API (T+15 min, T+60 min, 12:00 New York), dès que la période apparaît, la valeur est complétée une seule fois : marque « recalculé », série et niveaux cités, heure du complément (`filled_ms`, migration 6), surprise et z calculés comme à la capture. Ce chiffre ne compte pas pour la porte (délai de l'API) et ne déclenche ni bandeau ni annonce vocale. Le délai réel de mise à jour de l'API sera mesuré au PPI du 15/12.

## T-042 à T-046 — Tout en ligne · 23/11/2026

**Demande de Clément.** Que tout tourne même quand le Mac est éteint. Trois options présentées : A, Vercel et Supabase seuls ; B, un petit serveur en ligne avec la passerelle Python actuelle (recommandée) ; C, la tour. **Clément retient A.**

**Faits vérifiés le 23/11/2026** (documentation Supabase) : Edge Functions limitées à 150 s (offre gratuite) ou 400 s (payante) et 2 s de CPU par requête, WebSocket sortante possible pendant cette durée ; Supabase Cron jusqu'à une exécution par seconde ; projet gratuit mis en pause après 7 jours de « faible activité », sans préciser si les tâches planifiées comptent ; Realtime Broadcast public : abonnement avec la clé publishable, sans session.

**Décisions de Clément.**

- **T-042** : la capture du BLS, l'agenda, les alertes et Telegram passent sur Supabase et Vercel. La passerelle Python reste pour le Mode Local et le développement. **Remplace T-016** (le Mac fait foi) **et T-017** (ni capture ni alerte en Mode Online).
- **T-043** : le chiffre capté arrive à l'écran par Supabase Realtime, sur un canal de diffusion public qui ne porte que des données publiques (chiffres du BLS, agenda). La clé publishable de Supabase entre dans le front. **Révise T-012** : la RLS reste sans politique sur toutes les tables ; la clé publishable ne lit aucune table ; les clés secrètes restent côté serveur ; les écritures (règles d'alerte, essai Telegram, heure d'affichage) passent par les fonctions Vercel derrière le mot de passe d'application (T-031).
- **T-044** : offre gratuite d'abord ; si le projet est mis en pause, passage à Pro.
- **T-045** : la capture en ligne vise la porte du 10/12. Filet de sécurité : la passerelle du Mac capte aussi les 04/12, 08/12 et 10/12. Les deux adresses IP sont différentes, chacune reste à une requête par seconde ; la mesure de la porte vient de la capture en ligne si elle a réussi, sinon de celle du Mac.
- **T-046** : en ligne, les alertes de prix se jugent à la minute, sur le haut et le bas de chaque bougie 1 min (aucun franchissement manqué, jusqu'à une minute de retard). Tree of Alpha n'est pas repris en ligne ; les flux RSS couvrent les banques centrales et la macro.

**Risques acceptés.** Deux mises en œuvre à tenir (Python et TypeScript), vérifiées contre le même corpus ; adresses IP de Supabase peut-être refusées par le BLS ou ForexFactory (sonde O0 avant tout) ; calendrier serré jusqu'au 10/12.

## T-047 et T-048 — Alertes en ligne et réel de l'agenda · 23/11/2026

**T-047 — Écritures des alertes en Mode Online.** Proposé avec O4, approuvé par Clément le 23/11/2026.

- L'écran `/alertes` écrit par `/api/alerts/*` (Vercel). La fonction vérifie la session du mot de passe d'application (T-031) et la même origine, puis relaie la commande à la tâche `alerts-cmd` de l'Edge Function `p1-jobs`, avec l'en-tête `x-jobs-secret`. Validation des règles, base et Telegram restent dans Supabase ; le jeton Telegram n'est jamais dans Vercel.
- Conséquence : `P1_JOBS_SECRET` est aussi une variable de Vercel (même valeur que dans Supabase et le `.env` du Mac).
- Le service `alert` de la passerelle du Mac est retiré de `GATEWAY_SERVICES` : un seul moteur d'alertes (Supabase), aucun message Telegram en double les jours où le Mac capte aussi (T-045).

**T-048 — Réel des événements de l'agenda.** Demande de Clément le 23/11/2026 : les réels des publications du matin n'apparaissaient pas.

- **Constat.** Le fichier hebdomadaire de ForexFactory ne porte pas le réel ; seuls les chiffres captés au BLS en avaient un.
- **Décision.** Le chiffre structuré publié par FinancialJuice (« … Actual 0.7% (Forecast 0%, Previous -0.4%) ») est rattaché à l'événement par la tâche `news` et affiché comme réel, marqué « FJ », avec en infobulle le titre d'origine et son délai. Il ne remplace jamais un chiffre capté au BLS (T-022) ; aucune surprise n'est calculée dessus.
- **Rattachement strict** (un réel faux est pire qu'un « — ») : même pays (code de l'identifiant ForexFactory), mêmes mots hors pays, éditeurs et mots d'édition, titre lu entre T−2 min et T+30 min ; s'il reste plusieurs candidats, le consensus identique départage, sinon rien. Premier chiffre gardé, jamais remplacé.
- **Limite.** Le flux de FinancialJuice ne garde que ses 100 derniers titres (quelques heures) : un chiffre publié pendant une coupure de la tâche est perdu et reste « — » avec sa raison. Les réels du matin du 23/11 (avant la mise en service du fil, 17:56 Paris) ne sont pas récupérables.

## T-049 — P2 en parallèle de la porte P1 · 23/11/2026

**Contexte.** P1 est construite et en service ; sa porte (IPC capté et affiché en moins d'une seconde) ne peut se passer que le 10/12, jour de l'IPC. La règle de `CLAUDE.md` § 6 interdit de commencer la phase suivante avant la porte.

**Décision de Clément.** Exception à cette règle pour P2 : plan, puis code, sans attendre le 10/12.

**Conditions.**

- Rien de P2 ne modifie la capture de P1 (`supabase/functions/p1-jobs/capture.ts` et ce qu'elle appelle, cron `p1-capture`, bandeau, `/api/p1/displayed`) ; P2 a ses propres tables, tâches et écran.
- Tout problème de P1 (rapport emploi du 04/12, répétition du 08/12, IPC du 10/12) passe avant P2.
- P2 commence en mode plan et attend l'accord de Clément avant d'écrire du code (`CLAUDE.md` § 7).

## T-050 — Suivi de comptes X · 23/11/2026

**Demande de Clément.** Un suivi de comptes X dans le fil d'actus, comptes choisis depuis le site, mots du domaine (Nvidia, Jensen, Fed…) surlignés, liste réglable, présentation inspirée du fil de X.

**Faits vérifiés le 23/11/2026.**

- API officielle de X : paiement à l'usage seulement, 0,005 $ par publication lue, aucun palier gratuit ; environ 30 $ par mois pour 20 comptes lus chaque minute.
- Services tiers (SocialData 0,20 $ et twitterapi.io 0,15 $ pour 1 000 publications) : 2 à 7 $ par mois, mais données très probablement obtenues par aspiration, contraire aux conditions de X, sans garantie de durée.
- Aspiration depuis Supabase : impossible sans compte connecté (adresses de centres de données bloquées), contraire aux conditions de X, risque de fermeture du compte.

**Décision de Clément.** Pas de suivi de comptes X. Le fil d'actus garde les sources établies (8 banques centrales, FinancialJuice). Le surlignage des mots du domaine, avec une liste par défaut modifiable depuis le site, s'applique à ce fil.

## T-051 — Source de la watchlist hors crypto · 23/11/2026

**Remplace T-005**, qui reportait ce choix à P1 « après un script d'exploration ». Exploration faite depuis Supabase le 23/11/2026 : `docs/exploration-watch.md`.

**Décision de Clément.** Offre gratuite de Tiingo, plus des clôtures quotidiennes.

- **Toutes les 3 minutes** (40 des 50 requêtes par heure de l'offre gratuite ; usage personnel, licence de Tiingo) :
  - EUR/USD, USD/JPY et l'or (XAU/USD) en direct (Tiingo FX) ;
  - le DXY recalculé avec la formule publiée par l'ICE à partir de six paires de la même requête, affiché « recalculé », jamais présenté comme le DXY coté ;
  - QQQ et SPY (prix de référence IEX de Tiingo) comme substituts du Nasdaq 100 et du S&P 500 pendant la séance américaine, nommés comme tels.
- **Au quotidien**, chaque valeur avec sa date :
  - rendement US 10 ans (FRED, `DGS10`) ;
  - ETF du PEA (clôtures déjà collectées par le module Bourse, sans nouvelle requête).
- **Futures Nasdaq 100 et S&P 500** : « — » avec la raison (aucune source gratuite).

**Écartés.** Stooq (hors service depuis Supabase), Massive (l'abonnement ne couvre ni indices ni changes), Alpha Vantage en intraday (25 requêtes par jour, clôtures seulement), Yahoo et Finnhub (exclus depuis le début).

## T-052 — Indice dollar de la watchlist · 23/11/2026

**Remplace le point « DXY recalculé » de T-051.**

**Fait vérifié le 23/11/2026.** Fiche officielle du contrat US Dollar Index de l'ICE (`ice.com/api/productguide/spec/194/pdf`) : la formule, les pondérations et les méthodes de calcul appartiennent à ICE Data Indices, et toute utilisation sans accord écrit est interdite. La FAQ qui publiait la formule n'est plus en ligne (HTTP 404).

**Décision de Clément.**

- La watchlist affiche l'indice large du dollar de la Réserve fédérale (FRED, `DTWEXBGS`), public et gratuit. Il est quotidien, publié avec environ une semaine de retard, daté et nommé comme tel, jamais comme le DXY.
- La ligne DXY affiche « — » avec la raison (indice propriétaire de l'ICE, aucune source gratuite).

## T-053 — P3 en parallèle de la porte P1 · 24/11/2026

**Contexte.** P2 est en service depuis le 24/11/2026 (cotes de la Fed chaque minute depuis 07:22 UTC). La porte de P1 (IPC capté et affiché en moins d'une seconde) ne peut se passer que le 10/12. T-049 ne valait que pour P2.

**Décision de Clément.** P3 commence sans attendre le 10/12 : plan, puis code.

**Conditions** (celles de T-049) :

- rien de P3 ne modifie la capture de P1 (`capture.ts` et ce qu'elle appelle, crons `p1-*`, bandeau, `/api/p1/displayed`) ; P3 a sa propre Edge Function (`p3-jobs`), ses tables et ses écrans ;
- tout problème de P1 (rapport emploi du 04/12, répétition du 08/12, IPC du 10/12) passe avant P3 ; aucun déploiement ces jours-là.

## T-054 — Surprises hors des États-Unis · 24/11/2026

**Contexte.** Le thème « Surprises » de la heatmap (plan, Heatmap fondamentale) demande réel et consensus pour les 8 économies. Seuls les chiffres américains sont captés au BLS ; T-048 interdisait de calculer une surprise sur les réels de FinancialJuice.

**Question posée à Clément.** Calculer la surprise sur les réels de FinancialJuice, ou garder les surprises aux États-Unis seulement.

**Décision de Clément.** La surprise se calcule sur le réel de FinancialJuice rattaché à l'événement (règles strictes de T-048) moins le consensus de ForexFactory, et se marque « fil d'actus ». **Remplace le point de T-048** « aucune surprise n'est calculée dessus » ; le reste de T-048 ne change pas (jamais à la place d'un chiffre du BLS).

**Conséquences.** Historique bâti à partir du 23/11/2026 (mise en service du fil). Le thème n'entre dans le score qu'avec 3 mois de données ; avant, sa colonne s'affiche avec la raison.

## T-055 — Lecture fondamentale sans IA en P3 · 24/11/2026

**Contexte.** La heatmap a un panneau « Lecture fondamentale » de 4 à 6 lignes. Ce serait le premier appel à l'API Claude (T-019 : aucune IA en P1).

**Question posée à Clément.** Texte construit par le code, API Claude dès P3, ou panneau vide jusqu'à P6.

**Décision de Clément.** Texte construit par le code à partir des seuls chiffres affichés, chaque chiffre avec sa source et sa date, marqué « lecture automatique ». Aucune clé Anthropic en P3 ; la lecture par Claude arrive en P6 avec l'assistant.

## T-056 — Sources de P3 · 24/11/2026

**Contexte.** Le plan prévoyait DBnomics pour l'historique macro. Exploration M0 du 24/11/2026 (`docs/exploration-p3.md`) : la copie de l'OCDE chez DBnomics n'est plus mise à jour depuis le 16/06/2026 (IPC américain arrêté en 2026-05, japonais en 2021-06 dans le jeu des indicateurs clés).

**Décision de Clément** (grille proposée, § 7 de l'exploration) :

- États-Unis : FRED (IPC, IPC sous-jacent, chômage, PIB, confiance de l'université du Michigan, ventes au détail) ;
- zone euro : BCE (IPCH, jeu `HICP` depuis 2026 ; chômage et PIB, composition à 21 pays `I10`) ;
- Royaume-Uni, Japon, Suisse, Canada, Australie, Nouvelle-Zélande : API SDMX de l'OCDE (IPC COICOP 2018 ou 1999 selon le pays, chômage, PIB, confiance, ventes au détail) ;
- taux directeurs : BIS (mensuel pour l'historique, quotidien de P2) ; changes du backtest : FRED (H.10) ;
- dernier chiffre : l'agenda dès sa publication (BLS, sinon réel FinancialJuice rattaché, T-048) ;
- « — » avec la raison : confiance des consommateurs au Canada (indice privé), ventes au détail en Australie et en Nouvelle-Zélande, PMI jusqu'à 3 mois de relevés.

**Conséquences.** Au plus 6 requêtes par jour à l'OCDE (limite publiée : 60 par heure ; 20 selon une copie de la même page).

## T-057 — Accès à l'OCDE · 24/11/2026

**Contexte.** Sonde `explore` de `p3-jobs` depuis Supabase (région eu-central-2) le 24/11/2026 : toute requête de données qui atteint le serveur d'origine de l'OCDE reçoit HTTP 500 (« Internal server error », `cf-cache-status: BYPASS`). Seules passent les réponses déjà en cache chez Cloudflare et les requêtes de structure. Les mêmes requêtes, avec les mêmes en-têtes, répondent 200 depuis le Mac. BCE, FRED, BIS et DBnomics répondent à Supabase.

**Question posée à Clément.** Tâche de Vercel, instituts nationaux, ou relais par le Mac.

**Décision de Clément.** Essayer d'abord Vercel : une route protégée par le secret des tâches (`/api/macro/probe`) interroge l'OCDE depuis Vercel. Si l'OCDE répond, une tâche quotidienne de Vercel relève l'OCDE et écrit dans Supabase ; sinon, les 6 économies passent par leurs instituts nationaux (nouvelle exploration). Pas de relais par le Mac (T-042).

## T-058 — Sources nationales de P3 · 24/11/2026

**Contexte.** La sonde `/api/macro/probe` de Vercel (région cdg1) reçoit elle aussi HTTP 500 de l'OCDE, le 24/11/2026. Exploration des sources nationales, depuis le Mac puis depuis Supabase (`docs/exploration-p3.md` § 8) : toutes répondent à Supabase.

**Décisions de Clément :**

- **grille nationale approuvée** ; elle remplace le point « 6 autres économies : API de l'OCDE » de T-056 :
  - Royaume-Uni : copie DBnomics de l'ONS ;
  - Japon : copie DBnomics de Statistics Japan, plus FRED pour le chômage et le PIB ;
  - Suisse : API de la BNS ;
  - Canada : API de Statistics Canada ;
  - Australie : copie DBnomics de la RBA ;
  - Nouvelle-Zélande : FRED pour le chômage et le PIB ;
- **IPC néo-zélandais** : « — » avec la raison. Stats NZ exige une clé ; elle sera demandée plus tard si besoin. Le thème Inflation compte avec 7 économies ;
- **thème Sentiment** : affiché avec les indices libres (États-Unis ; zone euro, Japon et Suisse à vérifier), sans compter dans le score tant que moins de 6 économies sont connues. Les indices du Royaume-Uni, du Canada, de l'Australie et de la Nouvelle-Zélande sont privés.

## T-059 — P4 en parallèle de la porte P1 · 24/11/2026

**Contexte.** P3 est en service depuis le 24/11/2026. La porte de P1 (IPC capté et affiché en moins d'une seconde) ne peut se passer que le 10/12. T-049 et T-053 ne valaient que pour P2 et P3.

**Décision de Clément.** P4 (sentiment et liquidité) commence sans attendre le 10/12 : plan, puis code. Mêmes conditions que T-049 :

- rien de P4 ne modifie la capture de P1 ; P4 a sa propre Edge Function (`p4-jobs`), ses tables et ses écrans ;
- les jalons de P1 (04/12, 08/12, 10/12) passent avant, sans déploiement ces jours-là.

**Question posée à Clément.** Le cuivre n'existe qu'en mensuel chez FRED (`PCOPPUSDM`), et aucune série quotidienne libre ne donne le prix des obligations longues. Proposition : des ETF lus par Tiingo, des séries recalculées depuis FRED, ou retirer les deux composantes.

**Décision de Clément.** Proxys quotidiens par des ETF, lus par Tiingo (clé de T-051) et nommés comme tels à l'écran :

- composante « Cuivre / or » : CPER / GLD ;
- composante « Actions vs refuge » : SPY / TLT.

## T-060 — Sources de P4 · 24/11/2026

**Contexte.** Exploration S0 du 24/11/2026 (`docs/exploration-p4.md`), depuis le Mac et depuis Supabase (`p4-jobs`, tâche `explore`). Toutes les sources répondent depuis Supabase, sauf la page du Bank Participation Report (403, vérification Cloudflare). FRED a un jour ouvré de plus de retard que Cboe et Tiingo sur le VIX et le S&P 500.

**Décisions de Clément.**

- **VIX** : fichier officiel de Cboe (`VIX_History.csv`) ; FRED (`VIXCLS`) en repli.
- **S&P 500** : clôture de SPY chez Tiingo (déjà relevée pour « Actions vs refuge »), nommée « SPY » à l'écran, pour la composante et pour le graphique sur un an.
- **Écart haut rendement** : FRED (`BAMLH0A0HYM2`), seule source libre, un jour ouvré de retard affiché.
- **Positions des banques** : catégorie « dealers » du rapport TFF (API Socrata de la CFTC, hebdomadaire), nommée comme telle. À l'étape S3, essai de lecture du BPR depuis Vercel ; s'il répond, une tâche mensuelle l'ajoute, sinon l'écran affiche « — » avec la raison.
- **Liquidité nette de la Fed** : `WALCL − WDTGAL − RRPONTSYD`, les trois au mercredi, le reverse repo converti de milliards en millions. `WDTGAL` remplace `WTREGEN` (moyenne de la semaine) prévu au plan. Unités à confirmer en S1.

## T-061 — Section Backtest avant P5 · 24/11/2026

**Contexte.** P4 est en service depuis le 24/11/2026. Clément demande une section de backtest avant de commencer P5, dans l'esprit des outils de recherche quantitative de LuxAlgo (jamais leur nom, leur logo ni leurs textes). Plan : `~/.claude/plans/hidden-bubbling-quilt-of-fc7c07be-d554-4b51-aaf8-3edfa4060801.md`.

**Décision de Clément.** La section est construite avant P5, aux conditions de T-049 :

- rien ne touche à la capture de P1 ; aucun déploiement les 04/12, 08/12 et 10/12 ;
- P5 attend la fin de la section.

**Réponses de Clément.**

- **Trois façons d'obtenir une stratégie** : assistant IA (texte, capture d'écran ou indicateur connu vers Pine Script, avec une boucle de recherche autonome), éditeur de code sans IA, bibliothèque de stratégies connues. Fournisseur IA : Gemini, clé ajoutée par Clément dans `.env`.
- **Actifs** : BTC et ETH (OKX) en quotidien, 1 h et 4 h ; Nasdaq 100 par QQQ et S&P 500 par SPY (Tiingo), en quotidien.
- **Simulation** : long et short, frais et glissement actifs par défaut, modifiables.
- **Tuiles notées**, en grille « bento », de la moins importante à la plus importante : taux de réussite [E], PnL total [D], RR [C], espérance E[X] [B], drawdown maximal [B], Sharpe [A], t-stat [A], Sharpe déflaté [S]. La note qualifie l'importance de la mesure, pas le résultat.
- **Hors périmètre** (décisions à venir) : agent graphique (FVG, order blocks, liquidité, killzones, alertes posées par l'IA) et cartes d'exécution en paper trading : le terminal ne passe jamais d'ordre.

## T-062 — Moteur du backtest · 24/11/2026

**Contexte.** Exploration S0 (`docs/exploration-bt.md`) : PineTS 0.13.1 (dépôt LuxAlgo/PineTS) exécute le Pine Script v5/v6 natif sur nos bougies OKX, 50 000 barres en 235 ms, avec un émulateur de courtier qui reproduit TradingView, appels de marge compris.

**Décisions de Clément.**

- **Moteur** : PineTS, pour l'éditeur, les stratégies connues et le code écrit par l'IA. Licence AGPL-3.0 acceptée pour un usage strictement personnel, sans redistribution (règle du projet).
- **Appels de marge** : désactivés par défaut (levier 1, `margin_long=0`, `margin_short=0`) dans nos modèles et stratégies connues ; activables, et indiqués à l'écran.
- **Mesures** : les tuiles notées sont calculées par notre module `metrics.ts` à partir des transactions de l'émulateur, testées et comparées à un script Python de référence ; les mesures de l'émulateur servent de contrôle.

## T-063 — IA du backtest · 24/11/2026

**Contexte.** Étape S3 (assistant IA de la section Backtest). Tarifs relevés sur la page officielle de Google le 24/11/2026 : Gemini 3.8 Flash 0,75 $ / 3,75 $ par million de jetons en entrée / sortie jusqu'au 31/12/2026 ; Gemini 3.1 Flash-Lite 0,25 $ / 1,50 $ ; Gemini 3.1 Pro Preview 2 $ / 12 $, sans offre gratuite. L'offre gratuite existe pour les modèles Flash et Flash-Lite ; Google indique qu'il peut s'en servir pour améliorer ses produits.

**Décisions de Clément.**

- **Offre gratuite seulement, plafond de 0 $ par jour.** Modèle : Gemini 3.1 Flash-Lite, le moins cher, pour écrire, réparer et expliquer les stratégies.
- **Garantie de gratuité** : elle ne dépend pas du terminal mais du projet Google de la clé, qui doit rester sans facturation ; une clé d'un projet facturé serait payante dès le premier appel. Aucun appel réel avant la confirmation de Clément.
- **Quota** : un plafond d'appels par jour côté terminal, journal des appels dans Supabase ; quand Google refuse (quota gratuit épuisé), les routes répondent « quota gratuit atteint », sans bascule vers un modèle payant.
- **Clé** : copiée dans les secrets de Supabase le 24/11/2026 (pour la recherche autonome, S4) ; ajoutée par Clément dans les variables de Vercel (production). Jamais dans le bundle.
- **Ce qui part chez Google** : le texte de la demande, la capture d'écran éventuelle, le code Pine et nos mesures calculées ; aucune clé, aucune donnée de compte.


## T-064 — Recherche autonome du backtest · 24/11/2026

**Contexte.** Étape S4 de la section Backtest. Une boucle de 50 essais avec une réécriture par Gemini à chaque essai consommerait à elle seule le plafond de 50 appels par jour fixé par T-063. Le quota gratuit de Google pour Gemini 3.1 Flash-Lite n'est pas publié sur la page officielle (environ 500 requêtes par jour selon des relevés d'utilisateurs, non officiels).

**Décisions de Clément.**

- **Hybride** : Gemini réécrit la logique de la stratégie tous les 5 essais (réglable de 2 à 20), à partir du meilleur essai ; entre deux, la boucle fait varier les paramètres numériques (`input.*`) du meilleur essai, sans IA, avec une graine fixe. Une recherche de 50 essais coûte environ 10 à 15 appels.
- **Modèle et plafond inchangés** (T-063) : Gemini 3.1 Flash-Lite seul, offre gratuite, sans modèle de repli ; les appels de la recherche comptent dans le même plafond de 50 par jour de Paris que l'assistant. Plafond atteint : la recherche attend le lendemain et reprend où elle était ; quota de Google refusé (429) : nouvel essai une heure plus tard.

**Règles retenues pour la boucle** (plan de S4) :

- note partielle de 0 à 100 : moyenne des crédits des critères dans l'échantillon (crédit = valeur / seuil, plafonné à 1), moyennée sur les marchés du plan ;
- hors échantillon à l'aveugle : consulté seulement pour un essai qui passe tous les critères dans l'échantillon, réduit à réussi / échoué, jamais transmis à Gemini, montré seulement quand la recherche est finie ; un candidat passe dans et hors échantillon, sinon la recherche continue ;
- N du Sharpe déflaté = nombre d'essais valables de la recherche ;
- bornes des données fixées à la création (dernière barre close ; pour le 4 h, dernière tranche complète) : un rejeu des essais redonne la même empreinte (sauf cours ajustés de Tiingo après un dividende) ;
- la boucle tourne dans `bt-jobs` (Supabase, tâche `loop`, pg_cron chaque minute quand une recherche attend) : le moteur, PineTS compris, y est regroupé dans `research-core.gen.js` (`web/scripts/build-research-core.mjs`) ; une recherche à la fois.

## T-065 — Architecture et plateformes de P5 · 24/11/2026

**Contexte.** La section Backtest est finie (S4 en service, `785ddd5`) ; Clément lance P5 (microstructure BTC). Plan : `~/.claude/plans/pure-splashing-scone-of-98c0bcdc-0bfa-451e-84e1-b8d97c9e3490.md`. Tout doit tourner sans le Mac (T-042) : Vercel ne garde pas de WebSocket ouverte et une Edge Function ne dure que 150 s.

**Fait relevé le 24/11/2026** (requêtes avec en-tête Origin) : les REST de Binance (fapi, api), Bybit, Coinbase, Hyperliquid et `www.okx.com` acceptent le navigateur (CORS) ; `eea.okx.com` non.

**Décisions de Clément.**

- **Flux temps réel dans le navigateur, dans les trois modes** : un worker dédié à la microstructure lit les WebSockets publiques des plateformes (aucune clé) et garde ses flux ouverts tant que l'application est ouverte. La passerelle Python n'est pas touchée.
- **Historique** : la CVD sur 4 h est reconstruite à l'ouverture à partir des bougies 1 min (volume preneur) ; funding et open interest viennent du REST ; la carte de profondeur et les liquidations se remplissent depuis l'ouverture du terminal. Aucun stockage côté serveur, aucune tâche Supabase.
- **Plateformes** : perpétuels OKX, Binance, Bybit, Hyperliquid ; spot (CVD) Binance, OKX, Coinbase.
- **Vercel** : aucune 13e fonction ; un REST d'OKX EEA nécessaire passe par une route d'une fonction existante.

## T-066 — drexbot hors du terminal · 24/11/2026

**Décision de Clément.** drexbot n'entre jamais dans ce projet : ni la carte `hl-map`, ni le lac de trades, ni les journaux du bot, ni ses scripts. **Remplace** la section « Ce que le terminal peut réutiliser » de `docs/integration-drexbot.md` et toute mention d'une lecture du bot dans `docs/plan.md` (fenêtre de trading D-001 sur les graphiques, journal de décision dans le Track record).

## T-067 — Sources de P5 · 24/11/2026

**Contexte.** Exploration S0 (`docs/exploration-p5.md`). `eea.okx.com` renvoie des listes vides pour trois historiques publics (volume preneur du perpétuel, historique de l'OI, liquidations récentes) et refuse le navigateur (CORS) ; `www.okx.com` les sert et accepte le navigateur.

**Décision de Clément.** `www.okx.com` est utilisé pour l'historique public d'OKX seulement : volume preneur du perpétuel (rattrapage de la CVD), historique de l'OI (variation 24 h), liquidations de la dernière heure, et cliché profond du carnet (`books-full`, ±1,4 %). Aucun compte, aucune clé, aucune fonction Vercel. Le temps réel d'OKX reste sur `wseea.okx.com` (T-008 inchangé pour tout le reste).

**Sources retenues** (détail et mesures dans `docs/exploration-p5.md`) :

- **Binance USDⓈ-M** : chemins routés `/public` (carnet) et `/market` (aggTrade, forceOrder, markPrice) ; l'ancienne URL ne reçoit plus que le carnet.
- **Liquidations** : Binance et OKX sont des **planchers** (au plus un envoi par seconde, documenté par chaque plateforme) ; Bybit (`allLiquidation`) se dit complet (envoi toutes les 500 ms) ; Hyperliquid n'a **aucun flux public** de liquidations : « — » avec la raison.
- **Rattrapage de la CVD (4 h)** : Binance spot et perp (bougies 1 min, volume preneur), OKX perp (`www`, 5 min) et spot (5 min). Bybit, Hyperliquid et Coinbase n'ont pas d'historique de volume preneur : direct seulement, signalé à l'écran.
- **Variation 24 h de l'OI** : Binance, Bybit, OKX (`www`) ; Hyperliquid « — » (aucun historique public).

## T-068 — Statistiques d'OKX pour P5 · 25/11/2026

**Contexte.** En S3, les statistiques `rubik` de `www.okx.com` retenues par T-067 (volume preneur du perpétuel et du spot pour le rattrapage de la CVD, historique de l'OI pour la variation 24 h) se sont révélées sans en-tête CORS : le navigateur ne peut pas les lire (le relevé S0 n'avait vérifié que `books-full` et les liquidations, qui l'acceptent). Repli provisoire : OKX hors des courbes de CVD et « — » pour sa variation 24 h de l'OI.

**Décision de Clément** (recommandation présentée : relais par une fonction existante, sans 13e fonction, conformément à T-065). Les trois statistiques passent par la fonction Vercel `api/okx-time.ts`, sous `GET /api/okx-time?stat=taker-perp|taker-spot|oi-hist` :

- liste blanche fixe (`api/_lib/okx-stats.ts`), aucun paramètre libre, réponse d'OKX renvoyée inchangée ; tout code OKX ≠ 0 donne une erreur 502 ;
- cache CDN de 60 s (volume preneur, 5 min) et de 300 s (OI horaire) : les onglets partagent les appels à OKX ;
- la même route sert le serveur de développement (middleware `vite-plugins/api-dev.ts`) ; le front l'appelle sur sa propre origine, dans les trois modes.

**Complète T-067**, qui reste valable pour `books-full` et les liquidations, lus directement par le navigateur.

## T-069 — Microstructure en continu sur Oracle Cloud · 25/11/2026

**Demande de Clément.** Que la microstructure tourne fenêtre fermée, sans rien sur le Mac ni sur la tour, gratuitement. Vercel (pas de WebSocket qui reste ouverte) et Supabase (Edge Functions de 150 s au plus et 2 s de calcul par exécution, relevé T-042) ne le permettent pas. Options présentées : Oracle Cloud Always Free (recommandée), Cloudflare Durable Objects (limite de requêtes non vérifiée pour les WebSockets sortantes), Koyeb (mise en veille, 0,1 cœur), version dégradée sur Supabase (relevé REST chaque minute). Google Cloud gratuit est exclu : régions américaines seulement, que Binance bloque.

**Faits vérifiés le 25/11/2026** (docs.oracle.com, pages *Free Tier* et *Always Free Resources*) : carte et téléphone demandés à l'inscription, « your credit card will not be charged unless you upgrade your account » ; après l'essai de 30 jours, le compte reste actif et les ressources Always Free continuent sans interruption ; Ampere A1 gratuit jusqu'à 2 OCPU et 12 Go (1 500 OCPU-heures et 9 000 Go-heures par mois), 200 Go de stockage bloc, 10 To de sortie par mois ; ressources gratuites seulement dans la région de rattachement, choisie à l'inscription ; une instance est réputée inactive, et peut être récupérée, si sur 7 jours le 95e centile du processeur, le réseau **et** la mémoire (A1) restent tous sous 20 %. Aucune exemption écrite pour les comptes passés en paiement à l'usage.

**Décision de Clément** (« ok à condition que ce soit 100 % gratuit ») :

- compte Oracle créé par Clément, région de rattachement en France (Paris ou Marseille, à confirmer à l'inscription), **jamais** passé en paiement à l'usage : aucune facturation possible ;
- une machine A1 dimensionnée petite (1 OCPU, 2 Go) : le système et les services y dépassent 20 % de mémoire, ce qui suffit à ne pas être « inactif » ; contrôle sur les métriques d'Oracle la première semaine ;
- le moteur de P5 (`web/src/micro/engine.ts`, déjà exécuté tel quel sous Node) y tourne en service, avec redémarrage automatique ; le navigateur y récupère l'historique à l'ouverture ;
- plan détaillé (service, accès https, sécurité, données servies, tests) présenté et validé avant tout code.

**Révise T-065** sur un point : « aucun stockage côté serveur ». Le reste de T-065 (flux publics, aucune clé, worker du navigateur) demeure ; le worker reste la source en direct quand la machine est injoignable.

## T-070 — Recherche autonome du backtest sur Oracle · 25/11/2026

**Contexte.** Première feature Oracle de `docs/todo.md`. La boucle de la recherche autonome (T-064) avance sur Supabase par passages d'une minute limités à 900 ms de calcul (limite de 2 s de CPU des Edge Functions). Plan validé par Clément : `~/.claude/plans/scalable-purring-treehouse-of-b3553999-b571-4bbf-81b0-a23e98ed9831.md`.

**Décision de Clément** (approbation du plan) :

- la même boucle (`supabase/functions/bt-jobs/loop.ts`) tourne en continu sur la machine Oracle, service `terminal-bt` : passages de 5 min de calcul au plus, bail de 6 min renouvelé après chaque essai ; une recherche dont le bail a été repris ailleurs n'est plus écrite ;
- repli : si `terminal-bt` s'arrête, le bail expire et le cron de Supabase (`cron-bt.sql`, inchangé) reprend la recherche ;
- règles inchangées : Gemini gratuit seulement, plafond de 50 appels par jour de Paris compté dans `bt_ai_calls` (T-063), hors échantillon à l'aveugle (T-064) ;
- **secrets sur la machine** (révise T-069) : URL de Supabase, clé secrète Supabase **dédiée** « oracle » (révocable seule) et GEMINI_API_KEY, dans `/etc/terminal/bt.env` (root:terminal, 0640), lus par `terminal-bt` seul ; `terminal-micro` reste sans secret ; posés par `deploy/oracle/deployer.sh <ip> secrets` depuis le `.env` du Mac, par l'entrée standard de SSH ;
- `terminal-bt` passe après la microstructure : `Nice=10`, `CPUQuota=80%`, `MemoryMax=1500M`.

## T-071 — Alertes à la seconde sur Oracle · 25/11/2026

**Contexte.** Deuxième feature Oracle de `docs/todo.md`. T-046 jugeait les alertes de prix à la minute sur les bougies 1 min (2 à 3 min de retard, bougies écrites par le collecteur environ 2 min après leur ouverture). Plan validé par Clément (même fichier de plan que T-070).

**Décision de Clément** (approbation du plan) :

- les alertes de prix (BTC-USDT-SWAP, ETH-USDT-SWAP) sont jugées sur **chaque trade** par la machine Oracle, service `terminal-alerts`, avec le moteur d'alertes existant (`p1-jobs/alerts.ts` : règles, base, Telegram) ;
- la clé de dédoublonnage est la minute du franchissement au format que PostgREST renvoie pour `okx_candles_1m.t` (`2026-11-25T17:42:00+00:00`, relevé le 25/11/2026) : Supabase, inchangé, reste le repli à la minute et ne peut pas doubler une alerte ;
- deux nouvelles sortes, sur Oracle seulement, nourries par le flux local de la microstructure (aucun second collecteur) : **liquidations** (montant sur une fenêtre de 1 à 60 min, rappel des planchers de Binance et d'OKX) et **mur retiré** (changement observé du carnet, jamais un stop supposé) ; la passerelle Python du Mode Local ne les connaît pas ;
- secrets : `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` et la clé Supabase « oracle » dans `/etc/terminal/alerts.env` (root:terminal, 0640), lus par `terminal-alerts` seul ;
- **révise T-046** pour les alertes de prix ; funding, calendrier et actus restent sur Supabase à la minute ; Tree of Alpha fait l'objet de la feature suivante.


## T-072 — Tree of Alpha en ligne sur Oracle · 25/11/2026

**Contexte.** Troisième feature Oracle de `docs/todo.md`. T-046 avait abandonné Tree of Alpha en ligne : son flux est une WebSocket que ni Vercel ni Supabase ne gardent ouverte. Écoute de 3 jours (20–23/11, `docs/exploration-p1.md`) : environ 3,5 messages par heure, tweets sans délai, Blogs et usGov retardés de 5 s sur le flux gratuit, aucun chiffre macro, connexion coupée toutes les 70 s environ. Plan validé par Clément : `~/.claude/plans/fluttering-baking-balloon-of-f9cc3ae9-2d73-4f7b-887b-25f45294f5a0.md`.

**Décision de Clément** (approbation du plan) :

- le flux gratuit, sans clé (T-021), est lu 24 h/24 par la machine Oracle, service `terminal-news` ;
- chaque message devient un titre de `news_items` après les quatre couches de doublons des RSS (fonction `isDuplicate` partagée), publié dans `p1_state` (`news:item:<id>`, diffusé par Realtime) et soumis aux mêmes alertes par mot-clé et par catégorie ;
- l'état du flux (`feed:toa`) rejoint la barre de flux ; la fraîcheur se juge sur la connexion (des silences de 17 min sont normaux) ;
- aucun nouveau secret : `terminal-news` lit `/etc/terminal/alerts.env` (T-071) ;
- **révise T-046** sur Tree of Alpha. Abonnement payant (sans délai) toujours écarté (T-021).

## T-073 et T-074 — P6 lancée, ses choix · 25/11/2026

**Contexte.** Clément lance P6 (assistant et compte) alors que la porte de P5 (séance S4) reste à passer, comme pour T-049, T-053 et T-059. Plan validé : `~/.claude/plans/fluttering-baking-balloon-of-f9cc3ae9-2d73-4f7b-887b-25f45294f5a0.md`.

**Faits relevés le 25/11/2026** (aistudio.google.com/docs/rate-limits et /pricing, anciennement ai.google.dev) : les limites gratuites (requêtes par minute, jetons par minute, requêtes par jour) ne sont pas publiées pour les modèles Flash-Lite, elles se lisent dans AI Studio, par projet (aistudio.google.com/rate-limit) ; les quotas quotidiens repartent à minuit, heure du Pacifique ; offre gratuite : entrées et sorties gratuites, **contenus utilisés par Google pour améliorer ses produits** ; aucune facturation sans passage explicite à un palier payant.

**Décisions de Clément.**

- **T-073** : plan puis code de P6 sans attendre la séance S4 ; P5 reste prioritaire pour S4 ; aucun déploiement les 04/12, 08/12 et 10/12.
- **T-074** :
  - IA : Gemini 3.1 Flash-Lite en offre gratuite seulement, même clé et même règle que T-063 (jamais de bascule payante, « quota atteint » sinon) ; l'assistant ne reçoit que des données publiques du terminal et l'article ouvert, jamais le journal de trading ;
  - plafonds par jour de Paris dans `bt_ai_calls` : backtest 50 (inchangé), assistant 60, traduction 30, récaps 6 ; à abaisser si le quota lu dans AI Studio est plus bas ;
  - traduction à la demande seulement (T-019 inchangé pour le fil) ;
  - noms définitifs : TERMINAL et « Assistant » (clôt T-006) ;
  - positions OKX reportées (pas de clé pour l'instant) : track record en saisie manuelle.

