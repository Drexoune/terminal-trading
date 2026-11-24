-- Plan P3 (macro et heatmap), étape M1 : séries macroéconomiques des 8 économies, scores et état
-- publié de P3, écrits par l'Edge Function p3-jobs (FRED, BCE, BIS) et par la tâche de Vercel
-- qui relève l'OCDE (décision T-057, si l'OCDE lui répond). Aucune table de P1 ni de P2 n'est
-- modifiée (décision T-053).
--
-- RLS activée sans aucune politique, comme toutes les tables du terminal : seules les fonctions
-- (clé secrète) lisent et écrivent.

-- Catalogue des séries (supabase/functions/p3-jobs/catalog.ts) et état de leur dernier relevé.
create table public.macro_series (
  id           text primary key,                   -- « US:cpi », « FX:EA »
  economy      text not null,                      -- US, EA, GB, JP, CH, CA, AU, NZ
  indicator    text not null,                      -- policy, cpi, cpi_core, gdp, unemployment, confidence, retail, fx
  source       text not null,                      -- fred, ecb, oecd, bis
  code         text not null,                      -- identifiant ou clé à la source
  freq         text not null,                      -- M ou Q
  unit         text not null,                      -- %, pts, USD
  url          text not null,                      -- page publique de la série
  last_period  text,                               -- dernière période reçue (AAAA-MM ou AAAA-Tn)
  last_ok_ms   bigint,                             -- dernier relevé réussi
  last_error   text,                               -- dernière erreur, effacée au relevé suivant réussi
  updated_ms   bigint not null
);
alter table public.macro_series enable row level security;
revoke all on public.macro_series from anon, authenticated;

-- Observations : une ligne par série et période. La source fait foi : une valeur révisée remplace
-- la précédente (le backtest le dit : données révisées, pas les millésimes de l'époque).
create table public.macro_observations (
  series_id   text        not null references public.macro_series (id) on delete cascade,
  period      text        not null,                -- AAAA-MM ou AAAA-Qn
  period_end  date        not null,                -- dernier jour de la période
  value       numeric     not null,
  ts_recv     timestamptz not null default now(),
  primary key (series_id, period)
);
create index macro_observations_period on public.macro_observations (period_end);
alter table public.macro_observations enable row level security;
revoke all on public.macro_observations from anon, authenticated;

-- État publié de P3 (matrice, scores, fiches, lecture, backtest, flux), lu par /api/macro.
create table public.p3_state (
  key        text primary key,
  value      jsonb not null,
  updated_ms bigint not null
);
alter table public.p3_state enable row level security;
revoke all on public.p3_state from anon, authenticated;
