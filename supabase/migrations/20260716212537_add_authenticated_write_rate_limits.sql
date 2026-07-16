create table public.op_user_rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (action in (
    'profile_update',
    'follow_team',
    'push_subscription',
    'community_post',
    'community_comment',
    'community_like',
    'forum_thread',
    'forum_reply'
  )),
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, action, window_started_at)
);

alter table public.op_user_rate_limits enable row level security;
revoke all on table public.op_user_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.op_user_rate_limits to service_role;

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
    ('forum_reply'::text, 30, 600)
  ) as policy(action, request_limit, window_seconds)
  where policy.action = p_action;

  if v_limit is null then
    raise exception 'Unknown rate-limit action.' using errcode = '22023';
  end if;

  v_window_started_at := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / v_window_seconds) * v_window_seconds
  );

  insert into public.op_user_rate_limits as limits (
    user_id,
    action,
    window_started_at,
    request_count,
    updated_at
  ) values (
    v_user_id,
    p_action,
    v_window_started_at,
    1,
    clock_timestamp()
  )
  on conflict (user_id, action, window_started_at)
  do update set
    request_count = limits.request_count + 1,
    updated_at = clock_timestamp()
  returning request_count into v_count;

  delete from public.op_user_rate_limits
  where user_id = v_user_id
    and window_started_at < clock_timestamp() - interval '2 days';

  v_retry_after := greatest(
    1,
    ceil(extract(epoch from (
      v_window_started_at + make_interval(secs => v_window_seconds) - clock_timestamp()
    )))::integer
  );

  return query select
    v_count <= v_limit,
    greatest(v_limit - v_count, 0),
    v_retry_after;
end;
$$;

revoke all on function public.op_consume_user_rate_limit(text) from public, anon;
grant execute on function public.op_consume_user_rate_limit(text) to authenticated, service_role;

comment on table public.op_user_rate_limits is
  'Private fixed-window counters for authenticated OddsPadi write abuse controls.';
comment on function public.op_consume_user_rate_limit(text) is
  'Consumes one fixed, server-defined authenticated write quota. The caller identity always comes from auth.uid().';
