-- The same match, stored twice, shown twice.
--
-- The Odds API and API-Sports both create a fixture row for the same real
-- match, under different names. Measured 2026-08-03 over a 21-day window, 84
-- pairs, every one of them involving `the-odds-api-events`:
--
--   "TPS Turku v IFK Mariehamn"      = "Turku PS v Mariehamn"
--   "Jeonbuk Hyundai Motors v Seoul" = "Jeonbuk Motors v FC Seoul"
--   "Union Saint-Gilloise v Bodø"    = "Union St. Gilloise v Bodo/Glimt"
--   "Alina Korneeva v P. Kudermetova"= "A. Korneeva v P. Kudermetova"
--
-- 47 of the 84 disagreed on status, and the disagreement always ran the same
-- way: the API-Sports copy `finished` with a real score, the Odds API copy
-- `abandoned`, because only API-Sports has a results endpoint. So the board
-- showed the match twice and wrote off the copy it could never grade.
--
-- Matching is fuzzy because the names genuinely differ: unaccent, drop club
-- forms and connectives, then require >= 0.62 trigram similarity on *both*
-- sides plus the same sport and kickoffs within three hours. Inspected at the
-- 0.62 floor, every pair was a true duplicate.
--
-- The loser is flagged, not deleted, and only when the winner actually carries
-- odds — 10 of the 84 duplicates held the *only* priced copy, and suppressing
-- those would take prices off the board rather than tidy it. Flagging keeps the
-- row, its odds and its history intact and auditable; the slate read skips it.

create or replace function public.op_flag_duplicate_fixtures(
  p_commit boolean default false,
  p_similarity real default 0.62
)
returns table (sport text, flagged integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  return query
  with tidy as (
    select f.id, f.sport as fixture_sport, f.provider, f.kickoff_at,
           regexp_replace(nullif(trim(regexp_replace(
             regexp_replace(lower(extensions.unaccent(f.home_team_name)), '[^a-z0-9 ]', ' ', 'g'),
             '\y(fc|cf|sc|afc|ssc|cd|ac|de|do|da|del|the)\y', ' ', 'g')), ''), '\s+', ' ', 'g') as home_key,
           regexp_replace(nullif(trim(regexp_replace(
             regexp_replace(lower(extensions.unaccent(f.away_team_name)), '[^a-z0-9 ]', ' ', 'g'),
             '\y(fc|cf|sc|afc|ssc|cd|ac|de|do|da|del|the)\y', ' ', 'g')), ''), '\s+', ' ', 'g') as away_key
    from public.op_fixtures f
    where f.kickoff_at > v_now - interval '7 days'
      and f.kickoff_at < v_now + interval '21 days'
      and f.metadata->>'duplicateOf' is null
  ),
  pairs as (
    select
      case when a.provider like 'the-odds-api%' then a.id else b.id end as dup_id,
      case when a.provider like 'the-odds-api%' then b.id else a.id end as keep_id,
      case when a.provider like 'the-odds-api%' then b.fixture_sport else a.fixture_sport end as pair_sport
    from tidy a
    join tidy b
      on b.fixture_sport = a.fixture_sport
     and b.id > a.id
     and abs(extract(epoch from (b.kickoff_at - a.kickoff_at))) <= 10800
     and a.provider <> b.provider
     -- Exactly one side is the Odds API copy, so there is always a clear loser.
     and (a.provider like 'the-odds-api%') <> (b.provider like 'the-odds-api%')
     and extensions.similarity(a.home_key, b.home_key) >= p_similarity
     and extensions.similarity(a.away_key, b.away_key) >= p_similarity
    where a.home_key is not null and a.away_key is not null
  ),
  -- Never hide the only priced copy of a match.
  suppressible as (
    select distinct p.dup_id, p.keep_id, p.pair_sport
    from pairs p
    where exists (select 1 from public.op_current_odds o where o.fixture_id = p.keep_id)
  ),
  updated as (
    update public.op_fixtures t
       set metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
             'duplicateOf', s.keep_id,
             'duplicateFlaggedAt', to_jsonb(v_now),
             'duplicateReason', 'same-match-under-another-provider'
           ),
           updated_at = v_now
      from suppressible s
     where t.id = s.dup_id
       and p_commit
    returning t.id
  )
  select s.pair_sport, count(*)::integer
  from suppressible s
  group by s.pair_sport
  order by count(*) desc;
end;
$$;

comment on function public.op_flag_duplicate_fixtures is
  'Flags the-odds-api fixture rows that duplicate an API-Sports row for the same match, so the slate shows each match once. Fuzzy name match (unaccent + trigram >= 0.62 on both teams, same sport, kickoff within 3h). Never flags a duplicate whose canonical twin has no odds. Dry run unless p_commit.';

revoke all on function public.op_flag_duplicate_fixtures(boolean, real) from public, anon, authenticated;
