# Plan « Tout en ligne » — P1 sans le Mac

> **Proposé le 23/11/2026** avec les décisions de Clément T-042 à T-046 (`docs/decisions.md`). À valider avant d'écrire le code.

Objectif : que la capture des chiffres du BLS, l'agenda, les alertes et Telegram tournent même Mac éteint, sur Supabase (Edge Functions, Cron, Postgres, Realtime) et Vercel (front, fonctions), avec la porte P1 en ligne le 10/12.

## 1. Ce qui change

| | Aujourd'hui (Mode Local) | En ligne |
| --- | --- | --- |
| Agenda ForexFactory, calendrier du BLS | service `calendar` de la passerelle | Edge Function `p1-calendar`, Cron toutes les heures (hh:45) et chaque jour |
| Capture du BLS à l'heure H | service `release` | Edge Function `p1-capture`, Cron à T−1 min, rafale, puis suite à T+1 min |
| Rattrapage, révisions, PPI sous-jacent (API v1) | service `release` | même fonction, Cron à T+15 min, T+60 min, 12:00 New York |
| Réaction du BTC | bougies OKX lues par la passerelle | table `okx_candles_1m` déjà remplie chaque minute par `okx-collector` |
| Alertes et Telegram | service `alert`, chaque trade | Edge Function `p1-alerts`, Cron chaque minute (bougie 1 min : haut et bas), Telegram depuis Supabase |
| Chiffre jusqu'à l'écran | WebSocket de la passerelle | Supabase Realtime, canal public `p1-public` (T-043) |
| Écrans Calendrier, Alertes, cloche | passerelle | fonction Vercel `api/p1.ts` (routeur unique, comme `api/bourse.ts`) |
| Fil d'actus (E6) | — | RSS chaque minute ; pas de Tree of Alpha (T-046) |

La passerelle Python reste : Mode Local, développement, et secours du Mac pour les trois dates (T-045).

## 2. Étapes

| Étape | Contenu | Vérification | Date visée |
| --- | --- | --- | --- |
| **O0** Sonde | tâche `explore` d'une Edge Function : une requête vers chaque page du BLS, l'API v1, ForexFactory, Telegram (`getMe`, sans message), OKX ; rien en base | réponses relues : **go / no-go** (403 du BLS ou de ForexFactory = no-go pour cette source) | 24/11 |
| **O1** Tables | migration Supabase : `indicators`, `calendar_*`, `official_releases`, `releases`, `release_*`, `alert_*` (RLS sans politique) ; copie des données du Mac (archive ForexFactory depuis le 20/11, publications) | migration appliquée ; comptes de lignes égaux — **fait le 23/11/2026** : migration `20261123120000_p1_online.sql` appliquée (`db push --remote`), copie par `scripts/p1_copy_to_supabase.py` sans écart (rejouable), 20 relevés ForexFactory identiques octet pour octet ; test de parité des schémas `gateway/tests/test_online_schema.py` | 25/11 |
| **O2** Agenda en ligne | portage TypeScript de la lecture ForexFactory et de `bls.ics`, tests contre les mêmes fichiers de référence que Python | relevé horaire visible dans l'écran Calendrier en Mode Online — **codé le 23/11/2026, à déployer** : `calendar.ts` (fichier doré partagé avec Python), tâches `ff-calendar` et `bls-calendar` de `p1-jobs`, table `p1_state` (migration `20261123140000`), `supabase/cron-p1.sql`, route Vercel `api/p1.ts`, relecture en Mode Online (`web/src/data/online/p1.ts`) | 27/11 |
| **O3** Capture en ligne | portage du parseur `bls_release.py` (tests dorés : `expected.json`, 124 communiqués), rafale dans les limites d'une Edge Function (≤ 150 s, ≤ 2 s de CPU : lecture complète seulement quand la date d'embargo change), rattrapage, API v1, réaction du BTC | essai réel le **04/12** (rapport emploi), en parallèle du Mac — **codé le 23/11/2026, à déployer** : parseur `bls_release.ts` (fichier doré : lecture Python des 124 pages, au caractère près), `bls_api.ts` et `surprise.ts` (calcul décimal exact, fichier doré), tâche `capture` de `p1-jobs` appelée chaque minute (rafale à T−1 min avec verrou en base, suite toutes les 10 s jusqu'à T+5 min, rattrapage page puis API, révisions et PPI sous-jacent par l'API, réaction du BTC depuis `okx_candles_1m`), chiffres publiés dans `p1_state` et servis par `/api/p1/state` | 02/12 |
| **O5** Front en ligne | client Realtime (clé publishable), écran Calendrier et bandeau en Mode Online, heure d'affichage renvoyée par `api/p1` | Playwright : chiffre affiché < 1 s après son écriture ; **répétition le 08/12** — **en service le 23/11/2026** (contrôle `web/scripts/check-realtime.mjs` : message reçu 93 ms après l'écriture en base) : trigger `p1_state_broadcast` (migration `20261123160000`, `realtime.send` sur le canal public `p1-public`, jamais les verrous), client `@supabase/realtime-js` 2.119.0 (`web/src/data/online/realtime.ts`, clé publishable seulement, refus d'une clé secrète), relecture de secours toutes les 15 s quand Realtime est coupé, heure d'affichage par `POST /api/p1/displayed` (première seulement, dans la minute, écrite dans `release_timings`) | 03/12 |
| **Porte** | CPI du 10/12 capté en ligne, Mac en secours | délais enregistrés et affichés | 10/12 |
| **O4** Alertes en ligne | règles en base, évaluation chaque minute, Telegram depuis Supabase, écran `/alertes` et cloche en Mode Online (écritures derrière le mot de passe T-031) | essai Telegram depuis Supabase | après le 10/12 — **codé le 23/11/2026, à déployer** : portage de `alert_rules.py` vérifié contre un fichier doré Python (`scripts/make_alerts_golden.py`), moteur `p1-jobs/alerts.ts` (tâche `alerts` chaque minute ; appel direct par la capture pour « chiffre publié » et « surprise », par la tâche `news` pour « mot-clé »), Telegram `p1-jobs/telegram.ts` (jeton seulement dans Supabase). Prix : bougies 1 min d'`okx_candles_1m` (haut et bas, T-046), soit 2 à 3 min de retard en ligne. Écritures : `/api/alerts/*` (session du mot de passe d'application, même origine) relayées à la tâche `alerts-cmd` avec `P1_JOBS_SECRET`, **variable à ajouter dans Vercel**. État lu par `/api/alerts/state` toutes les 20 s, jamais sur le canal public |
| **O6** Fil d'actus en ligne | E6 directement en ligne (RSS) | — | après O4 — **codé le 23/11/2026, à déployer** : tâche `news` chaque minute (15 flux, GET conditionnel ; toutes les 3 s dans la fenêtre d'une décision Forte de l'agenda, T-1 min à T+10 min), pièges de fuseau testés sur les captures du 20/11, doublons en quatre couches, règles versionnées (`news_rules.ts`, `RULES_VERSION`), 25 rubriques récurrentes de FinancialJuice écartées et comptées, arriéré jamais annoncé, 403/429 : pause d'une heure. Table `news_items` et diffusion `news:item:*` (migration `20261124120000_p1_news.sql`). Écran `/actus` (fil et lecture ; assistant en P6), panneau « Titres urgents », squawk des titres urgents en VO. Non fait : chiffre provisoire tiré de FinancialJuice (T-022), le BLS capté en ligne arrivant avant |

