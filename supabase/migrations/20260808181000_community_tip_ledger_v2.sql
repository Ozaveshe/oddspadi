-- Community tip ledger v2: a trackable selection carries user, fixture, market,
-- selection, line, odds, odds source, timestamps, scheduled start and the
-- canonical market version. Posted values are immutable for everyone; the
-- author may edit commentary (rationale) and may delete (one-way tombstone,
-- which never removes a validly posted, settled result from accountable
-- statistics).

alter table public.op_community_tips add column if not exists market_line numeric(6,2);
alter table public.op_community_tips
  add constraint op_community_tips_market_line_step
  check (market_line is null or (abs(market_line) <= 200 and (market_line * 4) = round(market_line * 4)));

alter table public.op_community_tips add column if not exists odds_source text not null default 'user-entered';
alter table public.op_community_tips
  add constraint op_community_tips_odds_source_length
  check (char_length(odds_source) between 1 and 120);

alter table public.op_community_tips add column if not exists canonical_selection_key text;
alter table public.op_community_tips
  add constraint op_community_tips_canonical_key_length
  check (canonical_selection_key is null or char_length(canonical_selection_key) between 3 and 160);

alter table public.op_community_tips add column if not exists market_version text;
alter table public.op_community_tips
  add constraint op_community_tips_market_version_length
  check (market_version is null or char_length(market_version) between 1 and 40);

alter table public.op_community_tips add column if not exists deleted_at timestamptz;
alter table public.op_community_tips add column if not exists rationale_updated_at timestamptz;
alter table public.op_community_tips add column if not exists moderated_at timestamptz;
alter table public.op_community_tips add column if not exists moderated_reason text;
alter table public.op_community_tips
  add constraint op_community_tips_moderated_reason_length
  check (moderated_reason is null or char_length(moderated_reason) between 1 and 500);

-- Authors may write the new tracked columns at insert time only.
grant insert (market_line, odds_source, canonical_selection_key, market_version)
  on public.op_community_tips to authenticated;

-- Edit boundary: commentary and one-way deletion only.
grant update (rationale, deleted_at) on public.op_community_tips to authenticated;

create policy "Tipsters may edit commentary or delete their tip"
  on public.op_community_tips for update
  to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

-- Freeze trigger: tracked values are immutable for every role (including the
-- service role), deletion is one-way, commentary edits stamp
-- rationale_updated_at. Moderation columns stay writable for the service role.
create or replace function public.op_guard_community_tip_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.author_id is distinct from old.author_id
    or new.fixture_db_id is distinct from old.fixture_db_id
    or new.fixture_id is distinct from old.fixture_id
    or new.sport is distinct from old.sport
    or new.home_team is distinct from old.home_team
    or new.away_team is distinct from old.away_team
    or new.kickoff_at is distinct from old.kickoff_at
    or new.market is distinct from old.market
    or new.selection is distinct from old.selection
    or new.selection_label is distinct from old.selection_label
    or new.tipped_odds is distinct from old.tipped_odds
    or new.stake_units is distinct from old.stake_units
    or new.market_line is distinct from old.market_line
    or new.odds_source is distinct from old.odds_source
    or new.canonical_selection_key is distinct from old.canonical_selection_key
    or new.market_version is distinct from old.market_version
    or new.published_at is distinct from old.published_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Tracked community tip values are immutable' using errcode = '42501';
  end if;
  if old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at then
    raise exception 'A deleted community tip cannot be restored' using errcode = '42501';
  end if;
  if new.rationale is distinct from old.rationale then
    new.rationale_updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.op_guard_community_tip_update() from public, anon, authenticated;

drop trigger if exists op_community_tips_guard_update on public.op_community_tips;
create trigger op_community_tips_guard_update
  before update on public.op_community_tips
  for each row execute function public.op_guard_community_tip_update();

comment on column public.op_community_tips.deleted_at is
  'Tombstone: hides the tip from normal display but never removes a validly posted result from accountable statistics.';
comment on column public.op_community_tips.canonical_selection_key is
  'Canonical market registry key resolved at publish time via the same bridge the Bet Workspace uses; null when the market has no canonical mapping.';
comment on column public.op_community_tips.market_version is
  'Version of the canonical market registry the selection key was resolved against.';
comment on column public.op_community_tips.odds_source is
  'Where the tipped odds came from as declared at publish time (bookmaker via the match odds board, or user-entered).';
