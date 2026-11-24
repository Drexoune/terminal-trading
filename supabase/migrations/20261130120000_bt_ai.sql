-- Section Backtest, étape S3 (T-063) : journal des appels à Gemini (plafond d'appels par jour,
-- offre gratuite seulement) et cache des réponses (règle du projet : sorties de l'IA mises en
-- cache). Écrites et lues par la fonction Vercel /api/backtest (clé secrète, côté serveur).
-- RLS activée sans politique, comme toutes les tables du terminal.

create table public.bt_ai_calls (
  id             bigint generated always as identity primary key,
  ts             timestamptz not null default now(),
  day            date        not null,                -- jour de Paris (plafond quotidien)
  route          text        not null,                -- generate, repair, explain
  model          text        not null,
  status         integer     not null,                -- statut HTTP de Gemini (0 : injoignable)
  input_tokens   integer,
  output_tokens  integer,
  cached         boolean     not null default false,
  error          text
);
create index bt_ai_calls_day on public.bt_ai_calls (day);
alter table public.bt_ai_calls enable row level security;
revoke all on public.bt_ai_calls from anon, authenticated;

create table public.bt_ai_cache (
  hash        text primary key,                       -- empreinte SHA-256 de la demande complète
  route       text        not null,
  model       text        not null,
  response    jsonb       not null,
  created_at  timestamptz not null default now()
);
alter table public.bt_ai_cache enable row level security;
revoke all on public.bt_ai_cache from anon, authenticated;
