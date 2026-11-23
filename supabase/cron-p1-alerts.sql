-- Plan « Tout en ligne », étape O4 : planifie la tâche « alerts » de p1-jobs chaque minute.
--
-- Ne porte aucun secret : relit project_url et p1_jobs_secret dans Vault (créés par cron.sql
-- et cron-p1.sql). Rejouable : la tâche de même nom est remplacée. Exécution depuis le Mac :
--   supabase db query --remote -f supabase/cron-p1-alerts.sql
-- Arrêt : select cron.unschedule('p1-alerts');

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'p1_jobs_secret') then
    raise exception 'secret p1_jobs_secret absent de Vault : exécuter d''abord supabase/cron-p1.sql';
  end if;
  perform cron.schedule('p1-alerts', '* * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/p1-jobs?job=alerts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-jobs-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'p1_jobs_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    ) as request_id;
    $job$);
end $$;

-- Vérifier : select jobname, schedule, active from cron.job where jobname = 'p1-alerts';
