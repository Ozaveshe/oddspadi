-- Community moderation: reports, blocks, a service-role moderation audit log,
-- appeals, hide-from-display columns, moderation rate limits, and the
-- eligibility-gated, sample-aware tipster leaderboard.

-- 1) Reports -----------------------------------------------------------------
create table public.op_content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.op_profiles(id) on delete cascade,
  content_type text not null check (content_type in ('feed_post','feed_comment','forum_thread','forum_reply','community_tip','profile')),
  content_id text not null check (char_length(content_id) between 1 and 80),
  category text not null check (category in ('spam','scam_or_paid_tips','guaranteed_win_claim','harassment','impersonation','unsafe_link','other')),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.op_profiles(id) on delete set null,
  unique (reporter_id, content_type, content_id)
);
create index op_content_reports_queue_idx on public.op_content_reports (status, created_at);
alter table public.op_content_reports enable row level security;
create policy "users file their own reports"
  on public.op_content_reports for insert
  to authenticated
  with check (auth.uid() = reporter_id);
create policy "users read their own reports"
  on public.op_content_reports for select
  to authenticated
  using (auth.uid() = reporter_id);
grant select on public.op_content_reports to authenticated;
grant insert (reporter_id, content_type, content_id, category, note) on public.op_content_reports to authenticated;
grant all on public.op_content_reports to service_role;

-- 2) Blocks ------------------------------------------------------------------
create table public.op_user_blocks (
  blocker_id uuid not null references public.op_profiles(id) on delete cascade,
  blocked_id uuid not null references public.op_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index op_user_blocks_blocked_idx on public.op_user_blocks (blocked_id);
alter table public.op_user_blocks enable row level security;
create policy "users read their own blocks"
  on public.op_user_blocks for select to authenticated using (auth.uid() = blocker_id);
create policy "users create their own blocks"
  on public.op_user_blocks for insert to authenticated with check (auth.uid() = blocker_id);
create policy "users remove their own blocks"
  on public.op_user_blocks for delete to authenticated using (auth.uid() = blocker_id);
grant select, delete on public.op_user_blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.op_user_blocks to authenticated;
grant all on public.op_user_blocks to service_role;

-- 3) Moderation audit log (service-role only: RLS on, zero policies) ---------
create table public.op_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.op_profiles(id) on delete restrict,
  action text not null check (action in ('hide','unhide','lock_thread','unlock_thread','moderate_tip','dismiss_report','flag_account','unflag_account','note')),
  content_type text check (content_type is null or content_type in ('feed_post','feed_comment','forum_thread','forum_reply','community_tip','profile')),
  content_id text check (content_id is null or char_length(content_id) between 1 and 80),
  target_user_id uuid references public.op_profiles(id) on delete set null,
  report_id uuid references public.op_content_reports(id) on delete set null,
  reason text not null check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now()
);
create index op_moderation_actions_target_idx on public.op_moderation_actions (target_user_id, created_at desc);
create index op_moderation_actions_content_idx on public.op_moderation_actions (content_type, content_id);
alter table public.op_moderation_actions enable row level security;
grant all on public.op_moderation_actions to service_role;

comment on table public.op_moderation_actions is
  'Append-only moderation audit log. Every moderator action writes exactly one row here. Service-role only; the moderation API verifies is_admin before acting.';

-- 4) Appeals (server-written after target verification; read-own) ------------
create table public.op_moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.op_moderation_actions(id) on delete cascade,
  appellant_id uuid not null references public.op_profiles(id) on delete cascade,
  body text not null check (char_length(body) between 10 and 1000),
  status text not null default 'open' check (status in ('open','upheld','overturned')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  unique (action_id, appellant_id)
);
alter table public.op_moderation_appeals enable row level security;
create policy "users read their own appeals"
  on public.op_moderation_appeals for select to authenticated using (auth.uid() = appellant_id);
grant select on public.op_moderation_appeals to authenticated;
grant all on public.op_moderation_appeals to service_role;

-- 5) Hide-from-display columns ------------------------------------------------
alter table public.op_feed_posts add column if not exists hidden_at timestamptz;
alter table public.op_feed_posts add column if not exists hidden_reason text;
alter table public.op_feed_comments add column if not exists hidden_at timestamptz;
alter table public.op_feed_comments add column if not exists hidden_reason text;
alter table public.op_forum_threads add column if not exists hidden_at timestamptz;
alter table public.op_forum_threads add column if not exists hidden_reason text;
alter table public.op_forum_replies add column if not exists hidden_at timestamptz;
alter table public.op_forum_replies add column if not exists hidden_reason text;

-- Hidden content disappears for everyone except its author (who needs to see
-- it to appeal). hidden_* columns carry no authenticated grants, so only the
-- moderation API (service role) can set them.
drop policy "feed posts are readable by everyone" on public.op_feed_posts;
create policy "feed posts are readable unless hidden"
  on public.op_feed_posts for select
  to anon, authenticated
  using (hidden_at is null or author_id = auth.uid());
drop policy "feed comments are readable by everyone" on public.op_feed_comments;
create policy "feed comments are readable unless hidden"
  on public.op_feed_comments for select
  to anon, authenticated
  using (hidden_at is null or author_id = auth.uid());
