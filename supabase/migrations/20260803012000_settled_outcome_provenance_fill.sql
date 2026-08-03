-- Settled outcomes stay immutable. Provenance may still be filled once.
--
-- `op_prevent_settled_outcome_rewrite` banned every update to a settled row.
-- The property worth protecting is that the *outcome* cannot change — the
-- result, the probability it was judged against, the price, the settlement
-- time. Recording which model produced it changes none of those; it is the
-- missing label on evidence already collected.
--
-- The blanket rule was blocking the attribution backfill that calibration
-- needs, while protecting nothing the narrower rule does not. So the guard now
-- names the fields that constitute the outcome and refuses changes to those,
-- and permits `model_key` / `engine_version` to be set exactly once, only from
-- null. Overwriting an existing attribution stays forbidden: re-labelling
-- which model earned a result is precisely the kind of quiet edit that makes a
-- track record worthless.

create or replace function public.op_prevent_settled_outcome_rewrite()
returns trigger
language plpgsql
as $$
begin
  if old.result = 'pending' then
    return new;
  end if;

  -- The outcome itself, and the terms it was judged on.
  if new.result is distinct from old.result
     or new.model_probability is distinct from old.model_probability
     or new.implied_probability is distinct from old.implied_probability
     or new.value_edge is distinct from old.value_edge
     or new.odds is distinct from old.odds
     or new.closing_odds is distinct from old.closing_odds
     or new.settled_at is distinct from old.settled_at
     or new.fixture_external_id is distinct from old.fixture_external_id
     or new.sport is distinct from old.sport
     or new.market is distinct from old.market
     or new.selection is distinct from old.selection
  then
    raise exception 'Settled prediction outcomes are immutable; create a reviewed correction record instead.';
  end if;

  -- Provenance fills one way only.
  if old.model_key is not null and new.model_key is distinct from old.model_key then
    raise exception 'A settled outcome cannot be re-attributed to a different model.';
  end if;
  if old.engine_version is not null and new.engine_version is distinct from old.engine_version then
    raise exception 'A settled outcome cannot be re-attributed to a different engine version.';
  end if;

  return new;
end;
$$;

comment on function public.op_prevent_settled_outcome_rewrite() is
  'Settled outcomes are immutable in result, probability, price and timing. Null model_key/engine_version may be filled once so historical evidence becomes attributable to the model that produced it.';
