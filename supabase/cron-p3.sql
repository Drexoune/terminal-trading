-- Plan P3 (macro et heatmap), étapes M1 à M3 : planifie les tâches de p3-jobs.
--   p3-macro     chaque jour à 06:30 UTC : FRED (États-Unis), BCE (zone euro), BIS mensuel ;
--   p3-fx        chaque jour à 06:40 UTC : changes contre le dollar (FRED H.10), fins de mois ;
--   p3-scores    toutes les 10 min : matrice, scores et biais du jour ;
--   p3-backtest  le 2 de chaque mois à 07:00 UTC : porte de P3.
-- Les séries de l'OCDE ne se relèvent pas depuis Supabase (décision T-057).
--
-- Ne porte aucun secret : relit project_url et p1_jobs_secret dans Vault (p3-jobs utilise le même
-- secret d'appel). Rejouable. Depuis le Mac :
--   supabase db query --remote --yes -f supabase/cron-p3.sql
-- Arrêt : select cron.unschedule('p3-macro'); select cron.unschedule('p3-fx');
--         select cron.unschedule('p3-scores'); select cron.unschedule('p3-backtest');
-- Débit : FRED 13 requêtes, BCE 4, BIS 1 par jour.

do $$
declare
  jobs text[][] := array[
    array['p3-macro',    '30 6 * * *',   'macro'],
    array['p3-fx',       '40 6 * * *',   'fx'],
    array['p3-scores',   '*/10 * * * *', 'scores'],
    array['p3-backtest', '0 7 2 * *',    'backtest']
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
               || '/functions/v1/p3-jobs?job=%s',
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

-- Vérifier : select jobname, schedule, active from cron.job where jobname like 'p3-%';
--            select id, last_period, last_error from public.macro_series order by id;
-- Premier remplissage, à la main après le déploiement (dans cet ordre) : macro, fx, scores, backtest.
