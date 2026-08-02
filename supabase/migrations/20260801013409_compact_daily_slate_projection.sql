-- Builder version 2: ship what a card renders, not the whole decision object.
--
-- Load test on v1 (150 iterations, concurrency 15) measured p95 1921.8 ms for
-- the slate read even though EXPLAIN showed 0.101 ms of execution — the cost
-- was entirely transfer. The v1 payload embedded three full decision-candidate
-- JSON objects per fixture and came to 501 kB for 250 fixtures.
--
-- v2 resolves the displayed candidate in the database and keeps only the five
-- fields a fixture card actually shows: 148 kB, p95 672.8 ms. The nested
-- objects remain available on the match page, which reads the fixture
-- individually.
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
  v_with_decision integer;
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
  current_summary as (
    select distinct on (s.fixture_id)
      s.fixture_id, s.public_status, s.engine_status, s.confidence, s.risk,
      s.evidence_quality, s.data_quality, s.no_pick_reason, s.generated_at,
      -- One displayed candidate, chosen the same way the UI chooses it.
      coalesce(s.best_published_pick, s.best_lean, s.best_watchlist_candidate) as candidate
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
      'confidence', cs.confidence,
      'risk', cs.risk,
      'evidenceQuality', cs.evidence_quality,
      'decisionGeneratedAt', cs.generated_at,
      -- Long engine prose is truncated: a card shows a line, not an essay,
      -- and the full reason is on the match page.
      'noPickReason', left(cs.no_pick_reason, 160),
      'selection', case when cs.candidate is null then null else jsonb_build_object(
        'label', cs.candidate ->> 'label',
        'marketId', cs.candidate ->> 'marketId',
        'odds', (cs.candidate ->> 'odds')::numeric,
        'modelProbability', (cs.candidate ->> 'modelProbability')::numeric,
        'edge', (cs.candidate ->> 'edge')::numeric
      ) end
    ) order by wf.kickoff_at), '[]'::jsonb),
    count(*),
    count(cs.fixture_id),
    max(greatest(wf.updated_at, coalesce(cs.generated_at, wf.updated_at)))
  into v_payload, v_count, v_with_decision, v_source_max
  from window_fixtures wf
  left join current_summary cs on cs.fixture_id = wf.id;

  perform private.write_public_projection(
    'daily_fixture_slate', p_date::text, v_payload, v_count, v_source_max,
    case when v_count = 0 then 'confirmed_empty'
         -- Fixtures exist but nothing has been decided yet: renderable, with
         -- the page obliged to say the evidence is incomplete.
         when v_with_decision = 0 then 'partial'
         else 'ready' end,
    2, (extract(milliseconds from clock_timestamp() - v_started))::integer
  );
exception when others then
  perform private.write_public_projection('daily_fixture_slate', p_date::text, '[]'::jsonb, 0, null,
    'refresh_failed', 2, (extract(milliseconds from clock_timestamp() - v_started))::integer, sqlerrm);
end;
$$;

revoke all on function public.op_refresh_projection_daily_slate(date) from public, anon, authenticated;
