-- Section Backtest (T-061, T-062), étape S1 : bougies servies au moteur de backtest, écrites par
-- l'Edge Function bt-jobs (OKX pour BTC et ETH, Tiingo pour QQQ et SPY), et état publié de la
-- section. Aucune table de P1 à P4 n'est modifiée.
--
-- RLS activée sans aucune politique, comme toutes les tables du terminal : seules les fonctions
-- (clé secrète) lisent et écrivent.

create table public.bt_candles (
  asset    text             not null,               -- BTC, ETH, QQQ, SPY
  tf       text             not null,               -- 1D, 1H (le 4H est agrégé à la lecture)
  ts       timestamptz      not null,               -- ouverture de la bougie, UTC (heure de la source)
  open     double precision not null,
  high     double precision not null,
  low      double precision not null,
  close    double precision not null,
  volume   double precision,
  source   text             not null,               -- okx, tiingo (cours ajustés des dividendes)
  ts_recv  timestamptz      not null default now(),
  primary key (asset, tf, ts)
);
alter table public.bt_candles enable row level security;
revoke all on public.bt_candles from anon, authenticated;

create table public.bt_state (
  key        text primary key,
  value      jsonb not null,
  updated_ms bigint not null
);
alter table public.bt_state enable row level security;
revoke all on public.bt_state from anon, authenticated;

-- Une série en colonnes (une seule ligne de tableaux) pour /api/backtest/candles : 50 000 bougies
-- en un appel au lieu de 50 pages de 1 000 lignes. 4H : agrégé depuis le 1H, tranches UTC
-- 00:00, 04:00… ; une tranche incomplète (moins de 4 heures) est écartée.
create function public.bt_candles_cols(p_asset text, p_tf text, p_from timestamptz)
returns table (t bigint[], o double precision[], h double precision[], l double precision[],
               c double precision[], v double precision[], n integer, source text)
language sql stable
set search_path = public
as $$
  with raw as (
    select ts, open, high, low, close, volume, source
      from bt_candles
     where asset = p_asset and tf = case when p_tf = '4H' then '1H' else p_tf end and ts >= p_from
  ), bars as (
    select ts, open, high, low, close, volume, source from raw where p_tf <> '4H'
    union all
    select b, (array_agg(open order by ts))[1], max(high), min(low), (array_agg(close order by ts desc))[1],
           sum(volume), min(source)
      from (select date_bin('4 hours', ts, timestamptz '2000-01-01 00:00:00+00') as b, * from raw where p_tf = '4H') q
     group by b having count(*) = 4
  )
  select array_agg((extract(epoch from ts) * 1000)::bigint order by ts), array_agg(open order by ts),
         array_agg(high order by ts), array_agg(low order by ts), array_agg(close order by ts),
         array_agg(volume order by ts), count(*)::integer, min(source)
    from bars;
$$;
revoke all on function public.bt_candles_cols(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.bt_candles_cols(text, text, timestamptz) to service_role;
