-- Fill a team's crest from the same club stored under another provider.
--
-- Measured 2026-08-03, crest coverage by provider:
--
--   api-football          1594 / 1594   100%
--   api-basketball         393 /  403    98%
--   api-tennis               0 / 3414     0%   <- players, not clubs
--   the-odds-api-events      0 /  522     0%   <- feed carries no images
--   csv / demo importers     0 /  174     0%
--
-- So the enrichment job is not broken. It works everywhere a crest exists to
-- fetch. The gap is providers that ship no imagery at all — and for 253 of
-- those football rows we already hold the identical club under api-football,
-- crest included. The Odds API calls it "Legia Warszawa" and so does
-- API-Football; there is nothing to fetch, only something to join.
--
-- Tennis is not addressed here and cannot be: api-tennis serves individual
-- players, and a player has no club badge. Those keep the initials fallback,
-- which is the correct answer rather than a missing one.
--
-- Matching is deliberately strict. Punctuation and club-form noise (FC, CF,
-- SC, AFC, SSC, CD, AC) are removed; everything else is kept. In particular
-- W, Women, U19, U21, U23 and II are preserved, because "Chelsea W" and
-- "Chelsea" are different teams and handing the women's side the men's crest
-- would be a false claim rather than a missing one. Keeping them costs 10 of
-- 263 candidate matches, which is the right trade.
--
-- Provenance is recorded on the row: a borrowed crest is marked as borrowed,
-- with the donor it came from.

create or replace function public.op_fill_team_logos_from_siblings(
  p_commit boolean default false
)
returns table (sport text, filled integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  return query
  -- `team_sport` rather than `sport`: the OUT parameter of the same name
  -- shadows the column inside these CTEs and Postgres rejects the reference as
  -- ambiguous.
  with tidy as (
    select t.id, t.sport as team_sport, t.name,
           regexp_replace(
             nullif(trim(regexp_replace(
               regexp_replace(lower(t.name), '[^a-z0-9 ]', ' ', 'g'),
               '\y(fc|cf|sc|afc|ssc|cd|ac)\y', ' ', 'g')), ''),
             '\s+', ' ', 'g') as match_key,
           nullif(t.metadata->>'logo', '') as logo
    from public.op_teams t
  ),
  donors as (
    select distinct on (team_sport, match_key) team_sport, match_key, id as donor_id, name as donor_name, logo
    from tidy
    where logo is not null and match_key is not null
    order by team_sport, match_key, id
  ),
  pairs as (
    select r.id, r.team_sport, d.donor_id, d.donor_name, d.logo
    from tidy r
    join donors d on d.team_sport = r.team_sport and d.match_key = r.match_key
    where r.logo is null and r.match_key is not null and r.id <> d.donor_id
  ),
  updated as (
    update public.op_teams t
       set metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
             'logo', p.logo,
             'logoSource', 'sibling-provider',
             'logoDonorTeamId', p.donor_id,
             'logoDonorName', p.donor_name,
             'logoFilledAt', to_jsonb(v_now)
           ),
           updated_at = v_now
      from pairs p
     where t.id = p.id
       and p_commit
    returning t.id
  )
  select p.team_sport, count(*)::integer
  from pairs p
  group by p.team_sport
  order by count(*) desc;
end;
$$;

comment on function public.op_fill_team_logos_from_siblings is
  'Copies a crest from the same club stored under a different provider. Strict name match that preserves W/Women/U19/U21/U23/II so a womens or youth side never inherits the first-team badge. Records logoSource=sibling-provider and the donor. Dry run unless p_commit.';

revoke all on function public.op_fill_team_logos_from_siblings from public, anon, authenticated;
