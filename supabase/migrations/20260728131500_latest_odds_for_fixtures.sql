-- Public slate reads only ever use the newest snapshot per
-- (fixture, market, selection), but they fetched every snapshot ordered by
-- capture time and de-duplicated in JavaScript. For a single day that is ~93k
-- rows transferred to use ~660, and the 10k row cap silently truncated by
-- capture time — so fixtures whose odds were captured earlier in the day came
-- back with no odds at all and could never produce a value pick.
--
-- Doing the de-duplication here returns exactly the rows the caller needs. The
-- ordering matches op_odds_snapshots_fixture_captured_idx
-- (fixture_id, market, selection, captured_at desc), so DISTINCT ON is served
-- straight from that index with no sort and no on-disk merge.
create or replace function public.op_latest_odds_for_fixtures(p_fixture_ids uuid[])
returns table (
  id uuid,
  fixture_id uuid,
  fixture_external_id text,
  provider text,
  bookmaker text,
  market text,
  selection text,
  decimal_odds numeric,
  observed_at timestamptz,
  captured_at timestamptz,
  source text,
  is_live boolean,
  expires_at timestamptz,
  metadata jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (s.fixture_id, s.market, s.selection)
    s.id,
    s.fixture_id,
    s.fixture_external_id,
    s.provider,
    s.bookmaker,
    s.market,
    s.selection,
    s.decimal_odds,
    s.observed_at,
    s.captured_at,
    s.source,
    s.is_live,
    s.expires_at,
    s.metadata
  from public.op_odds_snapshots s
  where s.fixture_id = any(p_fixture_ids)
  order by s.fixture_id, s.market, s.selection, s.captured_at desc
$$;

revoke all on function public.op_latest_odds_for_fixtures(uuid[]) from public;
grant execute on function public.op_latest_odds_for_fixtures(uuid[]) to service_role;
