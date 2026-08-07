-- Closing-price coverage, derived rather than stored.
--
-- A coverage table would be a second place the same facts live, and the two
-- would disagree the first time a capture was retried or an operator marked a
-- close unavailable. A function reading the rows cannot drift from them.
--
-- The breakdown by capture_status is the point. "78% coverage" is not
-- actionable; "12% insufficient_sources, 6% market_unmapped, 4% late_provider_data"
-- names three different pieces of work, only one of which is about the market.

create or replace function public.op_closing_coverage(
  p_since timestamptz default now() - interval '30 days',
  p_sport text default null
)
returns table (
  sport text,
  day date,
  eligible bigint,
  captured bigint,
  missing bigint,
  insufficient_sources bigint,
  no_quotes bigint,
  stale bigint,
  market_unmapped bigint,
  identity_failure bigint,
  late_provider_data bigint,
  operator_unavailable bigint,
  uncaptured_no_row bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.sport::text,
    (p.kickoff_at at time zone 'UTC')::date as day,
    count(*)::bigint as eligible,
    count(*) filter (where c.capture_status = 'captured')::bigint,
    count(*) filter (where c.capture_status is distinct from 'captured')::bigint,
    count(*) filter (where c.capture_status = 'insufficient_sources')::bigint,
    count(*) filter (where c.capture_status = 'no_quotes')::bigint,
    count(*) filter (where c.capture_status = 'stale')::bigint,
    count(*) filter (where c.capture_status = 'market_unmapped')::bigint,
    count(*) filter (where c.capture_status = 'identity_failure')::bigint,
    count(*) filter (where c.capture_status = 'late_provider_data')::bigint,
    count(*) filter (where c.capture_status = 'operator_unavailable')::bigint,
    -- A claim past kickoff with no capture row at all. Distinct from every
    -- reason above: those are answers, this is a claim the sweep has not
    -- reached. Folding it into "missing" would make an unrun sweep look like a
    -- market nobody priced.
    count(*) filter (where c.id is null)::bigint
  from public.op_publications p
  left join public.op_closing_prices c
    on c.publication_id = p.id and c.is_current
  where p.publication_status = 'published'
    and p.kickoff_at >= p_since
    and p.kickoff_at < now()
    and (p_sport is null or p.sport = p_sport)
  group by p.sport, (p.kickoff_at at time zone 'UTC')::date
  order by day desc, p.sport;
$$;

comment on function public.op_closing_coverage is
  'Closing coverage per sport and day, broken down by capture_status. Derived from op_publications and op_closing_prices so it cannot disagree with them. uncaptured_no_row counts claims the sweep has not reached, which is a different fact from a close that could not be captured.';

revoke all on function public.op_closing_coverage(timestamptz, text) from public, anon, authenticated;

-- The operations queue for improving coverage: the worst reasons first, with
-- enough context to act rather than merely to count.
create or replace function public.op_closing_coverage_queue(
  p_since timestamptz default now() - interval '30 days',
  p_limit integer default 100
)
returns table (
  capture_status text,
  sport text,
  market text,
  affected bigint,
  example_publication_id uuid,
  example_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.capture_status::text,
    p.sport::text,
    p.market::text,
    count(*)::bigint as affected,
    (array_agg(p.id order by p.kickoff_at desc))[1],
    (array_agg(c.missing_reason order by p.kickoff_at desc))[1]
  from public.op_closing_prices c
  join public.op_publications p on p.id = c.publication_id
  where c.is_current
    and c.capture_status <> 'captured'
    and p.kickoff_at >= p_since
  group by c.capture_status, p.sport, p.market
  order by count(*) desc
  limit greatest(1, least(1000, p_limit));
$$;

comment on function public.op_closing_coverage_queue is
  'Absent closes grouped by reason, sport and market, worst first, with one example publication and its stated reason. The unit of work for improving coverage is a (reason, market) pair, not an individual claim.';

revoke all on function public.op_closing_coverage_queue(timestamptz, integer) from public, anon, authenticated;
