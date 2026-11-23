-- Markets Watch (P1, décisions T-051 et T-052) : cours de la watchlist hors crypto relevés par la
-- tâche « watch » de l'Edge Function p2-jobs.
--   - Tiingo toutes les 3 min : EUR/USD, USD/JPY, XAU/USD (change), QQQ et SPY (prix de
--     référence IEX, substituts du Nasdaq 100 et du S&P 500) ; gardés 3 jours (séries du jour) ;
--   - FRED au quotidien : rendement US 10 ans (DGS10), indice large du dollar de la Fed (DTWEXBGS).
-- Une ligne par actif, source et heure de la source : un même cours relu n'est jamais doublé.
-- Les ETF du PEA viennent de public.prices (module Bourse), sans copie ici.
-- RLS active, aucune politique : seules les fonctions (clé secrète) lisent et écrivent.

create table public.watch_quotes (
  asset       text        not null,                 -- eurusd, usdjpy, xauusd, qqq, spy, us10y, usd-broad
  source      text        not null,                 -- tiingo-fx, tiingo-iex, fred
  ts_source   timestamptz not null,                 -- heure de la source (date de l'observation pour FRED)
  ts_recv     timestamptz not null default now(),   -- heure de réception
  price       numeric     not null,
  bid         numeric,
  ask         numeric,
  prev_close  numeric,                              -- clôture de la veille quand la source la donne
  primary key (asset, source, ts_source)
);
create index watch_quotes_asset_recv on public.watch_quotes (asset, ts_recv desc);
alter table public.watch_quotes enable row level security;
revoke all on public.watch_quotes from anon, authenticated;
