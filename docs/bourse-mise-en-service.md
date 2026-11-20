# Module Bourse : mise en service de B0

Ce guide met en ligne l'étape B0 (`docs/plan-b0.md`) sur le projet Supabase et le projet Vercel déjà utilisés par le Mode Online (`supabase/README.md`, `docs/modes.md`). Compter 30 minutes. Toutes les commandes se lancent depuis la racine du dépôt, sur le Mac.

Aucune valeur secrète ne passe par la conversation, le dépôt ou l'historique du shell.

## 1. Créer les clés gratuites

| Variable | Où la créer | Sert à |
| --- | --- | --- |
| `ALPHA_VANTAGE_API_KEY` | alphavantage.co, « Get your free API key », une clé **dédiée** au terminal (celle du Trading Desk reste au Trading Desk) | clôtures des lignes européennes, 25 requêtes par jour |
| `MASSIVE_API_KEY` | massive.com, compte gratuit | clôtures américaines (aucune ligne US aujourd'hui : facultative en B0) |
| `TIINGO_API_KEY` | tiingo.com, compte gratuit | exploration seulement en B0 |
| `OPENFIGI_API_KEY` | openfigi.com, « API Key » | exploration seulement en B0 (marche aussi sans clé, plus lentement) |
| `SEC_CONTACT_EMAIL` | l'adresse dédiée du terminal (celle de `BLS_CONTACT_EMAIL` convient) | la SEC refuse toute requête sans adresse de contact |
| `GEMINI_API_KEY` | Google AI Studio | pas utilisée en B0 ; à créer pour B2 |

Les garder dans le gestionnaire de mots de passe.

## 2. Le mot de passe du module

```bash
.venv/bin/python scripts/bourse_password.py
```

Le script demande le mot de passe deux fois, sans l'afficher (12 caractères au moins), puis imprime `BOURSE_PASSWORD_HASH` et `BOURSE_SESSION_SECRET`. Le mot de passe lui-même n'est écrit nulle part.

Dans Vercel : *Settings → Environment Variables*, type **Secret**, cibles Production et Preview, ajouter ces deux variables. `SUPABASE_URL` et `SUPABASE_SECRET_KEY` y sont déjà. Redéployer pour qu'elles soient lues.

Pour le développement sur le Mac (`npm run dev`), les mêmes deux lignes vont dans le `.env`.

Changer `BOURSE_SESSION_SECRET` ferme toutes les sessions ouvertes. Pour changer de mot de passe, relancer le script et remplacer les deux valeurs.

## 3. Les tables

```bash
supabase db push
```

La migration `20261119120000_bourse_b0.sql` crée huit tables (`sec_companies`, `instruments`, `instrument_listings`, `prices`, `fx_rates`, `bourse_runs`, `api_quota`, `auth_failures`), RLS activée sans aucune politique, et la tâche quotidienne `bourse-retention-daily`. Contrôle : le *Table Editor* les liste, chacune avec la RLS activée.

## 4. Les secrets de la fonction des relevés

Un secret d'appel protège la fonction, comme pour `okx-collector` :

```bash
openssl rand -hex 32        # le garder dans le gestionnaire de mots de passe
```

Saisir chaque valeur sans écho, puis passer par un fichier ignoré par git (motif `*.env`) aussitôt supprimé :

```bash
read -rs BOURSE_JOBS_SECRET
read -rs ALPHA_VANTAGE_API_KEY
read -rs MASSIVE_API_KEY
read -rs TIINGO_API_KEY
read -rs OPENFIGI_API_KEY
read -r  SEC_CONTACT_EMAIL
{
  printf 'BOURSE_JOBS_SECRET=%s\n' "$BOURSE_JOBS_SECRET"
  printf 'ALPHA_VANTAGE_API_KEY=%s\n' "$ALPHA_VANTAGE_API_KEY"
  printf 'MASSIVE_API_KEY=%s\n' "$MASSIVE_API_KEY"
  printf 'TIINGO_API_KEY=%s\n' "$TIINGO_API_KEY"
  printf 'OPENFIGI_API_KEY=%s\n' "$OPENFIGI_API_KEY"
  printf 'SEC_CONTACT_EMAIL=%s\n' "$SEC_CONTACT_EMAIL"
} > supabase/bourse.env
supabase secrets set --env-file supabase/bourse.env
rm supabase/bourse.env
```

Une clé pas encore créée peut rester vide : la tâche qui en a besoin le dira dans son journal, sans bloquer les autres. Facultatif : `ALPHA_VANTAGE_DAILY_MAX` (20 par défaut, 25 au plus), pour laisser une réserve d'essais à la main.

Garder ce terminal ouvert jusqu'à l'étape 6.

## 5. Déployer la fonction

```bash
supabase functions deploy bourse-jobs        # ou : … --use-api si la CLI réclame Docker
```

`config.toml` porte déjà `verify_jwt = false` : l'appel est authentifié par l'en-tête `x-jobs-secret`.

## 6. Exploration (B0.1) : une réponse de chaque source

```bash
printf 'x-jobs-secret: %s\n' "$BOURSE_JOBS_SECRET" \
  | curl -sS -X POST "https://<ref>.supabase.co/functions/v1/bourse-jobs?job=explore" -H @- -o explore.json
```

La tâche interroge une fois la BCE, la SEC, Massive, Alpha Vantage (une requête du quota), Tiingo et OpenFIGI, **depuis Supabase**, c'est-à-dire depuis l'adresse IP qui fera les relevés. Elle n'écrit rien en base. Les clés sont masquées dans `explore.json`.

Chaque réponse arrive avec son début (`body`) et, si elle est longue, sa fin (`tail`). Les fichiers de référence des tests en ont été tirés le 20/11/2026 (`docs/plan-b0.md` § 10). Relancer `explore` sert ensuite à vérifier qu'une source n'a pas changé de format.

Puis, pour remplir la base sans attendre la nuit :

```bash
for job in ecb-fx ref-sec eu-close; do
  printf 'x-jobs-secret: %s\n' "$BOURSE_JOBS_SECRET" \
    | curl -sS -X POST "https://<ref>.supabase.co/functions/v1/bourse-jobs?job=$job" -H @-; echo
done
```

`eu-close` ne relève rien tant qu'aucune ligne n'est suivie (étape 8).

## 7. Planifier les relevés

Copier `supabase/cron-bourse.sql` dans le *SQL Editor*, remplacer **dans l'éditeur** la valeur du secret par celle de l'étape 4, exécuter. Le script range le secret dans Vault et crée cinq tâches :

| Tâche | Quand (UTC) | Heure de Paris en hiver |
| --- | --- | --- |
| `bourse-ecb-fx` | 16:30, lundi à vendredi | 17:30 |
| `bourse-us-close` | 06:15, mardi à samedi | 07:15 |
| `bourse-eu-close`, `bourse-eu-close-2` | 06:30 et 06:45, mardi à samedi | 07:30 et 07:45 |
| `bourse-ref-sec` | dimanche 05:00 | 06:00 |

Il suppose le secret `project_url` déjà créé par `supabase/cron.sql`.

```bash
unset BOURSE_JOBS_SECRET ALPHA_VANTAGE_API_KEY MASSIVE_API_KEY TIINGO_API_KEY OPENFIGI_API_KEY SEC_CONTACT_EMAIL
```

## 8. Les lignes suivies

En B0, les lignes s'ajoutent par SQL. L'import du portefeuille (B1) le fera ensuite depuis l'écran. Le script des lignes du PEA est fourni dans la conversation, pas dans le dépôt : il contient les positions. Forme d'une ligne :

```sql
with i as (
  insert into public.instruments (isin, name, kind, pea_eligible, pea_reason, pea_source)
  values ('FR0011871110', 'Amundi PEA Nasdaq-100 UCITS ETF Acc', 'etf', true, 'ETF de la table des fonds éligibles', 'table ETF')
  on conflict (isin) do update set name = excluded.name
  returning id
)
insert into public.instrument_listings (instrument_id, mic, exch_code, symbol, currency, price_source, source_symbol, tracked)
select id, 'XPAR', 'FP', 'PUST', 'EUR', 'alphavantage', 'PUST.PAR', true from i
on conflict (price_source, source_symbol) do update set tracked = true;
```

## 9. Vérifier : la porte de B0

Le lendemain matin, ouvrir le terminal en ligne, commande `BSRC` (menu « Bourse », « Sources »), et se connecter :

- chaque ligne suivie a sa clôture de la veille, avec sa source, sa date de valeur et son heure de réception ;
- EUR/USD de la BCE est affiché avec sa date ;
- chaque relevé a un passage réussi, ou une erreur lisible ;
- sans session, `https://<projet>.vercel.app/api/bourse/sources` répond 401.

En SQL, le journal se lit ainsi :

```sql
select job, started_at, ok, rows, requests, note, error from public.bourse_runs order by started_at desc limit 20;
```

## Couper

Désactiver les tâches (`select cron.unschedule(jobname) from cron.job where jobname like 'bourse-%';`) arrête les relevés. Retirer `BOURSE_SESSION_SECRET` de Vercel ferme l'accès au module. Ni l'un ni l'autre ne touche au reste du terminal.
