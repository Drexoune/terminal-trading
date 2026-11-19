# Plan B0 — Fondations du module Bourse

> **Validé le 19/11/2026 (T-037), codé le même jour.** Cadre : `docs/plan-bourse.md` (validé, T-036) et décisions T-027 à T-034. Mise en service : `docs/bourse-mise-en-service.md`.

## 1. Objectif et porte

B0 pose ce dont toutes les étapes suivantes ont besoin : accès protégé, tables, référentiel des titres, relevés de la nuit, et un écran qui montre l'état de chaque source. Aucune fonction visible du portefeuille ou des fiches : elles viennent en B1 et B2.

**Porte de B0.** Sur le site en ligne, après une nuit sans intervention :

- les lignes du portefeuille de Clément (T-037 : six lignes du PEA, toutes européennes) et le cours EUR/USD de la BCE sont relevés automatiquement ;
- chacun affiche sa source, sa date de valeur et son heure de réception ;
- toute route `/api/bourse/*` refuse de répondre sans le mot de passe d'application ;
- aucune clé dans le bundle du front (`check:bundle`).

## 2. Découpage

| Tâche | Contenu | Vérification |
| --- | --- | --- |
| B0.1 Exploration | sources sans clé (BCE, GLEIF, ESMA FIRDS, OpenFIGI) depuis l'environnement de développement, le 19/11 ; sources à clé et SEC par la tâche `explore` de l'Edge Function, depuis l'adresse IP de Supabase (T-037). Réponses gardées comme fichiers de référence des tests | fichiers reçus et relus |
| B0.2 Accès | mot de passe d'application, cookie de session signé, limitation des essais ; script qui produit l'empreinte | tests Vitest (empreinte, signature, expiration, falsification, essais) |
| B0.3 Tables | migration Supabase des tables de B0, RLS sans politique, droits retirés aux rôles publics | migration appliquée sur une base locale, contrôles des droits |
| B0.4 Référentiel | sociétés américaines (liste de la SEC), table des ETF éligibles au PEA reprise du Trading Desk, règle d'éligibilité PEA d'une action (émetteur → pays du siège), ISIN → mnémonique (OpenFIGI) | tests sur une liste témoin d'ISIN |
| B0.5 Relevés de la nuit | Edge Function `bourse-jobs` appelée par pg_cron : cours BCE, clôtures US, clôtures européennes au compte-gouttes (quota Alpha Vantage), journal des passages | tests Vitest sur les fichiers de référence, dont quota dépassé et réponse vide |
| B0.6 Routes | une seule fonction Vercel `api/bourse.ts`, routeur interne ; `api-dev` étendu (sous-chemins, POST) | tests de contrat des routes |
| B0.7 Écrans | section « Bourse » du menu, écran de connexion, écran « Sources » | captures 1 440 et 390 px, Playwright |

Ordre : B0.1 d'abord (les formats réels décident du reste), puis B0.2 et B0.3, puis B0.4 à B0.7.

**Partage avec P1 (T-027).** P1 passe avant : E1 à E4 doivent tenir pour la répétition du 08/12. B0 avance dans les intervalles ; la porte de B0 ne bloque aucune date de P1. B1 commence quand la porte de B0 est passée.

## 3. Architecture

- **Une seule fonction Vercel pour tout le module** : `api/bourse.ts`, avec un routeur interne (`api/_lib/bourse/`). Le plan Hobby limite le nombre de fonctions par déploiement (12 d'après les retours d'utilisateurs ; le terminal en a 5) : une fonction par route l'épuiserait. Une réécriture de `vercel.json` envoie `/api/bourse/<route>` vers cette fonction. Comportement exact de la réécriture à vérifier sur un déploiement de prévisualisation avant de s'en servir.
- **Lectures et écritures** : la fonction lit et écrit Supabase par PostgREST avec la clé secrète, comme `api/_lib/supabase.ts`. Le navigateur n'appelle jamais Supabase (T-031).
- **Relevés** : Edge Function Supabase `bourse-jobs`, une tâche par appel (`?job=ecb-fx`, `us-close`, `eu-close`, `ref-sec`), déclenchée par pg_cron et pg_net avec un secret dans Vault, comme `okx-collector`. Les horaires des tâches sont de simples heures de lancement, pas des sessions de marché : écrits en UTC, choisis pour tomber après les clôtures à l'heure d'été comme d'hiver.
- **Développement** : Vite sert `api/bourse.ts` avec le `.env` local (middleware `api-dev`, étendu aux sous-chemins et aux requêtes POST). Les Edge Functions se testent par Vitest, sans Deno, comme `okx-collector`.

## 4. Tables (migration `…_bourse_b0.sql`)

