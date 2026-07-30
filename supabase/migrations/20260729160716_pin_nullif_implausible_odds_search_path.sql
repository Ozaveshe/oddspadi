-- Pin the plausibility guard's search_path.
--
-- The Supabase security linter flagged it as role-mutable
-- (0011_function_search_path_mutable). It touches no tables, so the empty
-- search_path is safe, and the two SECURITY DEFINER functions added alongside it
-- already set theirs.

create or replace function public.nullif_implausible_odds(p_odds numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_odds is null or p_odds <= 1 or p_odds > 100 then null else p_odds end;
$$;

revoke all on function public.nullif_implausible_odds(numeric) from public, anon, authenticated;
