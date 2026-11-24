-- Plan P4 (sentiment et liquidité), étape S1 : planifie les tâches de p4-jobs.
--   p4-closes      chaque jour à 22:30 UTC (après la clôture de New York) et à 06:00 UTC (FRED) :
--                  VIX (Cboe), écart haut rendement (FRED), SPY, TLT, CPER, GLD, AUD/JPY (Tiingo),
--                  BTC et ETH (OKX) ;
--   p4-liquidity   chaque jour à 06:10 UTC : bilan de la Fed, compte du Trésor, reverse repo ;
--   p4-cot         vendredi à 21:00 UTC (publication à 15:30 New York), repris samedi à 09:00 UTC ;
--   p4-crowding    toutes les 15 min : ratios long/short et financement de Binance, OKX, Bybit.
-- Jamais pendant les jalons de P1 (04/12, 08/12, 10/12) : aucun déploiement ces jours-là (T-059).
--
-- Ne porte aucun secret : relit project_url et p1_jobs_secret dans Vault (p4-jobs utilise le même
-- secret d'appel). Rejouable. Depuis le Mac :
--   supabase db query --remote --yes -f supabase/cron-p4.sql
-- Arrêt : select cron.unschedule(j) from unnest(array['p4-closes-eve','p4-closes-morn',
--         'p4-liquidity','p4-cot','p4-cot-retry','p4-crowding']) j;
-- Débit : Tiingo 5 requêtes par passage (10 par jour, budget de 50 par heure partagé avec la
-- watchlist) ; FRED 5 ; Cboe 1 ; OKX 2 ; CFTC 1 par semaine ; plateformes 20 par quart d'heure.

do $$
declare
  jobs text[][] := array[
    array['p4-closes-eve',  '30 22 * * *',  'closes'],
    array['p4-closes-morn', '0 6 * * *',    'closes'],
    array['p4-liquidity',   '10 6 * * *',   'liquidity'],
    array['p4-cot',         '0 21 * * 5',   'cot'],
    array['p4-cot-retry',   '0 9 * * 6',    'cot'],
    array['p4-crowding',    '*/15 * * * *', 'crowding']
  ];
  j text[];
begin
  if not exists (select 1 from vault.secrets where name = 'p1_jobs_secret') then
    raise exception 'secret p1_jobs_secret absent de Vault : exécuter d''abord supabase/cron-p1.sql';
  end if;
  foreach j slice 1 in array jobs loop
    perform cron.schedule(j[1], j[2], format($job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/p4-jobs?job=%s',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-jobs-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'p1_jobs_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      ) as request_id;
      $job$, j[3]));
  end loop;
end $$;

-- Vérifier : select jobname, schedule, active from cron.job where jobname like 'p4-%';
--            select key, value->>'last_error' from public.p4_state where key like 'feed:%';
-- Premier remplissage, à la main après le déploiement : closes, liquidity, cot, crowding.