drop policy "forum threads are readable by everyone" on public.op_forum_threads;
create policy "forum threads are readable unless hidden"
  on public.op_forum_threads for select
  to anon, authenticated
  using (hidden_at is null or author_id = auth.uid());
drop policy "forum replies are readable by everyone" on public.op_forum_replies;
create policy "forum replies are readable unless hidden"
  on public.op_forum_replies for select
  to anon, authenticated
  using (hidden_at is null or author_id = auth.uid());

-- 6) Rate limits v4 -----------------------------------------------------------
-- The action CHECK is rebuilt with the complete list: v3 (workspaces) extended
-- the function's policy VALUES but forgot this constraint, so workspace_sync
-- writes only worked because the function is the sole writer. Fixed here.
alter table public.op_user_rate_limits drop constraint op_user_rate_limits_action_check;
alter table public.op_user_rate_limits add constraint op_user_rate_limits_action_check check (action in (
  'profile_update', 'follow_team', 'push_subscription', 'community_post', 'community_comment',
  'community_like', 'forum_thread', 'forum_reply', 'community_poll_vote', 'community_tip',
  'workspace_sync', 'community_report', 'community_block', 'community_appeal', 'community_moderation'
));

-- The policy list is inline in the function, so extending it means redefining
-- the function with the new rows; everything else is unchanged from
-- 20260808130000.
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
    ('workspace_sync'::text, 60, 3600),
    ('community_report'::text, 10, 3600),
    ('community_block'::text, 30, 3600),
    ('community_appeal'::text, 5, 86400),
    ('community_moderation'::text, 120, 3600)
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

-- 7) Leaderboard v2 ------------------------------------------------------------
-- Recreated with provenance, integrity and deletion gates. Post-start tips are
-- structurally impossible (30-minute pre-kickoff lock in RLS and trigger), so
-- no gate is needed for them. Ranking stays evidence-adjusted yield (20-unit
-- prior), never raw hit rate.
drop view if exists public.op_public_tipster_leaderboard;
drop view if exists public.op_public_tipster_performance;

create view public.op_public_tipster_performance
with (security_invoker = true) as
select
  t.author_id,
  count(*) as tracked_tips,
  count(*) filter (where t.deleted_at is null and t.moderated_at is null) as published_tips,
  count(*) filter (where t.deleted_at is not null) as deleted_tips,
  count(*) filter (where t.moderated_at is not null) as moderated_tips,
  count(s.tip_id) filter (where s.result <> 'void') as settled_tips,
  count(s.tip_id) filter (where s.result = 'won') as wins,
  count(s.tip_id) filter (where s.result = 'lost') as losses,
  count(s.tip_id) filter (where s.result = 'push') as pushes,
  count(s.tip_id) filter (where s.result = 'void') as voids,
  coalesce(sum(t.stake_units) filter (where s.result in ('won','lost','push')), 0) as staked_units,
  coalesce(sum(s.net_units), 0) as net_units,
  round((avg(t.tipped_odds) filter (where s.result in ('won','lost','push')))::numeric, 2) as average_settled_odds,
  case
    when coalesce(sum(t.stake_units) filter (where s.result in ('won','lost','push')), 0) > 0
    then round(((coalesce(sum(s.net_units), 0) / sum(t.stake_units) filter (where s.result in ('won','lost','push'))) * 100)::numeric, 2)
    else null
  end as yield_percent,
  round(((coalesce(sum(s.net_units), 0) / (coalesce(sum(t.stake_units) filter (where s.result in ('won','lost','push')), 0) + 20)) * 100)::numeric, 2) as evidence_adjusted_yield_percent,
  array_agg(distinct t.sport) as sports_mix,
  array_agg(distinct t.market) as markets_mix,
  max(t.published_at) as latest_tip_at
from public.op_community_tips t
left join public.op_community_tip_settlements s on s.tip_id = t.id
group by t.author_id;

create view public.op_public_tipster_leaderboard
with (security_invoker = true) as
with gated as (
  select
    p.*,
    pr.username,
    pr.display_name,
    pr.account_type,
    (
      p.settled_tips >= 5
      and pr.account_type in ('organic','staff')
      and pr.integrity_flagged_at is null
      and pr.created_at <= now() - interval '7 days'
      and (p.deleted_tips * 4) <= greatest(p.tracked_tips, 1)
    ) as eligible
  from public.op_public_tipster_performance p
  join public.op_profiles pr on pr.id = p.author_id
)
select
  row_number() over (
    order by gated.eligible desc, gated.evidence_adjusted_yield_percent desc, gated.net_units desc, gated.settled_tips desc, gated.username asc
  ) as rank_position,
  gated.*,
  gated.evidence_adjusted_yield_percent as ranking_score
from gated;

grant select on public.op_public_tipster_performance to anon, authenticated;
grant select on public.op_public_tipster_leaderboard to anon, authenticated;

comment on view public.op_public_tipster_leaderboard is
  'Eligibility gates: >= 5 settled non-void tips, organic or labelled-staff account, no integrity flag, account older than 7 days, deleted tracked selections <= 25% of tracked tips. Demo and system accounts never rank. Post-start tips are structurally impossible. Ranking is evidence-adjusted yield with a 20-unit prior so a lucky tiny sample cannot dominate.';
