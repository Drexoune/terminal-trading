-- Plan P2 (écran Taux), étape R1 : planifie les tâches de p2-jobs.
--   rates          chaque minute (porte de P2 : probabilités de la prochaine réunion de la Fed
--                  mises à jour chaque minute) ;
--   rates-history  chaque jour à 05:20 UTC (historique 60 jours, complété depuis le dernier point) ;
--   policy         deux fois par jour, 07:10 et 19:10 UTC (taux directeurs du BIS, publiés en retard) ;
--   decisions      toutes les 10 min (dernière décision et vote, URL tirée du fil d'actus de P1).
--
-- Ne porte aucun secret : relit project_url et p1_jobs_secret dans Vault (p2-jobs utilise le même
-- secret d'appel). Rejouable. Depuis le Mac :
--   supabase db query --remote --yes -f supabase/cron-p2.sql
-- Arrêt : select cron.unschedule('p2-rates'); select cron.unschedule('p2-rates-history'); select cron.unschedule('p2-policy');
--        select cron.unschedule('p2-decisions');
-- Débit : Polymarket 2 requêtes par minute (+ 8 recherches Gamma toutes les 15 min), Kalshi 6 par minute.

do $$
declare
  jobs text[][] := array[
    array['p2-rates',         '* * * * *',    'rates'],
    array['p2-rates-history', '20 5 * * *',   'rates-history'],
    array['p2-policy',        '10 7,19 * * *', 'policy'],
    array['p2-decisions',     '*/10 * * * *', 'decisions']
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
               || '/functions/v1/p2-jobs?job=%s',
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

-- Vérifier : select jobname, schedule, active from cron.job where jobname like 'p2-%';
--            select bank, meeting, source, ts from public.rate_quotes order by ts desc limit 10;
-- Premier remplissage, à la main après le déploiement (dans cet ordre) : policy, rates, rates-history, decisions.
