-- op_expire_stale_fixtures, rebuilt without the temp table.
--
-- The first version staged rows in a temporary table and cleared it with an
-- unqualified `delete from tmp_stale_fixtures`. That runs fine on a direct
-- connection but PostgREST's role refuses it:
--
--   DELETE requires a WHERE clause
--
-- so the function worked when tested by hand and failed the moment the cron
-- route called it — the difference being which connection ran it. A CTE has no
-- such split: one statement, same behaviour from every caller, and no temp
-- table to leak between calls on a pooled connection.
--
-- Windows are measured from kickoff, per sport, deliberately. A calendar
-- cutoff ("clear yesterday at midnight") would write off a match that started
-- at 23:00 and is still being played at 00:30, and a best-of-five tennis match
-- starting at 22:00 can still be running at 02:00.
--
--   football     2h00 play  + 2h grace  = 4h00
--   basketball   2h30 play  + 2h grace  = 4h30
--   tennis       5h00 play  + 3h grace  = 8h00
--   anything else                       = 6h00
--
-- Marked `abandoned`, never `finished`: we do not know the result. A stale
-- fixture sometimes carries a partial scoreline — production held a WNBA game
-- at 51-56, which is a third-quarter snapshot, not a final. Writing that as
-- `finished` would grade bets against a game that was still in progress.
-- `abandoned` settles as void, which is the honest outcome for a result we
-- never received.

create or replace function public.op_expire_stale_fixtures(
  p_commit boolean default false
)
returns table (sport text, expired integer, oldest_hours numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  return query
  with stale as (
    select f.id, f.sport as fixture_sport, f.kickoff_at
    from public.op_fixtures f
    where f.status in ('scheduled', 'live')
      and f.kickoff_at < v_now - (
        case f.sport
          when 'football'   then interval '4 hours'
          when 'basketball' then interval '4 hours 30 minutes'
          when 'tennis'     then interval '8 hours'
          else interval '6 hours'
        end
      )
  ),
  -- A data-modifying CTE always executes, referenced or not, so the commit
  -- flag has to gate it from the inside rather than by skipping the branch.
  -- `abandoned` is the closest settling status, not a literal claim. In most
  -- of these cases the match did finish and we simply never received the
  -- result: api-basketball's Free tier, measured 2026-08-03, serves only a
  -- three-day date window, so 473 games older than that can never be fetched
  -- on the current plan. Recording the reason keeps "we do not know" separate
  -- from "the match was called off", which are different facts that happen to
  -- settle the same way (void).
  updated as (
    update public.op_fixtures t
       set status = 'abandoned',
           updated_at = v_now,
           metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
             'expiredReason', 'no-provider-result',
             'expiredAt', to_jsonb(v_now),
             'statusBeforeExpiry', to_jsonb(t.status)
           )
      from stale s
     where t.id = s.id
       and p_commit
    returning t.id
  )
  select s.fixture_sport,
         count(*)::integer,
         round(max(extract(epoch from (v_now - s.kickoff_at)) / 3600)::numeric, 1)
  from stale s
  group by s.fixture_sport
  order by count(*) desc;
end;
$$;

comment on function public.op_expire_stale_fixtures is
  'Marks fixtures abandoned when kickoff plus the sport''s realistic duration and grace has passed with no provider update. Dry run unless p_commit. Never touches a fixture that could still be in play.';

revoke all on function public.op_expire_stale_fixtures from public, anon, authenticated;
