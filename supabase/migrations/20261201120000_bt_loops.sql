-- Section Backtest, étape S4 (T-064) : recherche autonome. Une ligne de bt_loops par recherche
-- (plan, état, budget consommé, rapport final), une ligne de bt_attempts par essai (code, paramètres,
-- mesures dans l'échantillon, note partielle). Écrites par bt-jobs (tâche loop) et par la fonction
-- Vercel /api/backtest (création, arrêt), lues par /api/backtest. Le verdict hors échantillon d'un
-- essai (oos_pass, oos_reasons) n'est renvoyé à l'écran qu'une fois la recherche finie.
-- RLS activée sans politique, comme toutes les tables du terminal.

create table public.bt_loops (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  status        text        not null default 'running'
                check (status in ('running', 'waiting', 'stopping', 'done', 'stopped', 'failed')),
  title         text        not null,
  spec          jsonb       not null,                 -- plan : marchés et bornes, critères, budget, graine, départ
  attempts      integer     not null default 0,
  gemini_calls  integer     not null default 0,
  best_score    double precision,
  best_n        integer,
  note          text,                                 -- attente (plafond du jour), motif de fin
  verdict       text        check (verdict in ('passed', 'none')),
  report        jsonb,
  next_run_at   timestamptz not null default now(),
  lease_until   timestamptz not null default 'epoch', -- bail d'un passage de bt-jobs
  lease_token   text,
  finished_at   timestamptz
);
create index bt_loops_due on public.bt_loops (next_run_at) where status in ('running', 'waiting', 'stopping');
alter table public.bt_loops enable row level security;
revoke all on public.bt_loops from anon, authenticated;

create table public.bt_attempts (
  loop_id       uuid        not null references public.bt_loops (id) on delete cascade,
  n             integer     not null,
  created_at    timestamptz not null default now(),
  kind          text        not null check (kind in ('start', 'generate', 'rewrite', 'params')),
  parent        integer,
  title         text,
  code          text,
  inputs        jsonb       not null default '{}',
  change        text,
  gemini_calls  integer     not null default 0,
  ok            boolean     not null,
  error         text,
  score         double precision,                     -- note partielle sur 100, dans l'échantillon
  is_pass       boolean     not null default false,
  oos_pass      boolean,                              -- consulté seulement si is_pass ; masqué jusqu'à la fin
  oos_reasons   jsonb,
  detail        jsonb,                                -- par marché : critères, crédits, mesures dans l'échantillon
  sr_bars       jsonb,                                -- Sharpe par barre dans l'échantillon (N du Sharpe déflaté)
  ms            integer,
  primary key (loop_id, n)
);
alter table public.bt_attempts enable row level security;
revoke all on public.bt_attempts from anon, authenticated;

-- pg_cron n'appelle bt-jobs?job=loop que si une recherche attend son tour (supabase/cron-bt.sql).
create function public.bt_loop_due() returns boolean
language sql stable
set search_path = public
as $$
  select exists (select 1 from bt_loops where status in ('running', 'waiting', 'stopping') and next_run_at <= now() and lease_until < now());
$$;
revoke all on function public.bt_loop_due() from public, anon, authenticated;
