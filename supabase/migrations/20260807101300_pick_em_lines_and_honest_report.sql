-- Two follow-ups the label backfill surfaced.
--
-- First: 44 spread quotes remained null because a pick-em line is written
-- unsigned — "Atlanta Hawks 0" — and the signed regex skipped it. The match is
-- a final token of exactly 0 after whitespace, which a team name ending in a
-- digit cannot satisfy ("Schalke 04" ends 4-after-0, not 0-after-space).
--
-- Second: op_odds_line_recoverability counted every null-line row as
-- unrecoverable, including match_winner, BTTS, double chance and draw no bet —
-- markets that carry no line at all. 1.9 million rows of non-problem drowning
-- the 44 real ones. A report that counts non-problems is a report nobody
-- reads, so it now excludes markets whose canonical definition requires no
-- line, and says so in its comment.

update public.op_odds_snapshots
set line = 0
where line is null
  and market in ('spread', 'set_handicap')
  and metadata ->> 'label' ~ '\s0\s*$';

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
  -- Only markets that need a line. The registry's lineRequired markets, by
  -- their legacy spellings; a lineless match_winner row is correct, not a gap.
  where o.market in ('spread', 'set_handicap', 'total_points', 'total_games',
                     'total_goals', 'totals', 'over_under', 'asian_handicap')
     or o.market ~ '^over_under_[0-9]+$'
  group by o.sport, o.market
  having count(*) - count(o.line) > 0
  order by (count(*) - count(o.line)) desc;
$$;

comment on function public.op_odds_line_recoverability is
  'Quotes on line-carrying markets whose line is still null. Markets that carry no line are excluded — a lineless match_winner row is correct, and counting it buried the real gaps under 1.9 million rows of non-problem.';

revoke all on function public.op_odds_line_recoverability() from public, anon, authenticated;
