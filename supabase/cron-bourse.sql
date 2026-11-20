-- Planification des relevés du module Bourse (Edge Function bourse-jobs, B0).
--
-- À exécuter UNE fois dans l'éditeur SQL du projet Supabase, APRÈS la migration
-- 20261119120000_bourse_b0.sql et le déploiement de la fonction. Ce n'est pas
-- une migration : il porte un secret. Remplacer la valeur ci-dessous dans
-- l'éditeur, jamais dans ce fichier.
--
-- Même mécanisme que supabase/cron.sql : pg_cron lance un net.http_post
-- (pg_net) vers la fonction, avec l'en-tête x-jobs-secret relu dans Vault.
-- L'URL du projet est le secret « project_url » déjà créé par cron.sql.
--
-- Horaires en UTC (pg_cron compte en UTC sur Supabase). Ce sont de simples
-- heures de lancement, pas des sessions de marché : elles tombent après les
-- publications à l'heure d'été comme à l'heure d'hiver.
--   ecb-fx    16:30, lundi à vendredi (fixing BCE vers 16:00 Francfort)
--   us-close  06:15, mardi à samedi   (clôtures US de la veille)
--   us-backfill 06:20, mardi à samedi (historique Tiingo des cotations US nouvellement suivies ; sans appel sinon)
--   eu-close  06:30 et 06:45, mardi à samedi (8 cotations par passage au plus)
--   ref-sec   dimanche 05:00          (liste des sociétés de la SEC)

do $$
declare
  v_jobs_secret text := 'VALEUR-DE-BOURSE_JOBS_SECRET';   -- à remplacer : même valeur que « supabase secrets set »
  v_job         record;
begin
  if v_jobs_secret like 'VALEUR-%' then
    raise exception 'remplacer la valeur du bloc avant d''exécuter ce script';
  end if;
  if length(v_jobs_secret) < 32 then
    raise exception 'le secret d''appel doit faire 32 caractères au moins (openssl rand -hex 32)';
  end if;
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    raise exception 'secret project_url absent de Vault : exécuter d''abord supabase/cron.sql';
  end if;

  if exists (select 1 from vault.secrets where name = 'bourse_jobs_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'bourse_jobs_secret'), v_jobs_secret);
  else
    perform vault.create_secret(v_jobs_secret, 'bourse_jobs_secret');
  end if;

  -- Une tâche de même nom est remplacée, jamais dupliquée.
  for v_job in
    select * from (values
      ('bourse-ecb-fx',    '30 16 * * 1-5', 'ecb-fx'),
      ('bourse-us-close',  '15 6 * * 2-6',  'us-close'),
      ('bourse-us-backfill', '20 6 * * 2-6', 'us-backfill'),
      ('bourse-eu-close',  '30 6 * * 2-6',  'eu-close'),
      ('bourse-eu-close-2','45 6 * * 2-6',  'eu-close'),
      ('bourse-ref-sec',   '0 5 * * 0',     'ref-sec')
    ) as t(name, schedule, job)
  loop
    perform cron.schedule(v_job.name, v_job.schedule, format($job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/bourse-jobs?job=%s',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-jobs-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bourse_jobs_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      ) as request_id;
      $job$, v_job.job));
  end loop;
end $$;

-- Vérifier (le lendemain) :
--   select jobname, schedule, active from cron.job where jobname like 'bourse-%';
--   select job, started_at, ok, rows, requests, note, error from public.bourse_runs
--    order by started_at desc limit 20;
--
-- Lancer une tâche à la main (terminal du Mac, secret dans une variable, jamais dans l'historique) :
--   curl -sS -X POST "https://<ref>.supabase.co/functions/v1/bourse-jobs?job=explore" \
--        -H "x-jobs-secret: $BOURSE_JOBS_SECRET" -o explore.json
