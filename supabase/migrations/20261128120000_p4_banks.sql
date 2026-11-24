-- Plan P4, étape S3 : Bank Participation Report de la CFTC (décision T-060). La CFTC refuse
-- Supabase ; la page est lue par Vercel (/api/sentiment/bpr) et écrite ici par p4-jobs (tâche
-- « banks »). Une ligne par mois et par marché : total des banques (américaines et non
-- américaines). RLS activée sans politique, comme toutes les tables du terminal.
create table public.bank_positions (
  report_date    date        not null,             -- premier mardi du mois, à la source
  market         text        not null,             -- libellé de la CFTC (« CME EURO FX »)
  banks          integer,                          -- nombre de banques ; masqué sous 4 (confidentialité)
  long           bigint      not null,
  long_pct       numeric     not null,             -- % de l'intérêt ouvert
  short          bigint      not null,
  short_pct      numeric     not null,
  open_interest  bigint      not null,
  ts_recv        timestamptz not null default now(),
  primary key (report_date, market)
);
alter table public.bank_positions enable row level security;
revoke all on public.bank_positions from anon, authenticated;
