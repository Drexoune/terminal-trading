-- Tree of Alpha en ligne (T-072) : l'état du flux, publié par la machine Oracle (service
-- terminal-news) sous la clé feed:toa, rejoint les clés diffusées sur le canal public « p1-public »
-- (barre de flux du Mode Online). Les titres (news:item:…) l'étaient déjà. Même fonction que
-- 20261124120000_p1_news.sql, une clé de plus ; toujours jamais diffusés : verrous, alertes
-- (alert:…, dont alert:oracle), état interne de l'API du BLS.

create or replace function public.p1_state_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.key like 'calendar:%'
     or new.key in ('feed:calendar', 'feed:bls-calendar', 'feed:news', 'feed:toa', 'news:feeds', 'release:state', 'release:last')
     or new.key like 'release:us-%'
     or new.key like 'reaction:%'
     or new.key like 'news:item:%' then
    perform realtime.send(
      jsonb_build_object('key', new.key, 'value', new.value, 'updated_ms', new.updated_ms),
      'state',
      'p1-public',
      false
    );
  end if;
  return null;
end;
$$;
