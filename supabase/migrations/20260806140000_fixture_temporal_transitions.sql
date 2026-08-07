-- Stamp the temporal columns from observed transitions, in the database.
--
-- These four columns are only worth anything if they record what we actually
-- saw, once. Doing that in the application would be wrong twice over: the
-- ingest path upserts, so it would overwrite the first observation on every
-- sync, and it is not the only writer — backfill scripts, the results refresh
-- and manual repair all touch this table. A trigger is the one place every
-- write must pass through.
--
-- The rule is deliberately conservative. A row that arrives already finished
-- gets NO timestamps: we did not observe that match start, and we did not
-- observe its result land, so recording `now()` would be recording our import
-- time as though it were match evidence. Historical backfills therefore leave
-- these null, which is correct — `fixtureLifecycle` already reads a finished
-- status backed by a real score, and does not need a fabricated instant.
--
-- Only transitions count:
--   started_at   first time we see the match in play
--   resulted_at  first time we see a final score arrive on a match that was
--                not already final
--   provider_updated_at  only when the provider's own facts changed; a sync
--                that returns identical data advances last_synced_at and must
--                leave this alone, which is the whole distinction between them

create or replace function public.op_fixture_temporal_transitions()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  scored boolean := new.home_score is not null and new.away_score is not null;
begin
  if tg_op = 'INSERT' then
    new.provider_kickoff_at := coalesce(new.provider_kickoff_at, new.kickoff_at);
    -- Only an in-play arrival is an observed start. Anything else is an
    -- import, and an import is not an observation.
    if new.started_at is null and new.status = 'live' then
      new.started_at := now();
    end if;
    return new;
  end if;

  -- Never let a later write erase an earlier observation. An upsert that omits
  -- these columns leaves them alone, but an explicit null must not win.
  new.started_at  := coalesce(new.started_at,  old.started_at);
  new.resulted_at := coalesce(new.resulted_at, old.resulted_at);

  -- A reschedule is the one fixture change that silently invalidates
  -- everything downstream, so it is recorded rather than just applied.
  if new.kickoff_at is distinct from old.kickoff_at then
    new.provider_kickoff_at := new.kickoff_at;
    new.provider_updated_at := now();
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'rescheduledFrom', old.kickoff_at,
      'rescheduledAt', now()
    );
  elsif new.status      is distinct from old.status
     or new.home_score  is distinct from old.home_score
     or new.away_score  is distinct from old.away_score then
    new.provider_updated_at := now();
  end if;

  if new.started_at is null and new.status = 'live' then
    new.started_at := now();
  end if;

  -- A result is "first final score observed". Requiring the previous row to
  -- have been unfinished is what makes it a transition rather than a re-read.
  if new.resulted_at is null and scored and new.status = 'finished' and old.status is distinct from 'finished' then
    new.resulted_at := now();
  end if;

  return new;
end;
$$;

comment on function public.op_fixture_temporal_transitions is
  'Set-once stamping of started_at/resulted_at/provider_updated_at from observed transitions. Imports that arrive already-finished are deliberately left unstamped.';

drop trigger if exists op_fixtures_temporal_transitions on public.op_fixtures;
create trigger op_fixtures_temporal_transitions
  before insert or update on public.op_fixtures
  for each row execute function public.op_fixture_temporal_transitions();
