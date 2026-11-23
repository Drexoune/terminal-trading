# Plan P1 — Calendrier et actus

> **Proposé le 27/10/2026, révisé le 11/11/2026 avec les décisions de Clément (T-015 à T-025, `docs/decisions.md`), validé le 11/11/2026 (T-026). Calendrier d'ici la porte révisé le 19/11/2026 (T-035).**

Sources de ce plan : `docs/plan.md`, `docs/ecrans.md` (§ 1 à 3), les maquettes `Calendrier`, `Actus` et `Main`, le code de P0, et une recherche documentaire contre-vérifiée (docs officielles, dépôts publics qui consomment ces sources). Depuis l'environnement de développement, seul le flux ForexFactory est joignable (relevé en réel les 26 et 27/10/2026). Le BLS, Tree of Alpha et les banques centrales ne le sont pas : leurs formats viennent de vraies captures publiées sur GitHub, et tout ce qui est marqué « à mesurer » le sera par des scripts d'exploration lancés sur le Mac (étape E0, T-024).

## 1. Ce que P1 livre

| Module | Contenu | Écran |
| --- | --- | --- |
| Calendrier | agenda de la semaine, prévision ForexFactory, heure officielle, chiffre réel capté à la source, surprise, fiche indicateur, réaction du BTC | `/calendrier` (`USD ECO`), panneau « Prochains événements » de la Vue d'ensemble |
| Capture à l'heure H | CPI, rapport sur l'emploi (NFP, chômage, salaire horaire) et PPI lus sur bls.gov à 08:30 New York ; productivité et coûts (productivité, coûts salariaux unitaires) pour la répétition du 08/12 (T-035) | ligne du calendrier, bandeau, squawk, alerte |
| Fil d'actus | banques centrales, macro, crypto ; titres dans leur langue d'origine, marqués « VO » (T-019) | `/actus` (`TOP`), panneau « Titres urgents » |
| Squawk | annonce vocale des chiffres captés, des décisions de banque centrale et des titres urgents | bouton de la barre du haut |
| Alertes | prix et funding OKX, publication, seuil de surprise, T−5 min, mots-clés | cloche de la barre du haut, panneau « Alertes actives », écran `/alertes`, Telegram (T-020) |

Hors P1 :

- la traduction par IA (T-019) ;
- la colonne Assistant d'Actus (P6 ; un emplacement réservé garde la géométrie) et les « Points clés » (P6, T-025) ;
- dockview, les écrans HOURS et WATCH (après la porte, T-025) ;
- les alertes de liquidation (P5), les probabilités de taux (P2) ;
- la watchlist hors crypto (T-005 toujours ouverte).

## 2. Porte de sortie (T-015)

**Le CPI US de novembre, publié le jeudi 10/12/2026 à 08:30 New York (14:30 Paris), est capté sur bls.gov par la passerelle du Mac et affiché moins d'une seconde après sa première mise en ligne observée ; le délai total depuis 08:30:00 est mesuré et affiché.**

La date du 10/12 vient de calendriers tiers : l'exploration la confirme sur le calendrier du BLS. Le CPI du 10/11, visé par la première version de ce plan, est passé pendant l'arbitrage.

Pourquoi pas « moins d'une seconde depuis 08:30:00 » : le BLS bloque en temps réel les robots qui l'interrogent plusieurs fois par seconde (bls.gov/bls/pss.htm). À une requête par seconde, l'attente moyenne vaut déjà 0,5 s, plus le délai de mise en ligne du BLS, que personne ne publie.

**Calendrier d'ici la porte** (08:30 New York = 13:30 UTC = 14:30 Paris jusqu'en mars) :

