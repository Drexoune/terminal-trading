# Collecteur Supabase du Mode Online

En Mode Online, rien ne tourne chez soi. Le navigateur lit en direct les WebSockets publiques d'OKX, et les fonctions Vercel servent le REST d'OKX. Ce dossier ajoute le collecteur planifié : une Edge Function Supabase, appelée chaque minute, qui relève OKX EEA et garde un journal dans Postgres. C'est ce journal que lit `GET /api/collector-health`.

```text
pg_cron (chaque minute)
  └─ pg_net : POST /functions/v1/okx-collector, en-tête x-collector-secret
       └─ Edge Function okx-collector (Deno)
            ├─ REST public OKX EEA (https://eea.okx.com) : heure, ticker, funding, open interest, bougies 1 min
            └─ PostgREST (clé secrète) : okx_snapshots, okx_candles_1m, collector_gaps, collector_runs
                                                  ▲
                         fonction Vercel /api/collector-health (lecture seule, clé secrète côté serveur)
```

Le front n'appelle jamais Supabase. Aucune clé n'est dans le dépôt ; la clé secrète du projet est fournie à la fonction par la plateforme.

## Contenu du dossier

| Fichier | Rôle |
| --- | --- |
| `config.toml` | configuration de la CLI ; `verify_jwt = false` pour `okx-collector` (l'appel est authentifié par son propre secret) |
| `migrations/20261020120000_online_mode.sql` | tables, RLS, extensions `pg_cron` et `pg_net`, rétention quotidienne |
| `functions/okx-collector/index.ts` | point d'entrée Deno, branche le gestionnaire sur `Deno.serve` |
| `functions/okx-collector/handler.ts` | contrôle de l'appel (POST, secret à temps constant), configuration, réponse JSON |
| `functions/okx-collector/collector.ts` | un passage du collecteur (logique pure, sans API Deno) |
| `functions/okx-collector/postgrest.ts` | client PostgREST minimal (upsert, insert, select), en-têtes selon le type de clé |
| `functions/okx-collector/*.test.ts`, `fixtures/` | tests Vitest sur des réponses OKX réelles |
| `cron.sql` | planification chaque minute ; à exécuter une fois, à la main (il porte des secrets) |

## Mise en place, pas à pas

Prérequis : la CLI Supabase (`brew install supabase/tap/supabase` sur le Mac), `openssl`, un compte Supabase. Toutes les commandes se lancent depuis la racine du dépôt.

### 1. Créer un projet dédié

Dans le tableau de bord Supabase, créer un **nouveau projet réservé au terminal**. Ne pas réutiliser le projet de l'app Joyo ni celui du tableau de bord drexbot. On évite ainsi qu'une clé, une politique ou un quota soit partagé, et le projet peut être coupé seul.

- Région : **Europe** (Paris `eu-west-3` ou Francfort `eu-central-1`). La base, pg_net et l'Edge Function restent ainsi au plus près d'OKX EEA et des fonctions Vercel (`cdg1`).
- Mot de passe de la base : le garder dans le gestionnaire de mots de passe. Il ne sert qu'à `supabase link`.
- Noter la référence du projet, `<ref>` dans `https://<ref>.supabase.co`.

> À vérifier au moment de créer le projet : l'offre gratuite limite le nombre de projets actifs par compte (deux au dernier relevé). Si Joyo et drexbot les occupent déjà, il faut en mettre un en pause ou passer à une offre payante. Voir « Coût » plus bas.

### 2. Lier le dépôt au projet

```bash
supabase login
supabase link --project-ref <ref>
```

### 3. Créer les tables

```bash
supabase db push
```

La migration crée les quatre tables, active la RLS sans aucune politique, active `pg_cron` et `pg_net`, et planifie deux tâches quotidiennes : `okx-retention-daily` (03:17 UTC, 90 jours de données) et `cron-history-purge-daily` (03:27 UTC, 7 jours d'historique pg_cron). Contrôle : le *Table Editor* liste `okx_snapshots`, `okx_candles_1m`, `collector_runs` et `collector_gaps`, chacune avec la RLS activée.

### 4. Poser le secret d'appel

Le secret d'appel protège la fonction : sans lui, n'importe qui pourrait la déclencher et consommer les limites OKX de son adresse IP. Le générer une fois et le garder dans le gestionnaire de mots de passe : il resservira à l'étape 7.

```bash
openssl rand -hex 32                       # 64 caractères ; 32 au moins sont exigés
```

Le poser sans qu'il passe par l'historique du shell : le saisir une seule fois, sans écho, dans une variable de la session (coller la valeur depuis le gestionnaire de mots de passe), puis passer par un fichier ignoré par git (motif `*.env`) aussitôt supprimé :

```bash
read -rs COLLECTOR_SECRET                  # rien ne s'affiche, rien n'entre dans l'historique
printf 'COLLECTOR_SECRET=%s\n' "$COLLECTOR_SECRET" > supabase/collector.env
supabase secrets set --env-file supabase/collector.env
rm supabase/collector.env
```

Garder ce terminal ouvert jusqu'à l'étape 6 : la variable y sert encore.

`SUPABASE_URL` et la clé secrète du projet sont fournies à la fonction par la plateforme, sans action de notre part (à vérifier au déploiement). La fonction lit d'abord la nouvelle clé (`SUPABASE_SECRET_KEYS`, objet JSON dont elle prend `default`), puis l'ancienne clé `SUPABASE_SERVICE_ROLE_KEY` à défaut.

Facultatif : `OKX_INSTRUMENTS=BTC-USDT-SWAP,ETH-USDT-SWAP` (valeur par défaut ; 10 instruments perpétuels au plus).

### 5. Déployer la fonction

```bash
supabase functions deploy okx-collector
```

`config.toml` porte déjà `verify_jwt = false`. Équivalent en ligne de commande : `--no-verify-jwt`. Sans ce réglage, la plateforme exigerait un JWT et refuserait l'appel de pg_cron.

### 6. Essayer un passage à la main

```bash
# L'en-tête est lu sur l'entrée standard (curl ≥ 7.55, celui de macOS convient) :
# le secret n'apparaît ni dans l'historique ni dans la liste des processus.
printf 'x-collector-secret: %s\n' "$COLLECTOR_SECRET" \
  | curl -sS -X POST "https://<ref>.supabase.co/functions/v1/okx-collector" -H @-
unset COLLECTOR_SECRET
```

Réponse attendue (HTTP 200) : `{"ok":true,…,"rows":6,"gaps":0,"okx_offset_ms":…,"rtt_ms":…,"errors":[]}`. Six lignes, soit deux instantanés et deux bougies closes par instrument. Sans l'en-tête, la réponse est 401 ; en GET, 405. Une réponse 500 détaille l'erreur dans `errors` ou `error`.

### 7. Planifier l'appel chaque minute

Ouvrir `cron.sql`, copier son contenu dans le *SQL Editor* du projet et remplacer **dans l'éditeur** les deux valeurs du bloc 1 : l'URL du projet et le secret de l'étape 4. Exécuter. Ne jamais enregistrer de version remplie dans le dépôt.

Le script range les deux valeurs dans Vault, chiffrées, puis crée la tâche `okx-collector-every-minute`. Il refuse de s'exécuter tant que les valeurs d'exemple sont en place, et peut être rejoué sans créer de doublon.

### 8. Vérifier

Quelques minutes après :

```sql
-- Tâches planifiées : okx-collector-every-minute, okx-retention-daily, cron-history-purge-daily.
select jobid, jobname, schedule, active from cron.job;

-- Réponses de la fonction (200 = passage ok, 401 = secret différent de COLLECTOR_SECRET).
select status_code, content, created from net._http_response order by created desc limit 5;

-- Journal du collecteur : une ligne par minute, ok = true.
select started_at, finished_at, ok, error, rows, okx_offset_ms, rtt_ms
  from public.collector_runs order by started_at desc limit 10;
```

### 9. Brancher le Mode Online (Vercel)

Côté Vercel, la fonction `/api/collector-health` lit le journal avec deux variables d'environnement, côté serveur uniquement : `SUPABASE_URL` (`https://<ref>.supabase.co`) et `SUPABASE_SECRET_KEY`, la clé secrète `sb_secret_…` (*Project Settings → API Keys*). Une ancienne clé `service_role` convient aussi. Jamais la clé publiable : la RLS ne lui laisse rien lire. Tant que ces variables manquent, la route répond `configured: false`, avec la raison.

## Ce qui est stocké

Horodatages en `timestamptz`, stockés en UTC. `ts_source` est l'heure OKX de la donnée, `ts_recv` l'heure de réception par la fonction.

| Table | Une ligne par | Contenu |
| --- | --- | --- |
| `okx_snapshots` | instrument et minute (clé `inst, ts_minute`) | ticker (`last`, `bid`, `ask`, `open24h`, `high24h`, `low24h`, `sod_utc0`, `vol_base24h`), funding (`funding_rate`, `funding_time` = prochaine échéance), open interest (`oi_base`, `oi_usd`), chacun avec sa propre heure source |
| `okx_candles_1m` | instrument et minute (clé `inst, t`) | bougies 1 min **closes** seulement (`o`, `h`, `l`, `c`, `vol_base`, `vol_quote`) |
| `collector_runs` | passage | `started_at`, `finished_at`, `ok`, `error`, `rows` écrites, `okx_offset_ms` (heure OKX − heure de la fonction), `rtt_ms` |
| `collector_gaps` | trou détecté (clé `inst, from_t`) | minutes de bougies absentes de la base entre deux passages : `from_t`, `to_t`, `missing`, `detected_at` |

Règles du collecteur :

- Un passage mesure l'écart d'horloge avec `/api/v5/public/time`, en gardant l'échantillon au plus court aller-retour. Il lit ensuite, pour chaque instrument en parallèle, le ticker, le funding, l'open interest et les 3 dernières bougies 1 min.
- Les écritures sont des upserts : rejouer un passage ne crée pas de doublon.
- Un funding ou un open interest absent ou illisible laisse ses colonnes à `null`, jamais à une valeur inventée. L'instantané part quand même et l'erreur est consignée.
- Une erreur sur un instrument n'empêche pas les autres. Le passage est alors journalisé avec `ok = false` et le message, et la fonction répond 500, ce qui le rend visible aussi dans `net._http_response`.
- Les trous sont **signalés, jamais comblés ni masqués**. Lire 3 bougies par passage tolère un passage manqué sans trou ; à partir de deux passages manqués, les minutes perdues apparaissent dans `collector_gaps`.

Ce qui n'est pas stocké : ni trades ni carnet d'ordres (le temps réel reste dans le navigateur), aucune donnée de compte, aucune clé.

## Volumes estimés

Mesurés sur Postgres 16 avec la migration, pour une journée et 2 instruments, index compris :

| Table | Lignes par jour | Taille par jour | Sur 90 jours |
| --- | --- | --- | --- |
| `okx_snapshots` | 2 880 | ≈ 0,7 Mo | ≈ 60 Mo |
| `okx_candles_1m` | 2 880 | ≈ 0,5 Mo | ≈ 43 Mo |
| `collector_runs` | 1 440 | ≈ 0,3 Mo | ≈ 24 Mo |
| `collector_gaps` | 0 en régime normal | négligeable | négligeable |

Le total plafonne vers **130 Mo** une fois la rétention de 90 jours atteinte. S'y ajoutent l'historique de pg_cron (7 jours, environ 10 000 lignes) et les réponses gardées par pg_net (quelques heures), soit quelques Mo. Chaque instrument supplémentaire ajoute environ 50 Mo à 90 jours.

## Coût

Prévu pour tenir dans l'**offre gratuite** (chiffres relevés avant le déploiement, à vérifier sur la page de tarifs Supabase) :

- base : environ 130 Mo utilisés sur les 500 Mo inclus ;
- Edge Functions : 1 440 appels par jour, soit environ 44 600 par mois, pour 500 000 inclus. Un passage dure 1 à 2 s, presque entièrement en attente réseau ; mesure hors Supabase : 1,5 s ;
- trafic sortant : quelques Ko par passage.

Points de vigilance de l'offre gratuite, à vérifier au déploiement :

- **nombre de projets actifs limité** (voir l'étape 1) ;
- **pause après une période d'inactivité**. Il reste à vérifier si les appels de pg_cron comptent comme une activité. Si le projet est mis en pause, le collecteur s'arrête : `/api/collector-health` montre alors un dernier passage de plus en plus ancien, et les minutes perdues apparaissent dans `collector_gaps` à la reprise.

## Surveiller

- Écran **Paramètres** du terminal, bouton « Tester » du Mode Online : `/api/collector-health` donne l'âge du dernier passage, ainsi que le nombre de passages, d'échecs et de minutes manquantes sur 24 h.
- En SQL : les requêtes de l'étape 8, plus `select * from public.collector_gaps order by detected_at desc limit 10;`.
- Erreurs à connaître :
  - `limite de débit OKX atteinte` (HTTP 429) : les limites OKX sont par adresse IP, et l'IP de sortie des Edge Functions est probablement partagée avec d'autres utilisateurs de la plateforme (à vérifier). Quelques 429 isolés sont possibles ; une série doit alerter ;
  - `code 51001` : instrument inconnu, vérifier `OKX_INSTRUMENTS` ;
  - `PostgREST 401` : clé secrète refusée.

## Couper

| But | Action |
| --- | --- |
| Suspendre la collecte (données gardées, rétention active) | `select cron.unschedule('okx-collector-every-minute');` |
| Reprendre | réexécuter le bloc 2 de `cron.sql` |
| Changer le secret d'appel | nouvelle valeur dans `supabase secrets set`, puis réexécuter `cron.sql` en entier (Vault est mis à jour) |
| Retirer la fonction | `supabase functions delete okx-collector`, après avoir suspendu la tâche |
| Tout arrêter | suspendre, puis `select cron.unschedule('okx-retention-daily'); select cron.unschedule('cron-history-purge-daily');` ; mettre le projet en pause ou le supprimer (*Project Settings → General*) |

Couper le collecteur ne touche ni le flux temps réel du Mode Online (il vient du navigateur) ni les Modes Local et Tour.

## Tests

```bash
cd web && npx vitest run ../supabase
```

Les tests rejouent des réponses réelles d'OKX EEA, enregistrées par curl le 20/10/2026 dans `functions/okx-collector/fixtures/okx-rest-eea.json`. Ils couvrent les points suivants :

- passage nominal ;
- erreurs par instrument ;
- trous de minutes ;
- horloge ;
- en-têtes PostgREST selon le type de clé ;
- secret d'appel ;
- concordance des lignes écrites avec les colonnes de la migration, y compris celles que lit `/api/collector-health`.

Pour réenregistrer une réponse :

```bash
curl -sS "https://eea.okx.com/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=1m&limit=3"
```

Puis la recopier sous son chemin exact dans `responses` et mettre à jour les valeurs attendues des tests.
