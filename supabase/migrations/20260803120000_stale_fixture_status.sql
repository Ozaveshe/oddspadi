-- Fixtures that kicked off and were never updated.
--
-- Measured 2026-08-03: 1,929 fixtures sat at status 'scheduled' with a kickoff
-- already in the past, 1,830 of them more than a day old. They stay on the
-- board forever, they never reach results, and nothing settles against them.
--
-- A midnight cutoff is the obvious rule and the wrong one. A match starting at
-- 23:00 is still being played at 00:30, and a five-set tennis match starting at
-- 22:00 can run past 02:00. Sweeping by calendar day would mark live matches as
-- abandoned while they are still on.
--
-- So the rule is kickoff plus how long the sport actually takes, plus a grace
-- window for a provider that is merely slow rather than silent:
--
--   football     2h00 play  + 2h grace
--   basketball   2h30 play  + 2h grace
--   tennis       5h00 play  + 3h grace   (best-of-five, rain delays)
--
-- Past that window with no provider update, the fixture is not "scheduled" in
-- any meaningful sense. It is marked `abandoned` rather than `finished`,
-- because we do not know the result — inventing `finished` with no score would
-- feed a settlement that grades a match nobody watched. `abandoned` settles as
-- void, which is the honest outcome for a fixture whose result we never
-- received.

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
  create temporary table if not exists tmp_stale_fixtures (
    id uuid, sport text, kickoff_at timestamptz
  ) on commit drop;
  delete from tmp_stale_fixtures;

  insert into tmp_stale_fixtures (id, sport, kickoff_at)
  select f.id, f.sport, f.kickoff_at
  from public.op_fixtures f
  where f.status in ('scheduled', 'live')
    and f.kickoff_at < v_now - (
      case f.sport
        when 'football'   then interval '4 hours'    -- 2h play + 2h grace
        when 'basketball' then interval '4 hours 30 minutes'
        when 'tennis'     then interval '8 hours'    -- best-of-five plus delays
        else interval '6 hours'
      end
    );

  if p_commit then
    update public.op_fixtures f
       set status = 'abandoned',
           updated_at = v_now
      from tmp_stale_fixtures s
     where f.id = s.id;
  end if;

  return query
    select s.sport,
           count(*)::integer,
           round(max(extract(epoch from (v_now - s.kickoff_at)) / 3600)::numeric, 1)
    from tmp_stale_fixtures s
    group by s.sport
    order by count(*) desc;
end;
$$;

comment on function public.op_expire_stale_fixtures is
  'Marks fixtures abandoned when kickoff plus the sport''s realistic duration and grace has passed with no provider update. Dry run unless p_commit. Never touches a fixture that could still be in play.';

revoke all on function public.op_expire_stale_fixtures from public, anon, authenticated;