| Date | Publication | Usage |
| --- | --- | --- |
| ven. 13/11, 14:30 | PPI d'octobre | mesure en rafale prévue, non lancée ; aucune autre publication du BLS à 08:30 avant le 04/12 |
| jeudis 19/11 et 03/12, 14:30 ; mer. 25/11 (Thanksgiving) | inscriptions au chômage (DOL) | mesures de délai, facultatives |
| ven. 04/12, 14:30 | rapport sur l'emploi de novembre | première mesure réelle : script d'exploration en rafale, sans lecture des chiffres (T-035) |
| mar. 08/12, 14:30 | productivité et coûts, 3e trimestre révisé | **répétition générale** de la capture complète (T-035) |
| jeu. 10/12, 14:30 | CPI de novembre | **porte** |
| mar. 15/12, 14:30 | PPI de novembre | après le 11/12, fin du financement fédéral : publication à risque |

## 3. Sources retenues

| Besoin | Source | Faits vérifiés | Limites et parades |
| --- | --- | --- | --- |
| Agenda + prévision | ForexFactory, `nfs.faireconomy.media/ff_calendar_thisweek.{xml,json}` | relevé en réel : semaine en cours seulement (dimanche → samedi, heure de New York), 6 champs (titre, devise, date, impact, prévision, précédent), **jamais de chiffre réel ni d'historique** ; le XML porte l'identifiant de série de ForexFactory (`78-us-cpi-mm`) et le code pays ; fichier régénéré vers hh:42, `ETag` et `Last-Modified` présents, requête conditionnelle → 304 ; 23 prévisions révisées en une journée | heures « Tentative », « All Day », « Sep Data » remplacées par une heure ordinaire sans marque : l'heure fait foi seulement si elle vient du calendrier officiel. Limite de débit annoncée sur un forum (2 par 5 min), jamais observée : un collecteur par IP, une requête conditionnelle par heure vers hh:45. Archive privée, jamais redistribuée (T-018) |
| Heure officielle | calendrier du BLS (`bls.ics` et pages par publication) | heures en heure de New York ; dates qui bougent (shutdowns 2025 et 2026) | lu une fois par jour, alerte si une date bouge ; financement fédéral jusqu'au 11/12/2026 seulement |
| Chiffre réel | pages `news.release/{cpi,empsit,ppi}.nr0.htm` de www.bls.gov | premier canal public depuis la fin du lockup (2020) ; période dans le `<title>` (« 2026 M10 Results ») ; ligne d'embargo datée | robots sans contact bloqués (403 Akamai) : User-Agent `terminal-trading/0.1 (<adresse dédiée>)` (T-023) ; une requête par seconde au plus ; l'API du BLS n'est **pas** à jour à 08:30 (base verrouillée avant chaque publication) : rattrapage seulement, en v1 sans clé (25 requêtes par jour) |
| Banques centrales | flux RSS de la Fed, BCE, BoE, BoJ, BNS, BoC, RBA, RBNZ | formats et pièges relevés sur de vraies captures (voir § 9) | domaine public (Fed, BCE MID), réutilisation avec attribution (BoC), usage personnel (BoJ) |
| Crypto | Tree of Alpha, `wss://news.treeofalpha.com/ws` | flux principal sans clé, pratique mais non documentée ; clé pour retirer le délai (abonnement 500 $/mois) | flux gratuit très clairsemé (1 message en 10 min mesuré par un tiers) : mesuré en E0 avant tout abonnement (T-021) |
| Secours chiffres | FinancialJuice RSS | titres structurés « US CPI YoY Actual 3.7% (Forecast 3.6%, Previous 3.4%) » | gratuit avec délai (10 à 20 s) : jamais la porte, seulement un chiffre « provisoire · fil d'actus » (T-022) |
| Téléphone | Bot Telegram | API HTTPS ; environ 1 message par seconde et par conversation | jeton et identifiant de conversation dans le `.env` du Mac (T-020) |

