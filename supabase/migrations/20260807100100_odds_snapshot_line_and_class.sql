-- The line dimension the odds pipeline has never had.
--
-- op_odds_snapshots stores market text, selection text and no line. The line
-- lived inside the market name where the name happened to encode it
-- (over_under_25) and nowhere at all where it did not (spread, set_handicap,
-- total_games). So a basketball spread quote never recorded the number it was
-- against, and an Asian handicap of -0.25 had nowhere to be stored.
--
-- One migration on the largest table, designed once for three things that need
-- it: closing-price capture must match a claim's line, the market ontology
-- carries line as a canonical dimension, and the historical-odds layer needs a
-- snapshot class.
--
-- Source depth is deliberately NOT a column here. A snapshot row is one book's
-- quote, so a depth column on it would be a denormalised count of its siblings,
-- wrong the moment another book reports. Depth is computed by the read layer,
-- and the depth that mattered at a capture is stored on op_closing_prices where
-- it is a fact about a decision rather than about a row.

alter table public.op_odds_snapshots
  add column if not exists line numeric,
  add column if not exists snapshot_class text,
  add column if not exists outlier_state text not null default 'normal';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'op_odds_snapshots_snapshot_class_check') then
    alter table public.op_odds_snapshots
      add constraint op_odds_snapshots_snapshot_class_check
      check (snapshot_class is null or snapshot_class in ('opening', 'intermediate', 'decision_time', 'closing'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'op_odds_snapshots_outlier_state_check') then
    alter table public.op_odds_snapshots
      add constraint op_odds_snapshots_outlier_state_check
      check (outlier_state in ('normal', 'suspect_overround', 'suspect_price', 'excluded'));
  end if;
end
$$;

comment on column public.op_odds_snapshots.line is
  'Handicap or total the quote was against. Null where the canonical market requires no line. Backfilled from the legacy market name only where that name encodes it; never guessed.';
comment on column public.op_odds_snapshots.snapshot_class is
  'When in the fixture''s life this quote was taken. Null means unclassified history.';
comment on column public.op_odds_snapshots.outlier_state is
  'Whether this quote survived sanity checks. excluded rows are held for evidence and never enter a consensus.';

-- Step 1 of 3: preserve what is_closing already knows.
--
-- The corpus importers set is_closing directly and are the only source of
-- closing quotes before 2026-05-24. Converting is_closing to a generated column
-- before this backfill would drop every one of those flags on the floor, so the
-- order here is load-bearing and not stylistic.
update public.op_odds_snapshots
set snapshot_class = 'closing'
where is_closing = true and snapshot_class is null;

-- Backfill the line from the legacy market/selection naming, and only from it.
--
-- over_under_25 encodes the 2.5 line; over_under_505 encodes 50.5. The trailing
-- digits are the line with an implied decimal before the last digit, which is
-- the convention the decision engine already uses. Markets that never carried a
-- line in their name (spread, set_handicap, total_games) are left null and
-- reported, because a guessed line settles a claim against a number nobody
-- quoted.
update public.op_odds_snapshots
set line = case
    when length(substring(market from 'over_under_([0-9]+)$')) >= 2
      then (
        substring(substring(market from 'over_under_([0-9]+)$') from 1 for length(substring(market from 'over_under_([0-9]+)$')) - 1)
        || '.' ||
        right(substring(market from 'over_under_([0-9]+)$'), 1)
      )::numeric
    else substring(market from 'over_under_([0-9]+)$')::numeric
  end
where line is null
  and market ~ 'over_under_[0-9]+$';

update public.op_odds_snapshots
set line = case
    when length(substring(selection from '^(?:over|under)_([0-9]+)$')) >= 2
      then (
        substring(substring(selection from '^(?:over|under)_([0-9]+)$') from 1 for length(substring(selection from '^(?:over|under)_([0-9]+)$')) - 1)
        || '.' ||
        right(substring(selection from '^(?:over|under)_([0-9]+)$'), 1)
      )::numeric
    else substring(selection from '^(?:over|under)_([0-9]+)$')::numeric
  end
where line is null
  and selection ~ '^(?:over|under)_[0-9]+$';

-- Shaped for the closing-capture read, which filters a set of fixture_ids over
-- an observed_at range and discards live quotes. Keyed on fixture_id rather
-- than fixture_external_id because that is the column the capture joins on —
-- two write paths populate the text one, and an index the query cannot use is
-- dead weight on a 1.9-million-row table.
create index if not exists op_odds_snapshots_closing_capture_idx
  on public.op_odds_snapshots (fixture_id, observed_at desc)
  where is_live = false;

create index if not exists op_odds_snapshots_class_idx
  on public.op_odds_snapshots (fixture_id, market, selection, snapshot_class)
  where snapshot_class is not null;

-- Report, rather than repair, what could not be recovered.
create or replace function public.op_odds_line_recoverability()
returns table (sport text, market text, quotes bigint, line_recovered bigint, line_unrecoverable bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.sport::text,
    o.market::text,
    count(*)::bigint,
    count(o.line)::bigint,
    (count(*) - count(o.line))::bigint
  from public.op_odds_snapshots o
  group by o.sport, o.market
  having count(*) - count(o.line) > 0
  order by (count(*) - count(o.line)) desc;
$$;

comment on function public.op_odds_line_recoverability is
  'Quotes whose line could not be recovered from the legacy market or selection name, by sport and market. These are reported and left null, never guessed.';

revoke all on function public.op_odds_line_recoverability() from public, anon, authenticated;
