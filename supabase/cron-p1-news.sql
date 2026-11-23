-- Plan « Tout en ligne », étape O6 : planifie la tâche « news » de p1-jobs chaque minute.
--
-- Ne porte aucun secret (relu dans Vault, comme cron-p1-alerts.sql). Rejouable. Depuis le Mac :
--   supabase db query --remote -f supabase/cron-p1-news.sql
-- Arrêt : select cron.unschedule('p1-news');
-- Délai de 70 s : dans la fenêtre d'une décision de banque centrale, l'appel relit les flux
-- de la banque toutes les 3 s pendant ~52 s.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'p1_jobs_secret') then
    raise exception 'secret p1_jobs_secret absent de Vault : exécuter d''abord supabase/cron-p1.sql';
  end if;
  perform cron.schedule('p1-news', '* * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/p1-jobs?job=news',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-jobs-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'p1_jobs_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 70000
    ) as request_id;
    $job$);
end $$;

-- Vérifier : select jobname, schedule, active from cron.job where jobname = 'p1-news';
--            select key, value from public.p1_state where key in ('feed:news', 'news:feeds');
