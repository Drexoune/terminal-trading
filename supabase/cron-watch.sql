-- Markets Watch (T-051) : planifie la tâche « watch » de p2-jobs toutes les 3 minutes.
--
-- Ne porte aucun secret : relit project_url et p1_jobs_secret dans Vault (p2-jobs utilise le même
-- secret d'appel). Rejouable. Depuis le Mac :
--   supabase db query --remote --yes -f supabase/cron-watch.sql
-- Arrêt : select cron.unschedule('watch');
-- Budget Tiingo : 2 requêtes par passage au plus, 40 par heure (offre gratuite : 50).

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'p1_jobs_secret') then
    raise exception 'secret p1_jobs_secret absent de Vault : exécuter d''abord supabase/cron-p1.sql';
  end if;
  perform cron.schedule('watch', '*/3 * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/p2-jobs?job=watch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-jobs-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'p1_jobs_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    ) as request_id;
    $job$);
end $$;

-- Vérifier : select jobname, schedule, active from cron.job where jobname = 'watch';
--            select asset, source, ts_source, price from public.watch_quotes order by ts_recv desc limit 10;
