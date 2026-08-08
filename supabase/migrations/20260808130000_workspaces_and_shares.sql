-- Bet Workspace persistence: private account sync and read-only shares.
-- Apply only to OddsPadi project wncwtzqipnoqwmqlznqn.
--
-- Two tables with two very different trust models:
--
-- * op_workspaces is the signed-in user's private copy of their workspaces.
--   RLS makes each row invisible to everyone but its owner — there is no
--   admin view, no public listing, no cross-user query path. Deleting the
--   account deletes the rows.
--
-- * op_workspace_shares holds frozen, sanitised copies for read-only share
--   links. Rows are reachable only through the service role behind a route
--   that verifies an HMAC-signed, expiring token — the table itself grants
--   nothing to browsers. A share stores NO account information: the payload
--   is sanitised before insert and the owner id exists only so revocation
--   and account deletion work.
--
-- Neither table touches op_publications. A workspace leg is a user's own
-- selection; the official ledger has exactly one writer and this is not it.

create table if not exists public.op_workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, workspace_id)
);

create index if not exists op_workspaces_user_idx on public.op_workspaces (user_id, updated_at desc);

-- A per-user cap, enforced where it cannot be bypassed. 50 leaves headroom
-- over the client's own limit of 20 without letting a loop fill the table.
create or replace function public.op_guard_workspace_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.op_workspaces where user_id = new.user_id) >= 50 then
    raise exception 'Workspace limit reached; archive or delete an existing workspace first.';
  end if;
  return new;
end;
$$;

drop trigger if exists op_workspaces_guard_insert on public.op_workspaces;
create trigger op_workspaces_guard_insert
before insert on public.op_workspaces
for each row execute function public.op_guard_workspace_insert();

alter table public.op_workspaces enable row level security;

drop policy if exists op_workspaces_owner_select on public.op_workspaces;
create policy op_workspaces_owner_select on public.op_workspaces
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists op_workspaces_owner_insert on public.op_workspaces;
create policy op_workspaces_owner_insert on public.op_workspaces
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists op_workspaces_owner_update on public.op_workspaces;
create policy op_workspaces_owner_update on public.op_workspaces
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists op_workspaces_owner_delete on public.op_workspaces;
create policy op_workspaces_owner_delete on public.op_workspaces
  for delete to authenticated using (auth.uid() = user_id);

revoke all on public.op_workspaces from public, anon;
grant select, insert, update, delete on public.op_workspaces to authenticated;
grant select, insert, update, delete on public.op_workspaces to service_role;

comment on table public.op_workspaces is
  'Private per-user Bet Workspace sync. RLS: owner only. Never public, never indexed, never part of the official ledger.';

create table if not exists public.op_workspace_shares (
  id uuid primary key default gen_random_uuid(),
  share_id text not null unique,
  owner_user_id uuid references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at),
  -- Shares are short-lived by design; nothing lives longer than 90 days.
  check (expires_at <= created_at + interval '90 days')
);

create index if not exists op_workspace_shares_expiry_idx on public.op_workspace_shares (expires_at);
create index if not exists op_workspace_shares_owner_idx on public.op_workspace_shares (owner_user_id) where owner_user_id is not null;

alter table public.op_workspace_shares enable row level security;

-- No browser role touches this table. Reads go through the share route,
-- which verifies the signed token before using the service role.
revoke all on public.op_workspace_shares from public, anon, authenticated;
grant select, insert, update, delete on public.op_workspace_shares to service_role;

comment on table public.op_workspace_shares is
  'Frozen, sanitised workspace copies behind HMAC-signed expiring share links. Service-role only; revocation is an update, expiry is a check at read time.';

-- Extend the authenticated-write rate-limit policy with workspace sync.
-- The policy list is inline in the function, so extending it means
-- redefining the function with the new row; everything else is unchanged
-- from 20260718065856.
create or replace function public.op_consume_user_rate_limit(p_action text)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer;
  v_window_seconds integer;
  v_window_started_at timestamptz;
  v_count integer;
  v_retry_after integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select policy.request_limit, policy.window_seconds
  into v_limit, v_window_seconds
  from (values
    ('profile_update'::text, 10, 3600),
    ('follow_team'::text, 60, 3600),
    ('push_subscription'::text, 10, 3600),
    ('community_post'::text, 10, 600),
    ('community_comment'::text, 30, 600),
    ('community_like'::text, 120, 600),
    ('forum_thread'::text, 5, 3600),
    ('forum_reply'::text, 30, 600),
    ('community_poll_vote'::text, 40, 600),
    ('community_tip'::text, 12, 3600),
    ('workspace_sync'::text, 60, 3600)
  ) as policy(action, request_limit, window_seconds)
  where policy.action = p_action;

  if v_limit is null then
    raise exception 'Unknown rate-limit action.' using errcode = '22023';
  end if;

  v_window_started_at := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / v_window_seconds) * v_window_seconds
  );

  insert into public.op_user_rate_limits as limits (
    user_id, action, window_started_at, request_count, updated_at
  ) values (
    v_user_id, p_action, v_window_started_at, 1, clock_timestamp()
  )
  on conflict (user_id, action, window_started_at)
  do update set request_count = limits.request_count + 1, updated_at = clock_timestamp()
  returning request_count into v_count;

  delete from public.op_user_rate_limits
  where user_id = v_user_id and window_started_at < clock_timestamp() - interval '2 days';

  v_retry_after := greatest(
    1,
    ceil(extract(epoch from (
      v_window_started_at + make_interval(secs => v_window_seconds) - clock_timestamp()
    )))::integer
  );

  return query select v_count <= v_limit, greatest(v_limit - v_count, 0), v_retry_after;
end;
$$;
