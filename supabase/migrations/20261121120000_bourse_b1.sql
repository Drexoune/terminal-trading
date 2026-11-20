-- Module Bourse, étape B1 (docs/plan-b1.md) : enveloppes, opérations, lots
-- d'import, ventilation des ETF. Mêmes règles que B0 (T-012, T-031) : RLS
-- activée SANS politique, aucun droit pour anon et authenticated ; seule la clé
-- secrète lit et écrit (fonction Vercel api/bourse.ts).
--
-- Montants en numeric, jamais en flottant. Dates d'opération : date civile de
-- Paris. La valorisation n'est pas stockée : elle se calcule à la demande à
-- partir des opérations, des clôtures et des cours BCE (plan B1, § 3).

-- Enveloppes : PEA, CTO… chez un courtier. perf_start : origine des
-- performances (T-038 : 28/09/2026 pour les comptes XTB).
create table public.envelopes (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('PEA', 'PEA-PME', 'CTO', 'AV', 'livret', 'compte')),
  broker      text not null check (length(broker) between 1 and 40),
  name        text not null check (length(name) between 1 and 60),
  currency    text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  perf_start  date,
  created_at  timestamptz not null default now(),
  unique (kind, broker)
);

-- Lots d'import : un fichier importé. Supprimer un lot supprime ses opérations.
create table public.import_batches (
  id           bigint generated always as identity primary key,
  envelope_id  bigint not null references public.envelopes (id) on delete cascade,
  source       text not null check (source in ('xlsx', 'saisie')),
  file_name    text check (length(file_name) <= 200),
  file_sha256  text check (file_sha256 ~ '^[0-9a-f]{64}$'),
  rows         integer not null,
  inserted     integer not null,
  imported_at  timestamptz not null default now()
);

-- Opérations, au format d'import Baggr (feuille « Aide » des exports) : tous
-- les nombres positifs, le type donne le sens ; seuls Intérêts et Taxes
-- acceptent un montant négatif (intérêts débiteurs, remboursement de taxe).
create table public.transactions (
  id              bigint generated always as identity primary key,
  envelope_id     bigint not null references public.envelopes (id) on delete cascade,
  trade_date      date not null,
  kind            text not null check (kind in (
                    'achat', 'vente', 'dividende', 'remboursement_capital', 'actions_gratuites', 'split',
                    'transfert_entrant', 'transfert_sortant', 'depot', 'retrait', 'change', 'interets',
                    'frais', 'remboursement_frais', 'taxes')),
  listing_id      bigint references public.instrument_listings (id),
  quantity        numeric check (quantity > 0),
  price           numeric check (price > 0),
  amount          numeric,
  fees            numeric not null default 0 check (fees >= 0),
  taxes           numeric not null default 0 check (taxes >= 0),
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  fx_rate         numeric check (fx_rate > 0),
  target_currency text check (target_currency ~ '^[A-Z]{3}$'),
  ratio_new       numeric check (ratio_new > 0),
  ratio_old       numeric check (ratio_old > 0),
  reference       text check (length(reference) <= 80),
  dedup_key       text not null check (length(dedup_key) between 1 and 200),
  note            text check (length(note) <= 500),
  batch_id        bigint references public.import_batches (id) on delete cascade,
  source          text not null check (source in ('import', 'saisie')),
  created_at      timestamptz not null default now(),
  unique (envelope_id, dedup_key)
);
create index transactions_envelope_date_idx on public.transactions (envelope_id, trade_date);

-- Ventilation des ETF (T-038) : poids par pays, secteur ou devise, saisis
-- depuis la fiche de l'émetteur, avec son adresse et sa date.
create table public.instrument_exposures (
  instrument_id bigint not null references public.instruments (id) on delete cascade,
  axis          text not null check (axis in ('pays', 'secteur', 'devise')),
  bucket        text not null check (length(bucket) between 1 and 60),
  weight        numeric not null check (weight >= 0 and weight <= 100),
  as_of         date not null,
  source_url    text not null check (source_url ~ '^https://'),
  source_label  text not null check (length(source_label) between 1 and 120),
  primary key (instrument_id, axis, bucket)
);

