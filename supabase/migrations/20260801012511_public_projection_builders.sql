-- Per-projection builders. Each is idempotent, bounded, and wrapped so that a
-- failure records itself without destroying the last good payload.

-- Daily slate: fixtures for a date plus their current decision summary.
-- Bounded to 250 fixtures; the payload is what a page renders, not a corpus.
create or replace function public.op_refresh_projection_daily_slate(p_date date default (now() at time zone 'utc')::date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_payload jsonb;
  v_count integer;
  v_source_max timestamptz;
begin
  with window_fixtures as (
    select f.id, f.external_id, f.sport, f.status, f.league_name, f.country,
           f.home_team_name, f.away_team_name, f.kickoff_at, f.home_score, f.away_score, f.updated_at
    from public.op_fixtures f
    where f.kickoff_at >= p_date::timestamptz
      and f.kickoff_at < (p_date + 1)::timestamptz
    order by f.kickoff_at asc
    limit 250
  ),
  -- distinct on beats a correlated subquery here: one ordered pass over the
  -- fixture-scoped index instead of a lookup per fixture.
  current_summary as (
    select distinct on (s.fixture_id)
      s.fixture_id, s.public_status, s.engine_status, s.confidence, s.risk,
      s.evidence_quality, s.data_quality, s.best_published_pick,
      s.best_lean, s.best_watchlist_candidate, s.no_pick_reason, s.generated_at
    from public.op_fixture_decision_summaries s
    where s.fixture_id in (select id from window_fixtures)
      and s.superseded_by is null
    order by s.fixture_id, s.generated_at desc
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'fixtureId', wf.external_id,
      'sport', wf.sport,
      'status', wf.status,
      'competition', wf.league_name,
      'country', wf.country,
      'homeTeam', wf.home_team_name,
      'awayTeam', wf.away_team_name,
      'kickoffAt', wf.kickoff_at,
      'homeScore', wf.home_score,
      'awayScore', wf.away_score,
      'publicStatus', cs.public_status,
      'engineStatus', cs.engine_status,
      'confidence', cs.confidence,
      'risk', cs.risk,
      'evidenceQuality', cs.evidence_quality,
      'dataQuality', cs.data_quality,
      'bestPublishedPick', cs.best_published_pick,
      'bestLean', cs.best_lean,
      'bestWatchlistCandidate', cs.best_watchlist_candidate,
      'noPickReason', cs.no_pick_reason,
      'decisionGeneratedAt', cs.generated_at
    ) order by wf.kickoff_at), '[]'::jsonb),
    count(*),
    max(greatest(wf.updated_at, coalesce(cs.generated_at, wf.updated_at)))
  into v_payload, v_count, v_source_max
  from window_fixtures wf
  left join current_summary cs on cs.fixture_id = wf.id;

  perform private.write_public_projection(
    'daily_fixture_slate', p_date::text, v_payload, v_count, v_source_max,
    case when v_count = 0 then 'confirmed_empty'
         -- Fixtures exist but no decision has been generated for any of them:
         -- renderable, but the page must say evidence is incomplete.
         when v_count > 0 and not exists (select 1 from jsonb_array_elements(v_payload) e where e->>'publicStatus' is not null) then 'partial'
         else 'ready' end,
    1, (extract(milliseconds from clock_timestamp() - v_started))::integer
  );
exception when others then
  perform private.write_public_projection('daily_fixture_slate', p_date::text, '[]'::jsonb, 0, null,
    'refresh_failed', 1, (extract(milliseconds from clock_timestamp() - v_started))::integer, sqlerrm);
end;
$$;

-- Live board: in-play and imminent fixtures only. Small and hot.
create or replace function public.op_refresh_projection_live_board()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_payload jsonb; v_count integer; v_source_max timestamptz;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'fixtureId', f.external_id, 'sport', f.sport, 'status', f.status,
    'competition', f.league_name, 'country', f.country,
    'homeTeam', f.home_team_name, 'awayTeam', f.away_team_name,
    'kickoffAt', f.kickoff_at, 'homeScore', f.home_score, 'awayScore', f.away_score,
    'updatedAt', f.updated_at) order by f.kickoff_at), '[]'::jsonb),
    count(*), max(f.updated_at)
  into v_payload, v_count, v_source_max
  from (
    select * from public.op_fixtures
    where status in ('live', 'finished', 'scheduled')
      and kickoff_at >= now() - interval '6 hours'
      and kickoff_at <= now() + interval '6 hours'
    order by kickoff_at asc
    limit 200
  ) f;

  perform private.write_public_projection('live_fixture_board', '', v_payload, v_count, v_source_max,
    case when v_count = 0 then 'confirmed_empty' else 'ready' end,
    1, (extract(milliseconds from clock_timestamp() - v_started))::integer);