Montants en `numeric`, jamais en flottant. Toutes en RLS activée, sans politique, droits retirés à `anon` et `authenticated`.

| Table | Colonnes principales |
| --- | --- |
| `instruments` | `id`, `isin`, `cik`, `lei`, `figi`, `name`, `kind` (action, ETF, fonds, UC, fonds euros, livret), `hq_country`, `pea_eligible`, `pea_reason`, `pea_source`, `updated_at` |
| `instrument_listings` | `id`, `instrument_id`, `mic`, `symbol`, `currency`, `price_source`, `source_symbol` (ex. `CW8.PAR` chez Alpha Vantage), `tracked` |
| `prices` | `listing_id`, `value_date`, `close`, `adj_close`, `currency`, `source`, `source_ts`, `received_at` ; clé (`listing_id`, `value_date`, `source`) |
| `fx_rates` | `value_date`, `currency`, `per_eur`, `source` (BCE), `received_at` |
| `bourse_runs` | `id`, `job`, `started_at`, `finished_at`, `ok`, `error`, `rows`, `requests`, `quota_note` |
| `api_quota` | `source`, `day` (jour du fournisseur), `used`, `limit` : budget Alpha Vantage tenu avant chaque appel |
| `auth_failures` | `key_hash`, `at` : essais de mot de passe refusés, purgés après 24 h |

Les tables du portefeuille, des comptes et des événements arrivent avec B1 à B4, chacune par sa migration.

## 5. Routes de B0

| Route | Rôle |
| --- | --- |
| `POST /api/bourse/session` | connexion : mot de passe → cookie de session |
| `DELETE /api/bourse/session` | déconnexion |
| `GET /api/bourse/session` | session ouverte ou non (sans détail) |
| `GET /api/bourse/sources` | état de chaque source : dernier passage, réussite, lignes, quota, prochaine exécution |
| `GET /api/bourse/quote?listing=` | dernière clôture d'une cotation suivie, avec source, date de valeur et heure de réception |
| `GET /api/bourse/instruments?q=` | recherche dans le référentiel (nom, ISIN, mnémonique) |

Toute route autre que `POST /session` exige le cookie ; sinon 401, sans rien révéler. Les erreurs suivent le format des routes existantes (`respond`, `HttpError`).

## 6. Accès par mot de passe (T-031)

- **Empreinte** : `scripts/bourse_password.py` demande le mot de passe sans l'afficher et imprime `BOURSE_PASSWORD_HASH` (PBKDF2-SHA256, 600 000 itérations, sel aléatoire, paramètres inclus) et `BOURSE_SESSION_SECRET`. PBKDF2 plutôt que scrypt : WebCrypto le fournit partout (Vercel, Vite, Vitest) sans dépendance propre à Node. Clément les colle dans Vercel ; le mot de passe n'est stocké nulle part.
- **Session** : cookie `__Host-bourse`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, signé HMAC-SHA256 avec `BOURSE_SESSION_SECRET`, expiration de 30 jours dans le contenu signé (T-037). Changer le secret ferme toutes les sessions.
- **Requêtes qui modifient** : en plus de `SameSite=Strict`, contrôle de l'en-tête `Origin` et du type `application/json`.
- **Essais** : 5 refus en 15 minutes pour une même adresse (empreinte de l'IP, jamais l'IP en clair) → 429 pendant 15 minutes. Comparaison à temps constant.
- **Développement** : le cookie `Secure` passe sur `http://localhost` dans Chrome ; Safari le refuse en HTTP. À vérifier ; au besoin, nom de cookie sans préfixe en développement seulement.

## 7. Relevés de la nuit

| Tâche | Source | Quand (UTC) | Volume |
| --- | --- | --- | --- |
| `ecb-fx` | BCE, cours de référence du jour, toutes devises | 16:30, jours ouvrés | 1 requête |
| `us-close` | Massive, clôtures groupées de tous les titres US de la veille ; seuls les titres suivis sont gardés en B0 | 06:15, mardi à samedi | 1 requête |
| `eu-close` | Alpha Vantage, une requête par cotation européenne suivie, dans la limite du budget du jour | 06:30, mardi à samedi | ≤ budget |
| `ref-sec` | SEC, liste des sociétés et mnémoniques | dimanche 05:00 | 1 requête |

- **Budget Alpha Vantage** : 25 requêtes par jour sur la clé dédiée. Le compteur `api_quota` est incrémenté avant chaque appel. Une réponse de quota dépassé (texte « Note » ou « Information » au lieu de données) arrête la tâche, est journalisée, et l'écran affiche « — · quota atteint ».
- **Échec** : une cotation sans clôture garde la précédente, marquée périmée avec sa date ; jamais de valeur recopiée ni interpolée.
- **Clôture du jour ou de la veille** : l'heure à laquelle Massive et Alpha Vantage publient la clôture se mesure en B0.1 ; les horaires ci-dessus s'ajustent sur ces mesures.

