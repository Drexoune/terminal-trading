-- Plan P2 (écran Taux), étape R1 : probabilités de taux, taux directeurs et état publié de P2,
-- écrits par l'Edge Function p2-jobs (tâches rates, rates-history, policy). Aucune table de P1
-- n'est modifiée (décision T-049).
--
-- RLS activée sans aucune politique, comme toutes les tables du terminal : seules les fonctions
-- (clé secrète) lisent et écrivent.

-- Marchés de prédiction rattachés à une réunion officielle (découverte Polymarket toutes les 15 min).
create table public.rate_markets (
  source      text        not null,                 -- polymarket
  bank        text        not null,                 -- FED, BCE, BOE, BOJ, BNS, BOC, RBA, RBNZ
  meeting     date        not null,                 -- jour de l'annonce, fuseau de la banque
  event_id    text        not null,                 -- slug de l'événement
  title       text        not null,
  end_date    timestamptz,                          -- fin de l'événement donnée par la source
  outcomes    jsonb       not null,                 -- {"hold": {"token": "…", "label": "No change", "vol24": 829098.8}, …}
  ts_recv     timestamptz not null default now(),   -- dernière découverte
  primary key (source, bank, meeting)
);
alter table public.rate_markets enable row level security;
revoke all on public.rate_markets from anon, authenticated;

-- Instantané des probabilités : une ligne par minute, source, banque et réunion (réunions suivantes
-- toutes les 15 min). Les lignes de chaque minute sont gardées 3 jours, celles de la minute 0 de
-- chaque heure sans limite (historique fin au-delà des fenêtres des sources).
create table public.rate_quotes (
  ts          timestamptz not null,                 -- minute de la collecte (UTC)
  source      text        not null,                 -- polymarket, kalshi
  bank        text        not null,
  meeting     date        not null,
  probs       jsonb       not null,                 -- {"hold": {"p": 0.033, "bid": 0.031, "ask": 0.035, "last": 0.035, "wide": false, "vol24": …}, …}
  total       numeric,                              -- somme des probabilités
  ts_source   timestamptz,                          -- heure de la source (carnet Polymarket) ; null si la source ne date pas la cotation
  ts_recv     timestamptz not null,                 -- heure de réception
  hourly      boolean     generated always as (extract(minute from ts at time zone 'UTC') = 0) stored,
  primary key (source, bank, meeting, ts)
);
create index rate_quotes_bank_meeting_ts on public.rate_quotes (bank, meeting, ts desc);
alter table public.rate_quotes enable row level security;
revoke all on public.rate_quotes from anon, authenticated;

-- Historique des sources (backfill 60 jours, puis complété chaque jour) : un point par issue.
create table public.rate_history (
  source      text        not null,                 -- polymarket, kalshi
  bank        text        not null,
  meeting     date        not null,
  outcome     text        not null,                 -- m50, m25, hold, p25, p50
  t           timestamptz not null,                 -- heure du point donnée par la source
  p           numeric     not null,                 -- probabilité 0–1
  step        text        not null,                 -- 1h ou 1d
  primary key (source, bank, meeting, outcome, t)
);
alter table public.rate_history enable row level security;
revoke all on public.rate_history from anon, authenticated;

-- Taux directeurs du BIS (WS_CBPOL, quotidien) : une ligne par banque et date d'observation.
create table public.policy_rates (
  bank        text        not null,
  obs_date    date        not null,
  rate        numeric     not null,
  ts_recv     timestamptz not null default now(),
  primary key (bank, obs_date)
);
alter table public.policy_rates enable row level security;
revoke all on public.policy_rates from anon, authenticated;

-- Décisions et votes des comités (étape R4), lus sur les pages officielles.
create table public.rate_decisions (
  bank        text        not null,
  decision_date date      not null,
  change_bp   integer,                              -- variation décidée en points de base, null si inconnue
  rate_text   text,                                 -- libellé officiel du taux (« 3-3/4 to 4 percent »)
  vote        jsonb       not null,                 -- {"for": 10, "against": 2, "dissents": [...], "kind": "nominatif"} ou {"kind": "non publié"}
  quote       text,                                 -- phrase citée de la source
  source_url  text        not null,
  ts_recv     timestamptz not null default now(),
  primary key (bank, decision_date)
);
alter table public.rate_decisions enable row level security;
revoke all on public.rate_decisions from anon, authenticated;

-- État publié de P2 (état de l'écran, flux, verrous de passage), lu par /api/rates.
-- Aucune diffusion Realtime : le front relit l'état toutes les 30 s.
create table public.p2_state (
  key        text primary key,
  value      jsonb not null,
  updated_ms bigint not null
);
alter table public.p2_state enable row level security;
revoke all on public.p2_state from anon, authenticated;
