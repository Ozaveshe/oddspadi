-- Device-keyed rate limiting for anonymous, service-role-backed endpoints
-- (workspace share create, and the workspace settle/recheck/convert compute
-- routes). Mirrors the authenticated op_consume_user_rate_limit, but keyed on a
-- server-minted httpOnly device cookie rather than auth.uid().

create table if not exists public.op_guest_rate_limits (
  device_key uuid not null,
  action text not null check (action in ('workspace_share', 'workspace_compute')),
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (device_key, action, window_started_at)
);

alter table public.op_guest_rate_limits enable row level security;
revoke all on public.op_guest_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.op_guest_rate_limits to service_role;

create or replace function public.op_consume_guest_rate_limit(p_device_key uuid, p_action text)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer;
  v_window_seconds integer;
  v_window_started_at timestamptz;
  v_count integer;
  v_retry_after integer;
begin
  if p_device_key is null then
    raise exception 'Device key required.' using errcode = '22023';
  end if;

  select policy.request_limit, policy.window_seconds
  into v_limit, v_window_seconds
  from (values
    ('workspace_share'::text, 10, 3600),
    ('workspace_compute'::text, 30, 600)
  ) as policy(action, request_limit, window_seconds)
  where policy.action = p_action;

  if v_limit is null then
    raise exception 'Unknown rate-limit action.' using errcode = '22023';
  end if;

  v_window_started_at := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / v_window_seconds) * v_window_seconds
  );

  insert into public.op_guest_rate_limits as limits (device_key, action, window_started_at, request_count, updated_at)
  values (p_device_key, p_action, v_window_started_at, 1, clock_timestamp())
  on conflict (device_key, action, window_started_at)
  do update set request_count = limits.request_count + 1, updated_at = clock_timestamp()
  returning request_count into v_count;

  delete from public.op_guest_rate_limits
  where device_key = p_device_key and window_started_at < clock_timestamp() - interval '2 days';

  v_retry_after := greatest(
    1,
    ceil(extract(epoch from (v_window_started_at + make_interval(secs => v_window_seconds) - clock_timestamp())))::integer
  );

  return query select v_count <= v_limit, greatest(v_limit - v_count, 0), v_retry_after;
end;
$$;

revoke all on function public.op_consume_guest_rate_limit(uuid, text) from public, anon, authenticated;
grant execute on function public.op_consume_guest_rate_limit(uuid, text) to service_role;

comment on function public.op_consume_guest_rate_limit is
  'Device-keyed rate limit for anonymous service-role endpoints. Service-role only; keyed on the server-minted op_device_key cookie.';