alter table public.envelopes            enable row level security;
alter table public.import_batches       enable row level security;
alter table public.transactions         enable row level security;
alter table public.instrument_exposures enable row level security;

revoke all on table public.envelopes, public.import_batches, public.transactions, public.instrument_exposures
  from anon, authenticated;
grant select, insert, update, delete on table public.envelopes, public.import_batches, public.transactions,
  public.instrument_exposures to service_role;
revoke all on sequence public.envelopes_id_seq, public.import_batches_id_seq, public.transactions_id_seq
  from anon, authenticated;

-- Import atomique d'un lot validé par la fonction Vercel : crée l'enveloppe au
-- besoin, le lot et ses opérations dans une seule transaction. Une opération
-- déjà présente (même dedup_key dans l'enveloppe) est ignorée : réimporter le
-- même fichier n'ajoute rien. Un lot sans aucune opération nouvelle n'est pas
-- gardé (batch_id null dans la réponse).
create or replace function public.bourse_import(
  p_kind text, p_broker text, p_name text, p_perf_start date,
  p_file_name text, p_file_sha256 text, p_rows jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_env bigint;
  v_batch bigint;
  v_total integer := jsonb_array_length(p_rows);
  v_inserted integer;
begin
  insert into public.envelopes (kind, broker, name, perf_start)
  values (p_kind, p_broker, p_name, p_perf_start)
  on conflict (kind, broker) do update set perf_start = coalesce(public.envelopes.perf_start, excluded.perf_start)
  returning id into v_env;

  insert into public.import_batches (envelope_id, source, file_name, file_sha256, rows, inserted)
  values (v_env, 'xlsx', p_file_name, p_file_sha256, v_total, 0)
  returning id into v_batch;

  insert into public.transactions (envelope_id, trade_date, kind, listing_id, quantity, price, amount, fees, taxes,
    currency, fx_rate, target_currency, ratio_new, ratio_old, reference, dedup_key, note, batch_id, source)
  select v_env, r.trade_date, r.kind, r.listing_id, r.quantity, r.price, r.amount, coalesce(r.fees, 0), coalesce(r.taxes, 0),
    r.currency, r.fx_rate, r.target_currency, r.ratio_new, r.ratio_old, r.reference, r.dedup_key, r.note, v_batch, 'import'
  from jsonb_to_recordset(p_rows) as r(trade_date date, kind text, listing_id bigint, quantity numeric, price numeric,
    amount numeric, fees numeric, taxes numeric, currency text, fx_rate numeric, target_currency text,
    ratio_new numeric, ratio_old numeric, reference text, dedup_key text, note text)
  on conflict (envelope_id, dedup_key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    delete from public.import_batches where id = v_batch;
    v_batch := null;
  else
    update public.import_batches set inserted = v_inserted where id = v_batch;
  end if;
  return jsonb_build_object('envelope_id', v_env, 'batch_id', v_batch, 'rows', v_total, 'inserted', v_inserted);
end;
$$;
revoke execute on function public.bourse_import(text, text, text, date, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.bourse_import(text, text, text, date, text, text, jsonb) to service_role;

-- Benchmark MSCI World (T-038) : ETF de référence, capitalisant, relevé chaque
-- nuit par eu-close. Donnée générique, pas une ligne du portefeuille.
with i as (
  insert into public.instruments (isin, name, kind, pea_eligible, pea_reason, pea_source)
  values ('LU1681043599', 'Amundi MSCI World Swap UCITS ETF EUR Acc', 'etf', true, 'ETF éligible au PEA (benchmark)', 'saisie')
  on conflict (isin) do update set name = excluded.name
  returning id
)
insert into public.instrument_listings (instrument_id, mic, exch_code, symbol, currency, price_source, source_symbol, tracked)
select id, 'XPAR', 'FP', 'CW8', 'EUR', 'alphavantage', 'CW8.PAR', true from i
on conflict (price_source, source_symbol) do update set tracked = true;