exception when others then
  perform private.write_public_projection('live_fixture_board', '', '[]'::jsonb, 0, null,
    'refresh_failed', 1, (extract(milliseconds from clock_timestamp() - v_started))::integer, sqlerrm);
end;
$$;

-- Performance summary, from the publication ledger only.
create or replace function public.op_refresh_projection_performance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_payload jsonb; v_count integer; v_source_max timestamptz;
  v_won integer; v_lost integer; v_decided integer; v_returns numeric;
begin
  select count(*) filter (where settlement_status = 'won'),
         count(*) filter (where settlement_status = 'lost'),
         coalesce(sum(odds_at_publication) filter (where settlement_status = 'won'), 0),
         count(*), max(greatest(published_at, coalesce(settled_at, published_at)))
  into v_won, v_lost, v_returns, v_count, v_source_max
  from public.op_publications
  where publication_status <> 'retracted';

  v_decided := v_won + v_lost;
  v_payload := jsonb_build_object(
    'totalPublished', v_count,
    'won', v_won,
    'lost', v_lost,
    'decided', v_decided,
    -- null, never 0: a model with nothing decided has no accuracy.
    'accuracy', case when v_decided > 0 then round((v_won::numeric / v_decided), 6) else null end,
    'roi', case when v_decided > 0 then round(((v_returns - v_decided) / v_decided), 6) else null end
  );

  perform private.write_public_projection('performance_summary', '', v_payload, v_count, v_source_max,
    case when v_count = 0 then 'confirmed_empty' else 'ready' end,
    1, (extract(milliseconds from clock_timestamp() - v_started))::integer);
exception when others then
  perform private.write_public_projection('performance_summary', '', '{}'::jsonb, 0, null,
    'refresh_failed', 1, (extract(milliseconds from clock_timestamp() - v_started))::integer, sqlerrm);
end;
$$;

-- Engine status: last successful run per job, from the run ledger.
create or replace function public.op_refresh_projection_engine_status()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_payload jsonb; v_count integer; v_source_max timestamptz;
begin
  select coalesce(jsonb_object_agg(job_type, jsonb_build_object('lastSuccessAt', last_success, 'lastStatus', last_status)), '{}'::jsonb),
         count(*), max(last_success)
  into v_payload, v_count, v_source_max
  from (
    select job_type,
           max(completed_at) filter (where status = 'completed') as last_success,
           (array_agg(status order by started_at desc))[1] as last_status
    from public.op_provider_ingestion_runs
    where started_at > now() - interval '7 days'
    group by job_type
  ) runs;

  perform private.write_public_projection('latest_engine_status', '', v_payload, v_count, v_source_max,
    case when v_count = 0 then 'confirmed_empty' else 'ready' end,
    1, (extract(milliseconds from clock_timestamp() - v_started))::integer);
exception when others then
  perform private.write_public_projection('latest_engine_status', '', '{}'::jsonb, 0, null,
    'refresh_failed', 1, (extract(milliseconds from clock_timestamp() - v_started))::integer, sqlerrm);
end;
$$;

-- Orchestrator: one projection failing must not stop the others, so each
-- builder owns its own exception handling and this only sequences them.
create or replace function public.op_refresh_public_projections()
returns table (name text, scope text, status text, row_count integer, build_duration_ms integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.op_refresh_projection_daily_slate((now() at time zone 'utc')::date);
  perform public.op_refresh_projection_daily_slate(((now() at time zone 'utc')::date + 1));
  perform public.op_refresh_projection_live_board();
  perform public.op_refresh_projection_performance();
  perform public.op_refresh_projection_engine_status();

  return query
  select p.name, p.scope, p.status, p.row_count, p.build_duration_ms
  from public.op_public_projections p
  order by p.name, p.scope;
end;
$$;

revoke all on function public.op_refresh_public_projections() from public, anon, authenticated;
revoke all on function public.op_refresh_projection_daily_slate(date) from public, anon, authenticated;
revoke all on function public.op_refresh_projection_live_board() from public, anon, authenticated;
revoke all on function public.op_refresh_projection_performance() from public, anon, authenticated;
revoke all on function public.op_refresh_projection_engine_status() from public, anon, authenticated;
