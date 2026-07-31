-- Close the path that put paper-mode trades on the public record.
--
-- `op_public_prediction_outcomes` is anon-readable and reads as OddsPadi's
-- public track record. Its sync trigger used a *denylist* — it excluded
-- `market-decision-backfill` and admitted everything else — so the default for
-- any new source was "publish". Two sources took that default:
--
--   autonomous-shadow  143 rows  paper-mode candidate runs
--   local-smoke          1 row   a developer smoke test
--
-- 144 rows, none of them a published pick, sitting in the table the weekly
-- recap counts. Meanwhile `op_public_picks` — the intended official table —
-- has never held a row. That is the whole "zero settled picks here, several
-- graded picks there" contradiction in one sentence.
--
-- This migration does three things and deletes no evidence:
--   1. labels every existing public-mirror row with its true record class;
--   2. flips the trigger to an allowlist, so a new source is withheld by
--      default and publishing it is a deliberate act;
--   3. invalidates the derived weekly recaps computed from those rows.
--
-- The rows themselves stay: they are honest shadow evidence and remain in
-- `op_prediction_outcomes`. What changes is that no public surface may count
-- them, because they now carry a class that the read contract rejects.

alter table public.op_public_prediction_outcomes
  add column if not exists record_class text not null default 'shadow_decision';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'op_public_prediction_outcomes_record_class_check'
  ) then
    alter table public.op_public_prediction_outcomes
      add constraint op_public_prediction_outcomes_record_class_check
      check (record_class in (
        'model_probability', 'internal_decision', 'watch_observation', 'editorial_observation',
        'official_public_pick', 'community_selection', 'simulation', 'backtest_record', 'shadow_decision'
      ));
  end if;
end $$;

-- Classify what is already there by what it actually is.
update public.op_public_prediction_outcomes
set record_class = case
  when record_source = 'autonomous-shadow' then 'shadow_decision'
  when record_source = 'local-smoke' then 'simulation'
  when record_source = 'market-decision-backfill' then 'internal_decision'
  else 'internal_decision'
end
where record_class is distinct from case
  when record_source = 'autonomous-shadow' then 'shadow_decision'
  when record_source = 'local-smoke' then 'simulation'
  when record_source = 'market-decision-backfill' then 'internal_decision'
  else 'internal_decision'
end;

comment on column public.op_public_prediction_outcomes.record_class is
  'Canonical record class. Only official_public_pick may be counted by public performance surfaces; everything else is evidence or commentary that happens to be readable.';

-- The allowlist. `op_prediction_outcomes` holds internal evidence and shadow
-- runs — no official publication has ever originated there, and official picks
-- now live in `op_publications`. So the mirror keeps rows readable for
-- transparency but marks every one of them non-official, and there is no
-- source string that can smuggle a row in as a pick.
create or replace function private.sync_public_prediction_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_class text;
begin
  if tg_op = 'DELETE' then
    delete from public.op_public_prediction_outcomes where id = old.id;
    return old;
  end if;

  -- Internal backfill stays out of the mirror entirely: it is a bulk
  -- reconstruction of past decisions, not something that was ever shown.
  if new.source = 'market-decision-backfill' then
    delete from public.op_public_prediction_outcomes where id = new.id;
    return new;
  end if;

  v_class := case
    when new.source = 'autonomous-shadow' then 'shadow_decision'
    when new.source = 'local-smoke' then 'simulation'
    else 'internal_decision'
  end;

  insert into public.op_public_prediction_outcomes (
    id, fixture_external_id, sport, league, country, home_team, away_team,
    kickoff_at, market, selection, recommended_selection, model_probability,
    value_edge, odds, result, engine_action, confidence, paper_only,
    record_source, record_class, created_at, settled_at, updated_at
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
    v_class,
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
    record_class = excluded.record_class,
    created_at = excluded.created_at,
    settled_at = excluded.settled_at,
    updated_at = excluded.updated_at;

  return new;
end;
$function$;

-- The three stored weekly recaps were computed from those shadow rows: a
-- graded count, wins, losses, accuracy and an ROI that no published pick
-- stands behind. They are a derived cache, not evidence, and leaving them
-- would keep a false claim on /news. They are removed rather than corrected
-- because there is no official data from that period to correct them *to* —
-- the honest value is "nothing published yet".
delete from public.op_weekly_prediction_recaps
where graded_count > 0 or wins > 0 or losses > 0;
