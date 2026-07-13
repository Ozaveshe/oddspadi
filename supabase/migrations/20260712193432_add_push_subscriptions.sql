create table public.op_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.op_profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index op_push_subscriptions_user_idx on public.op_push_subscriptions (user_id);
alter table public.op_push_subscriptions enable row level security;
create policy "users read their push subscriptions" on public.op_push_subscriptions for select to authenticated using ((select auth.uid()) = user_id);
create policy "users create their push subscriptions" on public.op_push_subscriptions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "users update their push subscriptions" on public.op_push_subscriptions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users delete their push subscriptions" on public.op_push_subscriptions for delete to authenticated using ((select auth.uid()) = user_id);

create table public.op_push_notification_deliveries (
  subscription_id uuid not null references public.op_push_subscriptions (id) on delete cascade,
  event_key text not null,
  sent_at timestamptz not null default now(),
  primary key (subscription_id, event_key)
);
alter table public.op_push_notification_deliveries enable row level security;

revoke all on public.op_push_subscriptions, public.op_push_notification_deliveries from anon, authenticated;
grant select on public.op_push_subscriptions to authenticated;
grant insert (user_id, endpoint, p256dh, auth, user_agent) on public.op_push_subscriptions to authenticated;
grant update (p256dh, auth, user_agent, updated_at) on public.op_push_subscriptions to authenticated;
grant delete on public.op_push_subscriptions to authenticated;
