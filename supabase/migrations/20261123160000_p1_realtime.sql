-- Plan « Tout en ligne », étape O5 (décision T-043) : diffusion de l'état publié de P1 au
-- navigateur par Supabase Realtime, canal PUBLIC « p1-public ».
--
-- Chaque insertion ou modification d'une ligne de p1_state dont la clé est publique
-- (agenda, calendrier officiel, flux, chiffres captés, réactions du BTC, état de la capture)
-- est envoyée par realtime.send(charge, 'state', 'p1-public', false) : « false » = canal
-- public, rejoint avec la clé publishable du front, sans session (documentation Supabase,
-- Realtime > Broadcast > « Broadcast from the Database », lue le 23/11/2026). Les messages
-- passent par realtime.messages (effacés après 3 jours).
--
-- Jamais diffusé : les verrous de la capture (lock:…), l'état interne de l'API (release:api-…).
-- Les tables, elles, restent sans politique RLS : la clé publishable ne lit aucune table.

create or replace function public.p1_state_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.key like 'calendar:%'
     or new.key in ('feed:calendar', 'feed:bls-calendar', 'release:state', 'release:last')
     or new.key like 'release:us-%'
     or new.key like 'reaction:%' then
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
revoke all on function public.p1_state_broadcast() from public, anon, authenticated;

create trigger p1_state_broadcast
  after insert or update on public.p1_state
  for each row execute function public.p1_state_broadcast();