Le service `release` du Mac reste actif jusqu'au 10/12 inclus (secours), puis passe en option.

## 2 bis. Résultats de O0 (23/11/2026, 12:19 Paris) : go pour toutes les sources

Fonction `p1-jobs` déployée dans la région `eu-west-3` (Paris), appelée une fois (`?job=explore`), rapport dans `data/explore/p1-online-o0.json` (hors dépôt).

| Source | Résultat depuis Supabase |
| --- | --- |
| BLS, pages résumé et complète, `bls.ics`, index des archives | 200, aucun octet nul, mêmes pools (`WP1`, `WP2`) que depuis le Mac ; 30 à 100 ms (454 ms pour la première, ouverture de connexion) |
| API v1 du BLS | `REQUEST_SUCCEEDED` en 517 ms ; `WPSFD49104` lisible |
| ForexFactory | 200 en 62 ms, Cloudflare, `Last-Modified` et `ETag` présents, 75 événements |
| Telegram | `getMe` : jeton valide (`@terminaldrexbot`), aucun message envoyé |
| OKX EEA | horloge de la fonction à −30 ms de celle d'OKX |

Conséquences pour la suite :

- **Aucun refus d'adresse IP** : la capture en ligne est possible (risque principal levé).
- **Horloge juste** (±30 ms contre OKX) : la fonction peut attendre T−3 s elle-même.
- **CPU sans souci** : recherche de l'embargo 0,03 ms, lecture complète d'une page de 90 ko 1,9 ms. Soixante-dix lectures complètes coûtent ~0,13 s sur les 2 s permises : la rafale peut tout lire à chaque requête, comme sur le Mac. Le point délicat « 2 s de CPU » du § 3 tombe.
- Reste à mesurer : le délai de démarrage d'une fonction appelée par Cron (à froid), à la première répétition.

## 3. Points délicats

- **Précision de la rafale** : Cron déclenche à la minute ; la fonction attend elle-même T−3 s. Démarrage à froid et horloge de la fonction mesurés en O0 (écart à l'en-tête `Date` du BLS).
- **2 s de CPU** : levé par O0 (lecture complète d'une page : 1,9 ms).
- **Mise en pause de l'offre gratuite** (T-044) : `okx-collector` écrit chaque minute ; si cela ne suffit pas, passage à Pro.
- **Clé publishable** (T-043) : elle ne donne accès qu'au canal public ; aucune table n'a de politique RLS. `check-bundle` vérifie qu'aucune clé secrète n'entre dans le front.
- **Deux mises en œuvre** : Python et TypeScript testés contre le même corpus et les mêmes fichiers de référence ; une divergence fait échouer la CI.

## 4. Ce dont j'ai besoin de toi

| Quand | Quoi |
| --- | --- |
| O0 | déployer la fonction de sonde (`supabase functions deploy …`) et lancer l'appel, comme pour `bourse-jobs` (le connecteur Supabase de Claude ne voit pas ce projet) |
| O1 à O5 | `supabase db push --remote` (CLI 3.x : `--remote` obligatoire ; mot de passe exporté depuis le `.env` : `export SUPABASE_DB_PASSWORD="$(grep '^SUPABASE_DB_PASSWORD=' .env | cut -d= -f2- | tr -d '"')"`), déploiements, secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `BLS_CONTACT_EMAIL`) dans Supabase |
| 04/12, 08/12, 10/12 à 14:15 | Mac allumé, passerelle lancée (secours) |
