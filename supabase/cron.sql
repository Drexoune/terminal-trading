-- Planification du collecteur OKX du Mode Online : un appel par minute.
--
-- À exécuter UNE fois dans l'éditeur SQL du projet Supabase, APRÈS la migration
-- (supabase db push) et le déploiement de la fonction. Ce n'est pas une
-- migration : il porte des secrets. Remplacer les deux valeurs ci-dessous dans
-- l'éditeur, jamais dans ce fichier : une version remplie ne doit pas être
-- versionnée.
--
-- Mécanisme (doc Supabase « Scheduling Edge Functions », à vérifier au
-- déploiement) : pg_cron lance chaque minute un net.http_post (pg_net), qui
-- appelle l'Edge Function en POST avec l'en-tête x-collector-secret. Les deux
-- valeurs sont gardées chiffrées dans Vault et relues à chaque appel.

-- 1. Secrets dans Vault (créés, ou mis à jour si le script est rejoué).
do $$
declare
  v_project_url      text := 'https://VOTRE-REF.supabase.co';  -- à remplacer : URL du projet
  v_collector_secret text := 'VALEUR-DE-COLLECTOR_SECRET';     -- à remplacer : même valeur que « supabase secrets set »
  v_name             text;
  v_value            text;
begin
  if v_project_url like '%VOTRE-REF%' or v_collector_secret like 'VALEUR-%' then
    raise exception 'remplacer les deux valeurs du bloc avant d''exécuter ce script';
  end if;
  if length(v_collector_secret) < 32 then
    raise exception 'le secret d''appel doit faire 32 caractères au moins (openssl rand -hex 32)';
  end if;
  foreach v_name in array array['project_url', 'collector_secret'] loop
    v_value := case v_name when 'project_url' then rtrim(v_project_url, '/') else v_collector_secret end;
    if exists (select 1 from vault.secrets where name = v_name) then
      perform vault.update_secret((select id from vault.secrets where name = v_name), v_value);
    else
      perform vault.create_secret(v_value, v_name);
    end if;
  end loop;
end $$;

-- 2. Appel chaque minute. Une tâche de même nom est remplacée, jamais dupliquée.
--    Délai de 20 s : un passage normal dure moins de 2 s (10 requêtes OKX).
select cron.schedule(
  'okx-collector-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/okx-collector',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-collector-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'collector_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  ) as request_id;
  $$
);

-- Vérifier (quelques minutes après) :
--   La tâche existe et est active :
--     select jobid, jobname, schedule, active from cron.job;
--   pg_cron a bien lancé l'appel (« succeeded » = requête HTTP mise en file,
--   pas encore le résultat de la fonction) :
--     select status, return_message, start_time from cron.job_run_details
--      where jobid = (select jobid from cron.job where jobname = 'okx-collector-every-minute')
--      order by start_time desc limit 10;
--   Réponse de la fonction (200 = passage ok, 401 = secret différent de
--   COLLECTOR_SECRET, 500 = erreur détaillée dans content) ; pg_net garde ces
--   réponses quelques heures :
--     select id, status_code, content, error_msg, created from net._http_response
--      order by created desc limit 10;
--   Journal du collecteur :
--     select * from public.collector_runs order by started_at desc limit 10;
--     select * from public.collector_gaps order by detected_at desc limit 10;
--
-- Arrêter le collecteur (les données restent, la rétention continue) :
--     select cron.unschedule('okx-collector-every-minute');
-- Le relancer : réexécuter l'étape 2.
