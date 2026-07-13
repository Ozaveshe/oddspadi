-- Authenticated team discovery for profile favourites and watchlists.
-- The catalogue is provider-owned; clients receive read-only access.
drop policy if exists "authenticated users can browse teams" on public.op_teams;
create policy "authenticated users can browse teams"
  on public.op_teams for select
  to authenticated
  using (true);

revoke all on table public.op_teams from anon, authenticated;
grant select (id, sport, external_id, name, country, metadata)
  on public.op_teams to authenticated;

create table public.op_followed_teams (
  user_id uuid not null references public.op_profiles (id) on delete cascade,
  team_id uuid not null references public.op_teams (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, team_id)
);

create index op_followed_teams_team_idx
  on public.op_followed_teams (team_id, created_at desc);

alter table public.op_followed_teams enable row level security;

create policy "users read their own followed teams"
  on public.op_followed_teams for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "users follow teams for themselves"
  on public.op_followed_teams for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "users unfollow their own teams"
  on public.op_followed_teams for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.op_followed_teams from public, anon, authenticated;
grant select on table public.op_followed_teams to authenticated;
grant insert (user_id, team_id) on public.op_followed_teams to authenticated;
grant delete on public.op_followed_teams to authenticated;
