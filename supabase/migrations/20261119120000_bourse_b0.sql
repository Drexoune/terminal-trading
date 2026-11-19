-- Module Bourse, étape B0 (docs/plan-b0.md) : référentiel, cours, devises,
-- journal des relevés, budget des API gratuites, essais de mot de passe.
--
-- Mêmes règles que le Mode Online (décisions T-012 et T-031) : RLS activée
-- SANS aucune politique, aucun droit pour anon et authenticated. Seule la clé
-- secrète (service_role) lit et écrit : l'Edge Function bourse-jobs et la
-- fonction Vercel api/bourse.ts. Le navigateur n'appelle jamais Supabase.
--
-- Montants et cours en numeric, jamais en flottant. Dates de valeur en date
-- (jour de la place de cotation), heures de réception en timestamptz (UTC).

-- Univers américain de la SEC (company_tickers_exchange.json), rafraîchi chaque
-- semaine. Une société peut avoir plusieurs mnémoniques (catégories d'actions).
create table public.sec_companies (
  cik        integer     not null,
  ticker     text        not null,
  name       text        not null,
  exchange   text,                          -- « Nasdaq », « NYSE »… ou null (hors cote)
  updated_at timestamptz not null default now(),
  primary key (cik, ticker)
);
create index sec_companies_ticker_idx on public.sec_companies (ticker);

-- Instruments suivis : lignes du portefeuille, watchlists, ETF de référence.
create table public.instruments (
  id          bigint generated always as identity primary key,
  isin        text unique check (isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  cik         integer,
  lei         text check (lei ~ '^[A-Z0-9]{18}[0-9]{2}$'),
  name        text not null,
  kind        text not null check (kind in ('action', 'etf', 'fonds', 'uc', 'fonds_euros', 'livret')),
  hq_country  text check (hq_country ~ '^[A-Z]{2}$'),   -- pays du siège de l'émetteur (GLEIF)
  pea_eligible boolean,                                -- null : pas encore établi
  pea_reason  text,                                    -- raison lisible du verdict
  pea_source  text,                                    -- « table ETF », « GLEIF », « saisie »
  updated_at  timestamptz not null default now()
);

-- Cotations : un instrument a une cotation par place. price_source et
-- source_symbol disent où et sous quel nom la clôture est relevée.
create table public.instrument_listings (
  id            bigint generated always as identity primary key,
  instrument_id bigint not null references public.instruments (id) on delete cascade,
  mic           text,                                 -- XPAR, XNAS…
  exch_code     text,                                 -- code de place OpenFIGI (FP, US…)
  symbol        text not null,
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  price_source  text not null check (price_source in ('massive', 'alphavantage', 'tiingo', 'saisie')),
  source_symbol text not null,                        -- AAPL chez Massive, CW8.PAR chez Alpha Vantage
  tracked       boolean not null default false,       -- relevée chaque nuit
  created_at    timestamptz not null default now(),
  unique (price_source, source_symbol)
);

-- Clôtures journalières. Une clôture absente n'est jamais recopiée ni
-- interpolée : l'écran montre la dernière connue avec sa date.
create table public.prices (
  listing_id  bigint      not null references public.instrument_listings (id) on delete cascade,
  value_date  date        not null,
  close       numeric     not null check (close > 0),
  adj_close   numeric     check (adj_close > 0),
  currency    text        not null check (currency ~ '^[A-Z]{3}$'),
  source      text        not null,
  source_ts   timestamptz,                            -- heure donnée par la source, si elle en donne une
  received_at timestamptz not null default now(),
  primary key (listing_id, value_date, source)
);
create index prices_listing_date_idx on public.prices (listing_id, value_date desc);

-- Cours de référence de la BCE : unités de devise pour 1 euro.
create table public.fx_rates (
  value_date  date        not null,
  currency    text        not null check (currency ~ '^[A-Z]{3}$'),
  per_eur     numeric     not null check (per_eur > 0),
  source      text        not null default 'BCE',
  received_at timestamptz not null default now(),
  primary key (value_date, currency)
);

-- Journal des relevés : une ligne par passage d'une tâche.
create table public.bourse_runs (
  id          bigint generated always as identity primary key,
  job         text        not null,
  started_at  timestamptz not null,
  finished_at timestamptz not null,
  ok          boolean     not null,
  error       text,
  rows        integer     not null default 0,
  requests    integer     not null default 0,
  note        text                                    -- « quota atteint », cotations sautées…
);
create index bourse_runs_job_started_idx on public.bourse_runs (job, started_at desc);

-- Budget des API gratuites (Alpha Vantage : 25 requêtes par jour), tenu AVANT
-- chaque appel par public.bourse_reserve_quota.
create table public.api_quota (
  source text    not null,
  day    date    not null,                            -- jour du fournisseur
  used   integer not null default 0 check (used >= 0),
  max    integer not null check (max > 0),
  primary key (source, day)
);

-- Essais de mot de passe refusés : clé = empreinte de l'adresse IP, jamais l'IP.
create table public.auth_failures (
  id       bigint generated always as identity primary key,
  key_hash text        not null,
  at       timestamptz not null default now()
);
create index auth_failures_key_at_idx on public.auth_failures (key_hash, at desc);

-- RLS sans politique, aucun droit pour les rôles publics.
alter table public.sec_companies       enable row level security;
alter table public.instruments         enable row level security;
alter table public.instrument_listings enable row level security;
alter table public.prices              enable row level security;
alter table public.fx_rates            enable row level security;
alter table public.bourse_runs         enable row level security;
alter table public.api_quota           enable row level security;
alter table public.auth_failures       enable row level security;

revoke all on table public.sec_companies, public.instruments, public.instrument_listings,
  public.prices, public.fx_rates, public.bourse_runs, public.api_quota, public.auth_failures
  from anon, authenticated;
grant select, insert, update, delete on table public.sec_companies, public.instruments,
  public.instrument_listings, public.prices, public.fx_rates, public.bourse_runs,
  public.api_quota, public.auth_failures to service_role;
revoke all on sequence public.instruments_id_seq, public.instrument_listings_id_seq,
  public.bourse_runs_id_seq, public.auth_failures_id_seq from anon, authenticated;

-- Réserve une requête dans le budget du jour, atomiquement : true si elle est
-- accordée, false si le plafond est atteint. Appelée par l'Edge Function
-- (/rest/v1/rpc/bourse_reserve_quota) avant chaque appel payé au quota.
create or replace function public.bourse_reserve_quota(p_source text, p_day date, p_max integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_used integer;
begin
  if p_max is null or p_max <= 0 then
    return false;
  end if;
  insert into public.api_quota as q (source, day, used, max)
  values (p_source, p_day, 1, p_max)
  on conflict (source, day) do update
    set used = q.used + 1, max = excluded.max
    where q.used < excluded.max
  returning q.used into v_used;
  return v_used is not null;
end;
$$;
revoke execute on function public.bourse_reserve_quota(text, date, integer) from public, anon, authenticated;
grant execute on function public.bourse_reserve_quota(text, date, integer) to service_role;

-- Rétention : journal 180 jours, essais refusés 1 jour.
create or replace function public.bourse_retention()
returns void
language sql
set search_path = ''
as $$
  delete from public.bourse_runs   where started_at < now() - interval '180 days';
  delete from public.auth_failures where at         < now() - interval '1 day';
  delete from public.api_quota     where day        < current_date - 30;
$$;
revoke execute on function public.bourse_retention() from public, anon, authenticated, service_role;

select cron.schedule('bourse-retention-daily', '37 3 * * *', 'select public.bourse_retention()');
