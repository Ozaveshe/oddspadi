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
    new.updated_at
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
    updated_at = excluded.updated_at;

  return new;
end;
$$;

update public.op_public_prediction_outcomes public_outcome
set updated_at = source_outcome.updated_at
from public.op_prediction_outcomes source_outcome
where public_outcome.id = source_outcome.id
  and public_outcome.updated_at is distinct from source_outcome.updated_at;
