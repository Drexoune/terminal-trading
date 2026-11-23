-- Planification de l'agenda en ligne (Edge Function p1-jobs, plan « Tout en ligne », O2).
--
-- À exécuter UNE fois dans l'éditeur SQL du projet Supabase, APRÈS les migrations
-- 20261123120000_p1_online.sql et 20261123140000_p1_state.sql et le déploiement de
-- p1-jobs. Ce n'est pas une migration : il porte un secret. Remplacer la valeur ci-dessous
-- DANS L'ÉDITEUR (valeur de P1_JOBS_SECRET du .env du Mac), jamais dans ce fichier.
-- Rejouable : une tâche de même nom est remplacée, jamais dupliquée.
--
-- Même mécanisme que cron.sql et cron-bourse.sql : pg_cron lance un net.http_post vers la
-- fonction, avec l'en-tête x-jobs-secret relu dans Vault. L'URL du projet est le secret
-- « project_url » déjà créé par cron.sql.
--
-- Horaires en UTC (pg_cron compte en UTC). Minutes et non heures de session : identiques
-- toute l'année.
--   ff-calendar   hh:45 (fichier ForexFactory régénéré vers hh:42), puis hh:55, sauté si
--                 le relevé de hh:45 a réussi
--   bls-calendar  06:10, puis 06:40, sauté si le relevé de 06:10 a réussi

do $$
declare
  v_secret text := 'VALEUR-DE-P1_JOBS_SECRET';   -- à remplacer : même valeur que dans le .env du Mac
  v_job    record;
begin
  if v_secret like 'VALEUR-%' then
    raise exception 'remplacer la valeur du bloc avant d''exécuter ce script';
  end if;
  if length(v_secret) < 32 then
    raise exception 'le secret d''appel doit faire 32 caractères au moins';
  end if;
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    raise exception 'secret project_url absent de Vault : exécuter d''abord supabase/cron.sql';
  end if;

  if exists (select 1 from vault.secrets where name = 'p1_jobs_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'p1_jobs_secret'), v_secret);
  else
    perform vault.create_secret(v_secret, 'p1_jobs_secret');
  end if;

  for v_job in
    select * from (values
      ('p1-ff-calendar',    '45 * * * *', 'ff-calendar'),
      ('p1-ff-calendar-2',  '55 * * * *', 'ff-calendar'),
      ('p1-bls-calendar',   '10 6 * * *', 'bls-calendar'),
      ('p1-bls-calendar-2', '40 6 * * *', 'bls-calendar')
    ) as t(name, schedule, job)
  loop
    perform cron.schedule(v_job.name, v_job.schedule, format($job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/p1-jobs?job=%s',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-jobs-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'p1_jobs_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      ) as request_id;
      $job$, v_job.job));
  end loop;
end $$;

-- Vérifier :
--   select jobname, schedule, active from cron.job where jobname like 'p1-%';
--   select key, updated_ms from public.p1_state order by key;
--   select source, status, received_ms from public.calendar_snapshots order by id desc limit 10;
