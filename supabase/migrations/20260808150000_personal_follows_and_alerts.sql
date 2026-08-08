-- My Padi personal layer: generic follows and alert preferences.
-- Apply only to OddsPadi project wncwtzqipnoqwmqlznqn.
--
-- op_followed_teams stays the canonical store for team follows (uuid rows
-- against the catalogue). op_follows carries everything the catalogue does
-- not key: sports, competitions, players — and it is deliberately a keyed
-- text store, because "Premier League" is an entity the product recognises
-- by name, not by uuid, everywhere fixtures are read today.
--
-- op_alert_preferences is one row per user. Absence of a row means the
-- defaults: alerts off until the user turns something on — consent is an
-- action, not a default.

create table if not exists public.op_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.op_profiles(id) on delete cascade,
  entity_type text not null check (entity_type in ('sport', 'competition', 'player')),
  -- Normalised (lowercased, trimmed) key used for matching; display keeps
  -- the user's spelling.
  entity_key text not null check (char_length(entity_key) between 1 and 120),
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (user_id, entity_type, entity_key)
);

create index if not exists op_follows_user_idx on public.op_follows (user_id, entity_type, created_at desc);

alter table public.op_follows enable row level security;

drop policy if exists op_follows_owner_select on public.op_follows;
create policy op_follows_owner_select on public.op_follows
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists op_follows_owner_insert on public.op_follows;
create policy op_follows_owner_insert on public.op_follows
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists op_follows_owner_delete on public.op_follows;
create policy op_follows_owner_delete on public.op_follows
  for delete to authenticated using (auth.uid() = user_id);

revoke all on public.op_follows from public, anon;
grant select, insert, delete on public.op_follows to authenticated;
grant select, insert, update, delete on public.op_follows to service_role;

comment on table public.op_follows is
  'Private follows beyond the team catalogue: sports, competitions, players. Owner-only via RLS; keys are normalised text because that is how the product identifies these entities.';

-- Follow-count cap, enforced where a loop cannot bypass it.
create or replace function public.op_guard_follow_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.op_follows where user_id = new.user_id and entity_type = new.entity_type) >= 50 then
    raise exception 'Follow limit reached for this type; unfollow something first.';
  end if;
  return new;
end;
$$;

drop trigger if exists op_follows_guard_insert on public.op_follows;
create trigger op_follows_guard_insert
before insert on public.op_follows
for each row execute function public.op_guard_follow_insert();

create table if not exists public.op_alert_preferences (
  user_id uuid primary key references public.op_profiles(id) on delete cascade,
  -- Channels the user has consented to. Push additionally requires a live
  -- subscription row; a channel listed here without one delivers nothing.
  channels jsonb not null default '[]'::jsonb check (jsonb_typeof(channels) = 'array'),
  -- Alert types the user has switched on, from the closed vocabulary in
  -- src/lib/personal/alertPolicy.ts. Empty means no alerts.
  enabled_types jsonb not null default '[]'::jsonb check (jsonb_typeof(enabled_types) = 'array'),
  -- {"start": "22:00", "end": "07:00"} in the user's own timezone below.
  quiet_hours jsonb check (quiet_hours is null or jsonb_typeof(quiet_hours) = 'object'),
  timezone text not null default 'Africa/Lagos' check (char_length(timezone) between 1 and 64),
  -- Per-sport and per-competition opt-outs: {"basketball": false, ...}.
  sport_settings jsonb not null default '{}'::jsonb check (jsonb_typeof(sport_settings) = 'object'),
  competition_settings jsonb not null default '{}'::jsonb check (jsonb_typeof(competition_settings) = 'object'),
  -- Hard ceiling on deliveries per day, across all types.
  max_alerts_per_day integer not null default 10 check (max_alerts_per_day between 1 and 50),
  updated_at timestamptz not null default now()
);

alter table public.op_alert_preferences enable row level security;

drop policy if exists op_alert_preferences_owner_select on public.op_alert_preferences;
create policy op_alert_preferences_owner_select on public.op_alert_preferences
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists op_alert_preferences_owner_insert on public.op_alert_preferences;
create policy op_alert_preferences_owner_insert on public.op_alert_preferences
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists op_alert_preferences_owner_update on public.op_alert_preferences;
create policy op_alert_preferences_owner_update on public.op_alert_preferences
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists op_alert_preferences_owner_delete on public.op_alert_preferences;
create policy op_alert_preferences_owner_delete on public.op_alert_preferences
  for delete to authenticated using (auth.uid() = user_id);

revoke all on public.op_alert_preferences from public, anon;
grant select, insert, update, delete on public.op_alert_preferences to authenticated;
grant select, insert, update, delete on public.op_alert_preferences to service_role;

comment on table public.op_alert_preferences is
  'Per-user alert consent and controls. No row = no alerts. The push worker reads this through the policy engine before any send.';
