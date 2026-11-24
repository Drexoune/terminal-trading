-- Plan P4 (sentiment et liquidité), étape S1 : séries quotidiennes, COT, ratios long/short et état
-- publié de P4, écrits par l'Edge Function p4-jobs (sources T-059 et T-060). Aucune table de P1,
-- P2 ni P3 n'est modifiée (décision T-059).
--
-- RLS activée sans aucune politique, comme toutes les tables du terminal : seules les fonctions
-- (clé secrète) lisent et écrivent.

-- Séries quotidiennes ou hebdomadaires (supabase/functions/p4-jobs/catalog.ts) : clôtures de
-- marché, écart de crédit, bilan de la Fed. La source fait foi : une valeur relue remplace la
-- précédente (clôture ajustée de Tiingo recalculée après chaque dividende).
create table public.sentiment_series (
  series_id  text        not null,                 -- VIX, SPY, AUDJPY, BTC, WALCL…
  date       date        not null,                 -- jour de séance ou d'observation, à la source
  value      numeric     not null,                 -- clôture ou niveau
  adj        numeric,                              -- clôture ajustée des dividendes (Tiingo)
  source     text        not null,                 -- cboe, fred, tiingo, tiingo-fx, okx
  ts_recv    timestamptz not null default now(),
  primary key (series_id, date)
);
create index sentiment_series_date on public.sentiment_series (date);
alter table public.sentiment_series enable row level security;
revoke all on public.sentiment_series from anon, authenticated;

-- COT : rapport Traders in Financial Futures de la CFTC (futures seuls), positions du mardi.
create table public.cot_positions (
  report         text        not null,             -- tff
  market_code    text        not null,             -- cftc_contract_market_code (099741 = EURO FX)
  market         text        not null,             -- libellé de la CFTC
  date           date        not null,             -- date des positions (mardi)
  category       text        not null,             -- dealer, asset_mgr, lev_money, other_rept, nonrept
  long           bigint      not null,
  short          bigint      not null,
  spread         bigint,
  open_interest  bigint      not null,
  ts_recv        timestamptz not null default now(),
  primary key (report, market_code, date, category)
);
create index cot_positions_date on public.cot_positions (date);
alter table public.cot_positions enable row level security;
revoke all on public.cot_positions from anon, authenticated;

-- Sentiment retail : ratios long/short (comptes, gros comptes) et financement, 45 jours gardés.
create table public.crowding (
  exchange    text             not null,           -- binance, okx, bybit
  symbol      text             not null,           -- BTC, ETH
  metric      text             not null,           -- account, top_account, top_position, funding
  ts          timestamptz      not null,           -- heure de la plateforme
  value       double precision not null,           -- ratio long/short, ou taux de financement
  long_share  double precision,                    -- part des comptes longs (0 à 1), si publiée
  ts_recv     timestamptz      not null default now(),
  primary key (exchange, symbol, metric, ts)
);
create index crowding_ts on public.crowding (ts);
alter table public.crowding enable row level security;
revoke all on public.crowding from anon, authenticated;

-- État publié de P4 (séries, flux, indice de risque), lu par /api/sentiment.
create table public.p4_state (
  key        text primary key,
  value      jsonb not null,
  updated_ms bigint not null
);
alter table public.p4_state enable row level security;
revoke all on public.p4_state from anon, authenticated;
