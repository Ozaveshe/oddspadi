-- Recover the line for spread, totals and set-handicap quotes from the label.
--
-- The first backfill (20260807100100) recovered lines only where the market
-- name encoded them (over_under_25 → 2.5) and declared spread, total_points,
-- set_handicap and total_games unrecoverable. That declaration was wrong, and
-- wrong in an instructive way: it was made from the column names without
-- reading the data. The write path has always stored the presentation label in
-- metadata — "Toronto Raptors -2.5", "Over 189.5" — and the trailing number IS
-- the line, generated per selection row by the same code that priced it.
--
-- Verified against production before writing this: every distinct spread label
-- ends in a signed line, every totals label in an unsigned one.
--
-- Still never guessed: rows whose label carries no trailing number stay null
-- and remain visible in op_odds_line_recoverability(). The regex is anchored to
-- the end so a team name containing a digit ("1. FC Köln") cannot donate one.

update public.op_odds_snapshots
set line = (substring(metadata ->> 'label' from '([+-][0-9]+(?:\.[0-9]+)?)\s*$'))::numeric
where line is null
  and market in ('spread', 'set_handicap')
  and metadata ->> 'label' ~ '[+-][0-9]+(\.[0-9]+)?\s*$';

update public.op_odds_snapshots
set line = (substring(metadata ->> 'label' from '([0-9]+(?:\.[0-9]+)?)\s*$'))::numeric
where line is null
  and market in ('total_points', 'total_games')
  and metadata ->> 'label' ~ '(Over|Under)\s+[0-9]+(\.[0-9]+)?\s*$';
