-- Plan « Tout en ligne », étape O2 : état publié de P1 (docs/plan-online.md).
--
-- Une ligne par clé, sous les mêmes noms que le bus de la passerelle du Mac
-- (calendar:week:2026-W48, calendar:official, feed:calendar, release:…). Les Edge
-- Functions l'écrivent ; la fonction Vercel /api/p1 le lit pour le front en Mode Online ;
-- à l'étape O5, Supabase Realtime en diffusera les changements (canal public, T-043).
--
-- Accès : RLS activée sans aucune politique, comme toutes les tables de P1.

create table public.p1_state (
  key        text primary key,
  value      jsonb not null,
  updated_ms bigint not null
);
alter table public.p1_state enable row level security;
