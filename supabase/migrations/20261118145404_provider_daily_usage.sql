create table public.op_provider_daily_usage (
  provider text not null,
  usage_day date not null,
  reserved_units integer not null check (reserved_units >= 0),
  primary key (provider, usage_day)
);
alter table public.op_provider_daily_usage enable row level security;
revoke all on public.op_provider_daily_usage from public, anon, authenticated;
grant select, insert, update on public.op_provider_daily_usage to service_role;

create function public.op_reserve_provider_units(p_provider text, p_units integer, p_limit integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_provider is null or p_provider not in ('the-odds-api', 'api-football')
     or p_units is null or p_units < 1 or p_limit is null or p_limit < p_units then
    return false;
  end if;
  insert into public.op_provider_daily_usage as u(provider, usage_day, reserved_units)
  values (p_provider, (now() at time zone 'UTC')::date, p_units)
  on conflict (provider, usage_day) do update
    set reserved_units = u.reserved_units + excluded.reserved_units
    where u.reserved_units <= p_limit - excluded.reserved_units;
  return found;
end;
$$;
revoke all on function public.op_reserve_provider_units(text,integer,integer) from public, anon, authenticated;
grant execute on function public.op_reserve_provider_units(text,integer,integer) to service_role;
