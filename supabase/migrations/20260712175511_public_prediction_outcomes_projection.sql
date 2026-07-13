create table public.op_public_prediction_outcomes (
  id uuid primary key,
  fixture_external_id text not null,
  sport text not null check (sport in ('football', 'basketball', 'tennis')),
  league text,
  country text,
  home_team text,
  away_team text,
  kickoff_at timestamptz,
  market text not null,
  selection text not null,
  recommended_selection text,
  model_probability numeric not null,
  value_edge numeric not null,
  odds numeric not null,
  result text not null check (result in ('pending', 'won', 'lost', 'push')),
  engine_action text,
  confidence text,
  paper_only boolean not null default true,
  record_source text not null,
  created_at timestamptz not null,
  settled_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.op_public_prediction_outcomes is
  'Sanitized, read-only projection of the OddsPadi prediction ledger for public product proof.';

create index op_public_prediction_outcomes_created_at_idx
  on public.op_public_prediction_outcomes (created_at desc);
create index op_public_prediction_outcomes_filter_idx
  on public.op_public_prediction_outcomes (sport, result, created_at desc);

alter table public.op_public_prediction_outcomes enable row level security;
revoke all on table public.op_public_prediction_outcomes from public, anon, authenticated;
grant select on table public.op_public_prediction_outcomes to anon, authenticated;

create policy "Public outcomes are readable"
  on public.op_public_prediction_outcomes
  for select
  to anon, authenticated
  using (true);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.sync_public_prediction_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.op_public_prediction_outcomes where id = old.id;
    return old;
  end if;

  insert into public.op_public_prediction_outcomes (
    id, fixture_external_id, sport, league, country, home_team, away_team,
    kickoff_at, market, selection, recommended_selection, model_probability,
    value_edge, odds, result, engine_action, confidence, paper_only,
    record_source, created_at, settled_at, updated_at
  ) values (
    new.id,
    new.fixture_external_id,
    lower(new.sport),
    nullif(new.metadata ->> 'league', ''),
    nullif(new.metadata ->> 'country', ''),
    nullif(new.metadata ->> 'homeTeam', ''),
    nullif(new.metadata ->> 'awayTeam', ''),
    case when coalesce(new.metadata ->> 'kickoffTime', '') ~ '^\d{4}-\d{2}-\d{2}T' then (new.metadata ->> 'kickoffTime')::timestamptz else null end,
    new.market,
    new.selection,
    nullif(new.metadata ->> 'recommendedSelection', ''),
    new.model_probability,
    new.value_edge,
    new.odds,
    lower(new.result),
    nullif(new.metadata ->> 'finalAction', ''),
    nullif(new.metadata ->> 'finalConfidence', ''),
    coalesce((new.metadata ->> 'paperOnly')::boolean, true),
    new.source,
    new.created_at,
    new.settled_at,
    now()
  )
  on conflict (id) do update set
    fixture_external_id = excluded.fixture_external_id,
    sport = excluded.sport,
    league = excluded.league,
    country = excluded.country,
    home_team = excluded.home_team,
    away_team = excluded.away_team,
    kickoff_at = excluded.kickoff_at,
    market = excluded.market,
    selection = excluded.selection,
    recommended_selection = excluded.recommended_selection,
    model_probability = excluded.model_probability,
    value_edge = excluded.value_edge,
    odds = excluded.odds,
    result = excluded.result,
    engine_action = excluded.engine_action,
    confidence = excluded.confidence,
    paper_only = excluded.paper_only,
    record_source = excluded.record_source,
    created_at = excluded.created_at,
    settled_at = excluded.settled_at,
    updated_at = now();

  return new;
end;
$$;

revoke all on function private.sync_public_prediction_outcome() from public, anon, authenticated;

create trigger sync_public_prediction_outcome
after insert or update or delete on public.op_prediction_outcomes
for each row execute function private.sync_public_prediction_outcome();

insert into public.op_public_prediction_outcomes (
  id, fixture_external_id, sport, league, country, home_team, away_team,
  kickoff_at, market, selection, recommended_selection, model_probability,
  value_edge, odds, result, engine_action, confidence, paper_only,
  record_source, created_at, settled_at, updated_at
)
select
  id,
  fixture_external_id,
  lower(sport),
  nullif(metadata ->> 'league', ''),
  nullif(metadata ->> 'country', ''),
  nullif(metadata ->> 'homeTeam', ''),
  nullif(metadata ->> 'awayTeam', ''),
  case when coalesce(metadata ->> 'kickoffTime', '') ~ '^\d{4}-\d{2}-\d{2}T' then (metadata ->> 'kickoffTime')::timestamptz else null end,
  market,
  selection,
  nullif(metadata ->> 'recommendedSelection', ''),
  model_probability,
  value_edge,
  odds,
  lower(result),
  nullif(metadata ->> 'finalAction', ''),
  nullif(metadata ->> 'finalConfidence', ''),
  coalesce((metadata ->> 'paperOnly')::boolean, true),
  source,
  created_at,
  settled_at,
  now()
from public.op_prediction_outcomes
on conflict (id) do nothing;