## 8. Écrans de B0

- **Menu** : nouvelle section « Bourse » en bas du menu latéral, **repliable et repliée par défaut** (ouverte d'office sur un écran Bourse) : dépliée, elle allongeait la page de 51 px et le test de géométrie de la maquette Main l'a refusée. Elle contient avec Portefeuille (`PTF`, B1), Fiche action (`EQ`, B2), Screener (`EQS`, B3), Watchlists (`WL`, B3), Calendrier boursier (`EVTS`, B4), Super-investisseurs (`13F`, B4) et Sources (`BSRC`, B0). Les écrans pas encore construits gardent le panneau « à venir » de P0 avec leur étape. Le test de géométrie de la Vue d'ensemble (maquette Main) doit rester juste : la section s'ajoute sous les autres sans les déplacer.
- **Connexion** : panneau centré, un champ mot de passe, un bouton ; message d'erreur sans détail ; « Trop d'essais, réessayer à HH:MM » sur 429.
- **Sources** (`BSRC`) : une ligne par source (BCE, Massive, Alpha Vantage, SEC, OpenFIGI) avec dernier passage, réussite ou erreur, lignes, quota restant, prochaine exécution ; puis les trois cotations de la porte avec clôture, date de valeur, source et heure de réception. « — » avec la raison pour toute valeur absente.

Conçus avec les composants de P0 (Panneau, Bouton, Puce, Pastille, Cellule), capturés à 1 440 et 390 px (T-033).

## 9. Tests

- **Accès** : vérification de l'empreinte scrypt produite par le script Python, signature et expiration du cookie, cookie falsifié ou expiré refusé, limite d'essais, contrôle d'`Origin`.
- **Routes** : chaque route sans cookie → 401 ; paramètres inconnus → 400 (`readQuery`) ; contrats JSON.
- **Relevés** : analyse des fichiers de référence réels de B0.1 ; quota dépassé ; réponse vide ou jour férié ; clôture absente gardée périmée ; budget jamais dépassé.
- **Référentiel** : règle PEA sur une liste témoin (siège en France, en Allemagne, aux Pays-Bas, au Royaume-Uni, en Suisse ; ETF de la table) ; ISIN invalides refusés (clé de contrôle).
- **Bundle** : `check-bundle` étendu aux noms `GEMINI_`, `ALPHA_VANTAGE_`, `TIINGO_`, `MASSIVE_`, `OPENFIGI_`, `BOURSE_` et aux formes de clés connues.
- **Écrans** : Playwright à 1 440 et 390 px, accessibilité (champ étiqueté, boutons nommés).

## 10. Points à vérifier à la source avant d'écrire

Mesurés en B0.1, jamais supposés :

- format et heure de publication des cours de la BCE (API de données) ;
- forme de la réponse groupée de Massive, heure de disponibilité de la clôture sur l'offre gratuite, limite par minute ;
- réponses d'Alpha Vantage pour `CW8.PAR` (série quotidienne compacte) et forme exacte de la réponse de quota dépassé ;
- fichier des sociétés de la SEC et exigence de User-Agent ;
- recherche FIRDS de l'ESMA (ISIN → émetteur) et fiche GLEIF (émetteur → pays du siège) ;
- OpenFIGI : requête par ISIN, limites avec et sans clé ;
- réécriture `vercel.json` vers une fonction unique, et limite de fonctions du plan Hobby.

## 11. Ce dont j'ai besoin de toi

| Quand | Quoi |
| --- | --- |
| avant B0.1 | créer les clés gratuites (`docs/plan-bourse.md` § 9 bis) et les mettre dans le `.env` du Mac |
| B0.1 | lancer `scripts/explore_bourse.py` sur le Mac et renvoyer l'archive (ou question 1) |
| avant la porte | coller les clés dans Vercel et dans les secrets des Edge Functions Supabase ; produire l'empreinte du mot de passe avec `scripts/bourse_password.py` et la coller dans Vercel |
| porte | ouvrir l'écran Sources le lendemain matin et confirmer |

## 12. Questions tranchées (T-037)

| | Question | Réponse |
| --- | --- | --- |
| Q1 | Où explorer les sources à clé | **en ligne** : tâche `explore` de l'Edge Function, depuis l'adresse IP de Supabase ; sources sans clé depuis l'environnement de développement (T-037) |
| Q2 | Durée d'une session | **30 jours** (T-037) |
| Q3 | Titres de la porte | **les lignes du portefeuille de Clément** et EUR/USD (T-037) |
