-- Mode Online : stockage du collecteur OKX planifié (Edge Function okx-collector).
--
-- Accès : RLS activée sur chaque table SANS aucune politique. Les clés
-- publiables (anon, authenticated) ne voient et n'écrivent donc rien ; seule la
-- clé secrète (rôle service_role, qui contourne la RLS) lit et écrit : l'Edge
-- Function et les fonctions Vercel côté serveur. Le front n'appelle jamais
-- Supabase directement.
--
-- Horodatages en timestamptz (stockés en UTC). ts_source = heure OKX du
-- message, ts_recv = heure de réception par le collecteur.

-- Extensions de planification (pg_cron) et d'appel HTTP depuis Postgres (pg_net).
-- Schémas conformes aux exemples de la doc Supabase (à vérifier au déploiement :
-- si l'extension est déjà activée depuis le tableau de bord, « if not exists »
-- la laisse où elle est).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Instantané par minute et par instrument : ticker, funding, open interest.
create table public.okx_snapshots (
  inst              text             not null,
  ts_minute         timestamptz      not null,  -- minute UTC du ticker (heure OKX)
  last              double precision not null,
  bid               double precision,
  ask               double precision,
  open24h           double precision,
  high24h           double precision,
  low24h            double precision,
  sod_utc0          double precision,           -- ouverture du jour UTC
  vol_base24h       double precision,           -- volume 24 h en devise de base
  funding_rate      double precision,
  funding_time      timestamptz,                -- PROCHAINE échéance de funding
  oi_base           double precision,           -- open interest en devise de base
  oi_usd            double precision,
  ts_source         timestamptz      not null,  -- heure OKX du ticker
  funding_ts_source timestamptz,                -- heure OKX du funding
  oi_ts_source      timestamptz,                -- heure OKX de l'open interest
  ts_recv           timestamptz      not null,
  primary key (inst, ts_minute)
);

-- Bougies 1 minute closes (confirm = 1 chez OKX), ouverture t en UTC.
create table public.okx_candles_1m (
  inst      text             not null,
  t         timestamptz      not null,
  o         double precision not null,
  h         double precision not null,
  l         double precision not null,
  c         double precision not null,
  vol_base  double precision not null,   -- volCcy : devise de base
  vol_quote double precision not null,   -- volCcyQuote : vol_quote / vol_base = prix moyen exact
  ts_recv   timestamptz      not null,
  primary key (inst, t)
);

-- Journal : une ligne par passage du collecteur.
create table public.collector_runs (
  id            bigint generated always as identity primary key,
  started_at    timestamptz not null,
  finished_at   timestamptz not null,
  ok            boolean     not null,
  error         text,
  rows          integer     not null default 0,  -- lignes écrites pendant le passage
  okx_offset_ms numeric,                          -- heure OKX - heure de la fonction
  rtt_ms        numeric                           -- aller-retour de la mesure d'horloge
);
create index collector_runs_started_at_idx on public.collector_runs (started_at desc);

-- Minutes de bougies manquantes, détectées entre deux passages. Un trou est
-- signalé une fois (clé inst, from_t) et jamais comblé ni masqué.
create table public.collector_gaps (
  id          bigint generated always as identity primary key,
  inst        text        not null,
  from_t      timestamptz not null,   -- première minute manquante
  to_t        timestamptz not null,   -- dernière minute manquante
  missing     integer     not null check (missing > 0),
  detected_at timestamptz not null default now(),
  unique (inst, from_t)
);
create index collector_gaps_detected_at_idx on public.collector_gaps (detected_at desc);

-- RLS sans politique, et aucun droit pour les rôles publics (défense en
-- profondeur si une politique était ajoutée par erreur).
alter table public.okx_snapshots  enable row level security;
alter table public.okx_candles_1m enable row level security;
alter table public.collector_runs enable row level security;
alter table public.collector_gaps enable row level security;

revoke all on table public.okx_snapshots, public.okx_candles_1m,
  public.collector_runs, public.collector_gaps from anon, authenticated;
grant select, insert, update, delete on table public.okx_snapshots, public.okx_candles_1m,
  public.collector_runs, public.collector_gaps to service_role;

-- Rétention : 90 jours de données.
create or replace function public.okx_retention(keep interval default interval '90 days')
returns void
language sql
set search_path = ''
as $$
  delete from public.okx_snapshots  where ts_minute   < now() - keep;
  delete from public.okx_candles_1m where t           < now() - keep;
  delete from public.collector_runs where started_at  < now() - keep;
  delete from public.collector_gaps where detected_at < now() - keep;
$$;

-- Les fonctions du schéma public sont exposées par l'API (/rest/v1/rpc) :
-- personne d'autre que le propriétaire (postgres, qui exécute pg_cron) ne l'appelle.
revoke execute on function public.okx_retention(interval) from public, anon, authenticated;

-- Chaque jour à 03:17 UTC (pg_cron compte en UTC sur Supabase, à vérifier au
-- déploiement). Une tâche de même nom est remplacée, jamais dupliquée.
select cron.schedule('okx-retention-daily', '17 3 * * *', 'select public.okx_retention()');

-- Historique de pg_cron : 7 jours (la tâche minute en ajoute 1 440 lignes par
-- jour dans cron.job_run_details). Tâche séparée : si le droit de purger cette
-- table manquait (à vérifier au déploiement), la rétention des données
-- continuerait, et l'échec se lirait dans cron.job_run_details.
select cron.schedule('cron-history-purge-daily', '27 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
