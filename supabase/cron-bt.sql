-- Section Backtest (T-061), étape S1 : planifie la tâche candles de bt-jobs.
--   bt-candles  toutes les 15 min : bougies récentes d'OKX (BTC, ETH en 1 j et 1 h) et remontée de
--               l'historique (120 pages au plus par passage, jusqu'à 2018 en 1 j et 2021 en 1 h) ;
--               QQQ et SPY relus en entier chez Tiingo au plus une fois toutes les 20 h (2 requêtes
--               par jour ; budget de 50 par heure partagé avec la watchlist et P4).
-- Jamais pendant les jalons de P1 (04/12, 08/12, 10/12) : aucun déploiement ces jours-là (T-061).
--
-- Ne porte aucun secret : relit project_url et p1_jobs_secret dans Vault. Rejouable. Depuis le Mac :
--   supabase db query --remote --yes -f supabase/cron-bt.sql
-- Arrêt : select cron.unschedule('bt-candles');

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'p1_jobs_secret') then
    raise exception 'secret p1_jobs_secret absent de Vault : exécuter d''abord supabase/cron-p1.sql';
  end if;
  perform cron.schedule('bt-candles', '*/15 * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/bt-jobs?job=candles',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-jobs-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'p1_jobs_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 140000
    ) as request_id;
    $job$);
end $$;

-- Vérifier : select jobname, schedule, active from cron.job where jobname = 'bt-candles';
--            select value from public.bt_state where key = 'series';