Exclus : CoinDesk et Cointelegraph (conditions interdisant l'automatisation), Yahoo et Finnhub (refusés), toute estimation de liquidations.

## 4. Où tourne quoi

| | Mode Local (Mac) | Mode Tour | Mode Online |
| --- | --- | --- | --- |
| Agenda ForexFactory | collecteur de référence, une requête par heure | même code, plus tard | Edge Function Supabase, une requête par heure (T-017) |
| Calendrier officiel du BLS | oui, une fois par jour | même code, plus tard | non : heure ForexFactory seule, marquée « indicative » |
| Capture BLS | **oui, la référence** (T-016) | plus tard, par une nouvelle décision | non : « — · capture en Mode Local » |
| Fil d'actus | oui | même code, plus tard | non : « — · fil d'actus en Mode Local » |
| Squawk | navigateur | navigateur | navigateur (agenda seulement) |
| Alertes | passerelle du Mac, Telegram compris | plus tard | non en P1 |

La porte se mesure en Mode Local, sur le Mac. Pendant une fenêtre de capture (T−15 min à T+10 min), la passerelle empêche la veille du Mac (`caffeinate`), et seulement pendant cette fenêtre. Mac endormi ou passerelle arrêtée : ni capture ni alerte téléphone, et l'écran le dit.

## 5. Architecture

**Passerelle** (Python, même process que P0) :

- `create_app` accepte plusieurs services : `OkxService`, `CalendarService`, `ReleaseService`, `NewsService`, `AlertService`, chacun avec `start()`, `stop()`, `health()`, activables par `GATEWAY_SERVICES` (une seule machine capte à la fois depuis la maison).
- `Bus` : suppression (valeur `null`), rétention bornée, écouteurs synchrones pour les alertes (une alerte de prix ne doit jamais manquer un franchissement à cause de la conflation).
- `storage.py` : SQLite en WAL dans `GATEWAY_DATA_DIR` (`data/`, ignoré par git), un seul fil d'écriture, migrations versionnées (T-003).
- Nouveaux préfixes : `calendar:week:2026-W46`, `calendar:next`, `release:<indicateur>:<période>`, `news:item:<id>`, `alert:rule:<id>`, `alert:fired:<id>`, `feed:<source>` (même forme que les flux OKX).
- REST : `/api/calendar?week=`, `/api/releases?indicator=`, `/api/news?before=`, `/api/alerts`.
- Configuration (`.env` du Mac, jamais dans le front) : `BLS_CONTACT_EMAIL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GATEWAY_SERVICES`, `GATEWAY_DATA_DIR`.

**Front** : nouveaux préfixes dans `WATCHED_TOPICS`, `useKeys(préfixe)`, seuils de fraîcheur par source (agenda horaire, fil en temps réel), barre de flux pilotée par les clés `feed:`, panneaux sans source en Mode Online affichant « — » avec la raison.

**Mode Online (T-017)** :

- Une Edge Function `ff-calendar`, appelée chaque heure par pg_cron (comme `okx-collector`), relève ForexFactory et écrit `calendar_snapshots` et `calendar_events` dans le projet Supabase existant. Les tables ont la RLS sans aucune politique (extension de T-012).
- Une fonction Vercel `/api/calendar` les lit avec la clé secrète, derrière la protection de déploiement.
- Le front les relit toutes les 5 minutes.
- Si ForexFactory refuse l'IP partagée de Supabase, le flux passe « périmé » avec la raison, sans contournement.
- Cette archive reste distincte de celle du Mac ; les prévisions retenues pour la surprise viennent du Mac.

## 6. Tables

| Table | Une ligne par | Colonnes clés |
| --- | --- | --- |
| `indicators` | indicateur suivi | libellé FR, devise, série officielle (`CUSR0000SA0`…), unité, décimales publiées, identifiant de série ForexFactory, cible de capture (oui/non) |
| `calendar_snapshots` | relevé ForexFactory | heure source (`Last-Modified`), heure de réception, statut HTTP, `ETag`, empreinte, contenu brut |
| `calendar_events` | version d'un événement | identité (série ForexFactory, devise, jour à New York, rang), indicateur, heure ForexFactory (indicative) et heure officielle (UTC + heure locale et zone IANA), impact, prévision brute et numérique, précédent, statut (prévu, déplacé, annulé, suspendu), vu pour la première et la dernière fois |
| `releases` | **première publication** d'un indicateur pour une période | valeur exacte telle que publiée (texte décimal), heure prévue, heure d'embargo lue sur la page, dernière interrogation sans le chiffre, première interrogation avec, en-tête `Date`, machine qui a capté, URL, nature (officielle ou provisoire), prévision retenue et son âge, surprise brute, z, n et raison si absent |
| `release_revisions` | révision | publication révisée, nouvelle valeur, source, date |
| `release_timings` | publication | heures sur le bus, d'envoi WebSocket, d'affichage (renvoyée par le front), écart d'horloge mesuré |
| `news` | titre | source, identifiant natif, URL canonique, titre et corps d'origine, langue, heure source, heure de réception, catégorie, urgence et règle déclenchée, grappe de doublons |
| `alert_rules`, `alert_events` | règle, déclenchement | condition, état (armée, déclenchée, acquittée), canaux, heure, résultat de l'envoi Telegram |

La première publication ne s'écrase jamais : une révision est une ligne à part. Mêmes tables `calendar_*` dans Supabase pour le Mode Online.

## 7. Capture à l'heure H (BLS)

1. **Calendrier** : chaque jour, `bls.ics` et les pages de calendrier par publication ; alerte si une date bouge ; contrôle croisé avec ForexFactory ; publication marquée « suspendue » en cas de shutdown.
2. **Rafale** :
   - T−15 min : la passerelle empêche la veille du Mac.
   - T−10 min : une requête pour ouvrir la connexion, et parseur testé sur la publication précédente. L'API du BLS est verrouillée avant chaque publication : un échec à ce moment n'est pas une panne.
   - T−60 s : une requête.
   - De T−3 s à T+60 s : une requête par seconde, une seule en vol.
   - Puis une requête toutes les 10 s jusqu'à T+5 min, et arrêt.
   - Soit environ 100 requêtes par publication, 3 à 4 publications par mois.
3. **Détection** : `<title>` avec une période plus récente que la dernière enregistrée, ligne d'embargo à la date prévue (jour de semaine vérifié). Une page avec la nouvelle période mais une autre date est marquée « en avance » ou « en retard » et signalée, jamais ignorée (le CPI de mai 2024 est sorti 31 min en avance).
4. **Lecture** : parseur qui échoue fermé, sur texte normalisé, avec la liste des verbes réels (« increased », « was unchanged », « changed little (+29,000) »…), testé sur les archives réelles des 36 derniers mois. Valeurs gardées en texte décimal, jamais en flottant. Bornes larges ; une valeur hors bornes est retenue et signalée. Le BLS annonce une refonte de ses communiqués (puces, tableaux XLSX) : tout changement de forme arrête la lecture et alerte, sans chiffre deviné.
5. **Secours** : en cas de réponse vide ou corrompue (un pool d'origine du BLS a servi des pages pleines d'octets nuls pendant deux semaines en octobre 2026), page complète de la publication, puis PDF, dans le même budget d'une requête par seconde. Titre FinancialJuice marqué « provisoire · fil d'actus » (T-022). Sur 403 ou 429 : arrêt immédiat, état « bloqué », aucun contournement.
6. **Mesure** : heure prévue, dernière interrogation sans le chiffre, premier octet avec le chiffre, fin de lecture, publication sur le bus, envoi WebSocket, affichage (heure renvoyée par le front), tout corrigé sur l'horloge OKX. La ligne affiche le délai de capture et le délai d'affichage.
7. **À la publication** :
   - bandeau et son ;
   - squawk, avec un texte français composé à partir des valeurs captées ;
   - message Telegram.
8. **T+30 min** : enregistrement de la réaction du BTC (bougies OKX de −5 à +30 min, gardées : OKX n'en sert que 24 h).

## 8. Surprise z (T-018)

- Toujours affichée : la **surprise brute** (réel − prévision), dans l'unité de l'indicateur.
- z = surprise / σ des surprises passées, sur les premières publications enregistrées avec leur prévision. La prévision retenue est la dernière version ForexFactory vue avant T, avec son âge (environ 48 min pour une publication à hh:30). ForexFactory ne donne aucun historique de prévision : on constitue le nôtre, à partir de maintenant.
- z s'affiche à partir de n = 8 publications et reste marqué « provisoire (n = …) » jusqu'à 24. Avant n = 8 : « — · historique insuffisant (n/8) », soit environ 8 mois pour un indicateur mensuel.
- Calcul de σ : plancher à la résolution publiée (0,05 pour un chiffre au dixième), publications irrégulières (shutdown 2025) exclues.
- Les barres « 5 ans » de la fiche indicateur montrent les premières publications reconstruites depuis les communiqués archivés du BLS (domaine public, une page toutes les 5 s, une seule fois), sans prévision avant notre archive.

## 9. Fil d'actus

- **Collecteurs** :
  - flux RSS des 8 banques centrales, toutes les 60 s, et toutes les 2 à 5 s dans la fenêtre d'une décision ;
  - Tree of Alpha, par WebSocket sans clé (T-021) ;
  - FinancialJuice, toutes les 60 s.
- **Pièges vérifiés sur de vraies captures** :
  - la Banque du Canada écrit l'heure de Toronto étiquetée `+00:00` ;
  - la BNS publie du RSS 2.0 avec `dc:date` seulement ;
  - le canal MID de la BCE a une date sans fuseau ;
  - le RBA ne garde que le dernier élément ;
  - la RBNZ refuse les serveurs (403), à vérifier depuis le Mac.

  Chaque flux a son contrôle de fuseau et ses tests.
- **Catégories et urgence** par règles versionnées (empreinte des paramètres, comme drexbot), jamais par l'IA : titre de décision de chaque banque (BoE insensible à la casse, RBNZ « on hold », BNS ancré sur la date), chiffre macro structuré, mots-clés crypto.
- **Dédoublonnage** en quatre couches : identifiant natif, URL canonique (double barre oblique de la BCE, http de la BoJ, `?xy=rss` de FinancialJuice), titre normalisé, quasi-doublon dans les 15 min. Deux chiffres différents ne sont jamais fusionnés.
- **Affichage** : titre et corps dans leur langue d'origine, marqués « VO » (T-019), avec la source, l'heure source et l'heure de réception.

## 10. Squawk

- Le bouton « Activer voix et son » de la barre du haut, à chaque chargement de page, débloque la voix (obligatoire sur Chrome et iOS) et le son.
- Un seul onglet par navigateur parle : la file vocale est commune à tout le navigateur. L'onglet qui parle est désigné par Web Locks.
- **En français**, par des modèles de phrase remplis avec nos données :
  - les chiffres captés : « IPC américain sur un mois : plus 0,3 pour cent, prévision plus 0,2 » ;
  - les décisions de banque centrale.
- **Dans leur langue d'origine**, avec une voix de cette langue : les autres titres urgents.
- Voix choisie par appareil et gardée localement. Le texte parlé passe par un normaliseur testé : « − » devient « moins », « % » devient « pour cent », « pb » devient « points de base ».
- File à priorité. Un chiffre capté interrompt le reste. Les titres de plus de 60 s sont abandonnés. Un chien de garde relance la file, en appelant `cancel()`.

## 11. Alertes

- Règles :
  - franchissement d'un prix OKX ;
  - funding au-delà d'un seuil ;
  - T−5 min avant un événement ;
  - publication d'un chiffre ;
  - |z| ou surprise brute au-delà d'un seuil ;
  - mot-clé dans un titre.
- Moteur dans la passerelle, sur écouteurs synchrones.
- Canaux :
  - cloche avec compteur ;
  - son généré par Web Audio ;
  - notification du système quand l'onglet est caché (ordinateur ; Safari ignore les options de regroupement, le dédoublonnage reste côté terminal) ;
  - **Telegram**, envoyé par la passerelle du Mac (T-020). L'envoi passe par une interface commune, pour qu'un autre canal puisse s'ajouter plus tard.
- Gestion des règles : un écran `/alertes` (commande `ALRT`) aux composants du design system, faute de maquette.

## 12. Écrans

- **Calendrier** :
  - barre d'outils (semaine, devises, impact, recherche) ;
  - table de la semaine avec les états « À venir », « En attente · compte à rebours », « Nouveau » (15 min) et « Publié » ;
  - fiche indicateur ;
  - réaction du BTC.
- **Actus** : fil et lecture en VO ; colonne Assistant réservée à P6 pour garder la géométrie.
- **Vue d'ensemble** : les trois panneaux P1 remplacent leurs emplacements, aux hauteurs de la maquette.
- **Comparaison aux maquettes** : géométrie à ±2 px sur `Calendrier.png` et `Actus.png`, avec des données de démonstration servies par la fausse passerelle (horloge figée au 19/10/2026 12:40 UTC), et aucun défilement horizontal à 390 px.
- **Écarts assumés avec la maquette** :
  - « UTC+2 » est calculé, pas écrit en dur ;
  - la puce « Maquette · données fictives » est remplacée par la source et sa fraîcheur ;
  - les titres sont en VO, la maquette les montre traduits (T-019) ;
  - la couleur de la surprise suit une seule règle (±0,25) ;
  - la ligne méta d'Actus passe à la ligne à 390 px ;
  - l'axe du graphique de réaction est proportionnel ;
  - la cible de 2 % ne s'affiche pas sur l'IPC (la Fed la définit sur le PCE).

## 13. Étapes

Une étape à la fois, chacune vérifiée avant la suivante.

| Étape | Contenu | Vérification |
| --- | --- | --- |
| E0 | Scripts d'exploration lancés sur le Mac (T-024) : ForexFactory, sonde BLS et calendrier, **rafale sur le rapport emploi du 04/12** (mesure seule, T-035), communiqués archivés, Tree of Alpha sur quelques jours, flux RSS, FinancialJuice, page de test des voix. Les réponses deviennent les fichiers de référence des tests. | fichiers reçus et relus |
| E1 | Socle de la passerelle : services multiples, Bus, SQLite, configuration ; côté front, préfixes et fraîcheur par source | tests Python et Vitest — **codé le 20/11/2026** : `services.py` (GATEWAY_SERVICES), Bus (suppression, rétention, écouteurs synchrones), `storage.py` (WAL, fil unique, migration 1 : tables de l'agenda), `useKeys` et seuils de fraîcheur par source dans la barre de flux |
| E2 | Calendrier sans capture : ForexFactory, calendrier BLS, tables, API, écran Calendrier, panneau « Prochains événements » | géométrie ±2 px, tests de fuseau — **codé le 20/11/2026** : service `calendar` (XML ForexFactory, heures en UTC ; `bls.ics` du BLS), migration 2 (calendrier officiel, dates déplacées), `/api/calendar`, écran `/calendrier` (géométrie conforme à ±2 px), panneau « Prochains événements » |
| E3 | Capture BLS, surprise, mesures de délai, maintien du Mac éveillé ; test Playwright déterministe (la fausse passerelle publie un chiffre à T+5 s, affichage en moins d'1 s) | **répétition réelle sur la productivité du 08/12** (T-035) — **codé le 22/11/2026** : parseur `bls_release.py` (corpus réel de 124 pages), service `release` (rafale, nouveauté par date d'embargo, page complète sur octets nuls, arrêt sur 403/429, `caffeinate`), migration 3 (`releases`, `release_timings`, `release_polls`), surprise et z (`surprise.py`), `/api/releases`, op WebSocket « displayed » ; front : bandeau de publication, Réel et Surprise du calendrier, fiche avec citation ; Playwright : 54 ms entre le bus et l'affichage. Restent : réaction du BTC à T+30 min, révisions (`release_revisions`), rattrapage par l'API v1 |
| E4 | Squawk et alertes : cloche, son, notifications, Telegram, écran `/alertes`, panneau « Alertes actives » | essais sur le Mac et le téléphone |
| E5 | **Porte** : CPI du 10/12 à 14:30 Paris, en Mode Local | délais enregistrés et affichés |
| E6 | Fil d'actus : RSS, Tree of Alpha, FinancialJuice, catégories, doublons ; écran Actus, panneau « Titres urgents » | géométrie, captures réelles rejouées |
| E7 | Mode Online : Edge Function `ff-calendar`, `/api/calendar`, panneaux « — » avec raison | contrats des fonctions, essai en ligne |

E1 à E4 doivent tenir avant la répétition du 08/12 ; la rafale du 04/12 et les communiqués archivés (E0) les nourrissent, sans les attendre pour commencer. Le fil d'actus (E6) et le Mode Online (E7) viennent après la porte, qui ne dépend que de la capture, de l'affichage et de l'alerte. Si le temps le permet, E6 passe avant la porte : le chiffre provisoire tiré de FinancialJuice (T-022) en dépend.

## 14. Tests prioritaires

- Fuseaux et changements d'heure : heure ForexFactory, heure d'embargo, semaines de changement d'heure.
- Parseur BLS sur les archives réelles des 36 derniers mois, dont les publications irrégulières de 2025-2026.
- Lecture ForexFactory : grammaire des valeurs (« 205K », « <1.25% », « 4.18|2.6 »), doublons du même jour, prévision retenue avant T.
- Flux RSS : RSS 1.0, RSS 2.0, `dc:date`, faux fuseau de la BoC, détection d'urgence.
- Surprise et z : n insuffisant, σ nul, révisions.
- Normaliseur et modèles de phrase du squawk.
- Moteur d'alertes : franchissement sans perte ; envoi Telegram simulé (jamais de vrai jeton dans les tests).
- Chaîne complète capture → affichage en moins d'1 s (Playwright).
- Absence de secret dans le bundle : `check-bundle` étendu à `BLS_CONTACT_EMAIL`, `TELEGRAM_BOT_TOKEN` et à la forme des jetons Telegram.

## 15. Ce dont j'ai besoin de toi

| Quand | Quoi |
| --- | --- |
| dès que possible | lancer sur le Mac les étapes 1, 3, 4 et 5 de `docs/exploration-p1.md` (sonde, flux, Tree of Alpha, communiqués archivés, voix) |
| ven. 04/12, avant 14:20 | rafale sur le rapport emploi (`docs/exploration-p1.md` § 2) ; Mac allumé et éveillé |
| avant E3 | créer l'adresse e-mail dédiée et la mettre dans le `.env` du Mac (`BLS_CONTACT_EMAIL`) |
| avant E4 | créer le bot Telegram avec @BotFather, mettre `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID` dans le `.env` du Mac |
| 08/12 et 10/12, 14:15 | Mac allumé, passerelle lancée, terminal ouvert en Mode Local |

## 16. Décisions prises (11/11/2026)

| | Décision | Entrée |
| --- | --- | --- |
| Q1 | Porte mesurée depuis la première mise en ligne observée, délai depuis 08:30 affiché | T-015 |
| Q2 | Le Mac capte et fait foi pour la porte ; la tour plus tard | T-016 |
| Q3 | Mode Online : Supabase relève seul l'agenda, ni capture ni fil d'actus | T-017 |
| Q4 | Archive privée de nos relevés ForexFactory, aucun jeu tiers, z à partir de 8 publications | T-018 |
| Q5 | Pas de traduction en P1 | T-019 |
| Q6 | Alertes sur le téléphone par un bot Telegram | T-020 |
| Q7 | Tree of Alpha : flux gratuit mesuré | T-021 |
| Q8 | Chiffre provisoire tiré du fil d'actus, jamais à la place du BLS | T-022 |
| Q9 | Adresse e-mail dédiée dans le User-Agent, pas de clé API v2 | T-023 |
| Q10 | Exploration sur le Mac | T-024 |
| Q11, Q12 | dockview, HOURS et WATCH après la porte ; « Points clés » en P6 | T-025 |
