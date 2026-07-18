-- Community opinion is a separate truth lane from the OddsPadi model and the
-- canonical public-picks ledger. Poll totals are public; voter identity is not.
-- Remote migration receipt: 20260718065856 on OddsPadi wncwtzqipnoqwmqlznqn.

create table public.op_match_polls (
  id uuid primary key default gen_random_uuid(),
  fixture_id text not null unique,
  sport text not null check (sport in ('football', 'basketball', 'tennis')),
  home_label text not null check (char_length(home_label) between 1 and 120),
  draw_label text,
  away_label text not null check (char_length(away_label) between 1 and 120),
  kickoff_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'closed', 'void')),
  home_votes integer not null default 0 check (home_votes >= 0),
  draw_votes integer not null default 0 check (draw_votes >= 0),
  away_votes integer not null default 0 check (away_votes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (draw_label is null or char_length(draw_label) between 1 and 120)
);

create table public.op_match_poll_votes (
  poll_id uuid not null references public.op_match_polls (id) on delete cascade,
  user_id uuid not null references public.op_profiles (id) on delete cascade,
  choice text not null check (choice in ('home', 'draw', 'away')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create index op_match_polls_kickoff_idx on public.op_match_polls (kickoff_at, status);
create index op_match_poll_votes_user_idx on public.op_match_poll_votes (user_id);

create or replace function public.op_refresh_match_poll_counts()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_poll_id uuid := coalesce(new.poll_id, old.poll_id);
begin
  update public.op_match_polls
  set
    home_votes = (select count(*) from public.op_match_poll_votes where poll_id = v_poll_id and choice = 'home'),
    draw_votes = (select count(*) from public.op_match_poll_votes where poll_id = v_poll_id and choice = 'draw'),
    away_votes = (select count(*) from public.op_match_poll_votes where poll_id = v_poll_id and choice = 'away'),
    updated_at = clock_timestamp()
  where id = v_poll_id;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger op_match_poll_votes_refresh_counts
  after insert or update or delete on public.op_match_poll_votes
  for each row execute function public.op_refresh_match_poll_counts();

create or replace function public.op_sync_match_poll_from_fixture()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.sport not in ('football', 'basketball', 'tennis')
    or nullif(btrim(new.home_team_name), '') is null
    or nullif(btrim(new.away_team_name), '') is null then
    return new;
  end if;

  insert into public.op_match_polls (
    fixture_id,
    sport,
    home_label,
    draw_label,
    away_label,
    kickoff_at,
    status
  ) values (
    new.external_id,
    new.sport,
    new.home_team_name,
    case when new.sport = 'football' then 'Draw' else null end,
    new.away_team_name,
    new.kickoff_at,
    case
      when new.status in ('cancelled', 'postponed') then 'void'
      when new.status = 'scheduled' and new.kickoff_at > clock_timestamp() then 'open'
      else 'closed'
    end
  )
  on conflict (fixture_id) do update set
    sport = excluded.sport,
    home_label = excluded.home_label,
    draw_label = excluded.draw_label,
    away_label = excluded.away_label,
    kickoff_at = excluded.kickoff_at,
    status = excluded.status,
    updated_at = clock_timestamp();

  return new;
end;
$$;

create trigger op_fixtures_sync_match_poll
  after insert or update of sport, external_id, home_team_name, away_team_name, kickoff_at, status
  on public.op_fixtures
  for each row execute function public.op_sync_match_poll_from_fixture();

insert into public.op_match_polls (
  fixture_id,
  sport,
  home_label,
  draw_label,
  away_label,
  kickoff_at,
  status
)
select distinct on (fixtures.external_id)
  fixtures.external_id,
  fixtures.sport,
  fixtures.home_team_name,
  case when fixtures.sport = 'football' then 'Draw' else null end,
  fixtures.away_team_name,
  fixtures.kickoff_at,
  case
    when fixtures.status in ('cancelled', 'postponed') then 'void'
    when fixtures.status = 'scheduled' and fixtures.kickoff_at > clock_timestamp() then 'open'
    else 'closed'
  end
from public.op_fixtures fixtures
where fixtures.sport in ('football', 'basketball', 'tennis')
  and nullif(btrim(fixtures.home_team_name), '') is not null
  and nullif(btrim(fixtures.away_team_name), '') is not null
order by fixtures.external_id, fixtures.last_synced_at desc, fixtures.updated_at desc
on conflict (fixture_id) do update set
  sport = excluded.sport,
  home_label = excluded.home_label,
  draw_label = excluded.draw_label,
  away_label = excluded.away_label,
  kickoff_at = excluded.kickoff_at,
  status = excluded.status,
  updated_at = clock_timestamp();

create table public.op_community_tips (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.op_profiles (id) on delete cascade,
  fixture_db_id uuid not null references public.op_fixtures (id) on delete cascade,
  fixture_id text not null,
  sport text not null check (sport in ('football', 'basketball', 'tennis')),
  home_team text not null check (char_length(home_team) between 1 and 120),
  away_team text not null check (char_length(away_team) between 1 and 120),
  kickoff_at timestamptz not null,
  market text not null check (char_length(market) between 1 and 100),
  selection text not null check (char_length(selection) between 1 and 160),
  selection_label text not null check (char_length(selection_label) between 1 and 160),
  tipped_odds numeric(10, 4) not null check (tipped_odds > 1 and tipped_odds <= 1000),
  stake_units numeric(4, 2) not null check (stake_units >= 0.1 and stake_units <= 10),
  rationale text not null check (char_length(rationale) between 50 and 2000),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (author_id, fixture_db_id, market)
);

create or replace function public.op_canonicalize_community_tip_fixture()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  fixture public.op_fixtures%rowtype;
begin
  select source.*
  into fixture
  from public.op_fixtures source
  where source.external_id = new.fixture_id
  order by source.last_synced_at desc, source.updated_at desc
  limit 1;

  if fixture.id is null then
    raise exception 'Community tips require a stored provider fixture.' using errcode = '23503';
  end if;
  if fixture.sport not in ('football', 'basketball', 'tennis')
    or nullif(btrim(fixture.home_team_name), '') is null
    or nullif(btrim(fixture.away_team_name), '') is null then
    raise exception 'The stored fixture is incomplete.' using errcode = '23514';
  end if;
  if fixture.status <> 'scheduled' or fixture.kickoff_at <= clock_timestamp() + interval '30 minutes' then
    raise exception 'Community tips lock 30 minutes before kickoff.' using errcode = '23514';
  end if;

  new.fixture_db_id := fixture.id;
  new.fixture_id := fixture.external_id;
  new.sport := fixture.sport;
  new.home_team := fixture.home_team_name;
  new.away_team := fixture.away_team_name;
  new.kickoff_at := fixture.kickoff_at;
  return new;
end;
$$;

create trigger op_community_tips_canonicalize_fixture
  before insert on public.op_community_tips
  for each row execute function public.op_canonicalize_community_tip_fixture();

create table public.op_community_tip_revisions (
  id uuid primary key default gen_random_uuid(),
  tip_id uuid not null references public.op_community_tips (id) on delete cascade,
  author_id uuid not null references public.op_profiles (id) on delete cascade,
  revision_kind text not null check (revision_kind in ('correction', 'withdrawal', 'moderation_note')),
  reason text not null check (char_length(reason) between 10 and 500),
  created_at timestamptz not null default now()
);

create table public.op_community_tip_settlements (
  tip_id uuid primary key references public.op_community_tips (id) on delete cascade,
  result text not null check (result in ('won', 'lost', 'push', 'void')),
  net_units numeric(10, 4) not null,
  source text not null check (char_length(source) between 1 and 120),
  provider text,
  home_score smallint check (home_score is null or home_score >= 0),
  away_score smallint check (away_score is null or away_score >= 0),
  fixture_observed_at timestamptz,
  settlement_version text not null default 'community-v1' check (char_length(settlement_version) between 1 and 40),
  reason text not null check (char_length(reason) between 1 and 500),
  settled_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create or replace function public.op_validate_community_tip_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  tip public.op_community_tips%rowtype;
begin
  select source.*
  into tip
  from public.op_community_tips source
  where source.id = new.tip_id;

  if tip.id is null then
    raise exception 'Community tip not found.' using errcode = '23503';
  end if;
  if new.author_id <> tip.author_id then
    raise exception 'Only the original tipster can append this note.' using errcode = '42501';
  end if;
  if new.revision_kind = 'withdrawal' then
    if tip.kickoff_at <= clock_timestamp() + interval '30 minutes' then
      raise exception 'Community tips cannot be withdrawn inside the 30-minute lock.' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.op_community_tip_revisions revisions
      where revisions.tip_id = tip.id and revisions.revision_kind = 'withdrawal'
    ) then
      raise exception 'This community tip is already withdrawn.' using errcode = '23505';
    end if;
    if exists (
      select 1 from public.op_community_tip_settlements settlements
      where settlements.tip_id = tip.id
    ) then
      raise exception 'A settled community tip cannot be withdrawn.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger op_community_tip_revisions_validate
  before insert on public.op_community_tip_revisions
  for each row execute function public.op_validate_community_tip_revision();

create index op_community_tips_fixture_idx on public.op_community_tips (fixture_id, published_at desc);
create index op_community_tips_author_idx on public.op_community_tips (author_id, published_at desc);
create index op_community_tips_kickoff_idx on public.op_community_tips (kickoff_at);
create index op_community_tip_revisions_tip_idx on public.op_community_tip_revisions (tip_id, created_at desc);

create view public.op_public_tipster_performance
with (security_invoker = true)
as
select
  tips.author_id,
  count(*)::integer as published_tips,
  count(settlements.tip_id) filter (where settlements.result <> 'void')::integer as settled_tips,
  count(*) filter (where settlements.result = 'won')::integer as wins,
  count(*) filter (where settlements.result = 'lost')::integer as losses,
  count(*) filter (where settlements.result = 'push')::integer as pushes,
  count(*) filter (where settlements.result = 'void')::integer as voids,
  coalesce(sum(tips.stake_units) filter (where settlements.result in ('won', 'lost', 'push')), 0)::numeric(12, 4) as staked_units,
  coalesce(sum(settlements.net_units), 0)::numeric(12, 4) as net_units,
  case
    when coalesce(sum(tips.stake_units) filter (where settlements.result in ('won', 'lost', 'push')), 0) > 0
      then round(
        coalesce(sum(settlements.net_units), 0)
        / sum(tips.stake_units) filter (where settlements.result in ('won', 'lost', 'push')) * 100,
        2
      )
    else 0
  end as yield_percent,
  round(
    coalesce(sum(settlements.net_units), 0)
    / (coalesce(sum(tips.stake_units) filter (where settlements.result in ('won', 'lost', 'push')), 0) + 20) * 100,
    2
  ) as evidence_adjusted_yield_percent,
  max(tips.published_at) as latest_tip_at
from public.op_community_tips tips
left join public.op_community_tip_settlements settlements on settlements.tip_id = tips.id
group by tips.author_id;

create view public.op_public_tipster_leaderboard
with (security_invoker = true)
as
select
  row_number() over (
    order by
      (performance.settled_tips >= 5) desc,
      performance.evidence_adjusted_yield_percent desc,
      performance.net_units desc,
      performance.settled_tips desc,
      profiles.username asc
  )::integer as rank_position,
  profiles.id as author_id,
  profiles.username,
  profiles.display_name,
  profiles.avatar_url,
  performance.published_tips,
  performance.settled_tips,
  performance.wins,
  performance.losses,
  performance.pushes,
  performance.voids,
  performance.staked_units,
  performance.net_units,
  performance.yield_percent,
  performance.evidence_adjusted_yield_percent as ranking_score,
  performance.settled_tips >= 5 as eligible,
  performance.latest_tip_at
from public.op_public_tipster_performance performance
join public.op_profiles profiles on profiles.id = performance.author_id;

create table public.op_community_consensus_research_receipts (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null unique references public.op_match_polls (id) on delete cascade,
  fixture_db_id uuid not null references public.op_fixtures (id) on delete cascade,
  decision_summary_id uuid not null references public.op_fixture_decision_summaries (id) on delete cascade,
  sport text not null check (sport in ('football', 'basketball', 'tennis')),
  vote_count integer not null check (vote_count >= 20),
  model_distribution jsonb not null check (jsonb_typeof(model_distribution) = 'object'),
  crowd_distribution jsonb not null check (jsonb_typeof(crowd_distribution) = 'object'),
  outcome text not null check (outcome in ('home', 'draw', 'away')),
  model_brier numeric(10, 8) not null check (model_brier between 0 and 2),
  crowd_brier numeric(10, 8) not null check (crowd_brier between 0 and 2),
  total_variation numeric(10, 8) not null check (total_variation between 0 and 1),
  better_forecast text not null check (better_forecast in ('model', 'crowd', 'tie')),
  controls jsonb not null default '{"canInfluenceModel":false,"canCountAsModelPerformance":false,"requiresFrozenPreKickoffPoll":true}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(controls) = 'object')
);

create index op_community_consensus_research_generated_idx
  on public.op_community_consensus_research_receipts (sport, generated_at desc);

alter table public.op_match_polls enable row level security;
alter table public.op_match_poll_votes enable row level security;
alter table public.op_community_tips enable row level security;
alter table public.op_community_tip_revisions enable row level security;
alter table public.op_community_tip_settlements enable row level security;
alter table public.op_community_consensus_research_receipts enable row level security;

create policy "Poll totals are public"
  on public.op_match_polls for select
  to anon, authenticated
  using (true);

create policy "Voters can read their own vote"
  on public.op_match_poll_votes for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Voters can cast their own open poll vote"
  on public.op_match_poll_votes for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.op_match_polls polls
      where polls.id = poll_id and polls.status = 'open' and polls.kickoff_at > clock_timestamp()
    )
  );

create policy "Voters can change their own open poll vote"
  on public.op_match_poll_votes for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.op_match_polls polls
      where polls.id = poll_id and polls.status = 'open' and polls.kickoff_at > clock_timestamp()
    )
  );

create policy "Voters can remove their own open poll vote"
  on public.op_match_poll_votes for delete
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.op_match_polls polls
      where polls.id = poll_id and polls.status = 'open' and polls.kickoff_at > clock_timestamp()
    )
  );

create policy "Community tips are public opinions"
  on public.op_community_tips for select
  to anon, authenticated
  using (true);

create policy "Tipsters can publish immutable tips"
  on public.op_community_tips for insert
  to authenticated
  with check (
    (select auth.uid()) = author_id
    and kickoff_at > clock_timestamp() + interval '30 minutes'
  );

create policy "Community tip revisions are public"
  on public.op_community_tip_revisions for select
  to anon, authenticated
  using (true);

create policy "Tipsters can append notes to their own tips"
  on public.op_community_tip_revisions for insert
  to authenticated
  with check (
    (select auth.uid()) = author_id
    and exists (
      select 1 from public.op_community_tips tips
      where tips.id = tip_id and tips.author_id = (select auth.uid())
    )
  );

create policy "Community tip settlements are public"
  on public.op_community_tip_settlements for select
  to anon, authenticated
  using (true);

revoke all on table
  public.op_match_polls,
  public.op_match_poll_votes,
  public.op_community_tips,
  public.op_community_tip_revisions,
  public.op_community_tip_settlements,
  public.op_community_consensus_research_receipts
from anon, authenticated;

grant select on table public.op_match_polls to anon, authenticated;
grant select on table public.op_match_poll_votes to authenticated;
grant insert (poll_id, user_id, choice), update (choice), delete on public.op_match_poll_votes to authenticated;
grant select on table public.op_community_tips to anon, authenticated;
grant insert (author_id, fixture_id, sport, home_team, away_team, kickoff_at, market, selection, selection_label, tipped_odds, stake_units, rationale)
  on public.op_community_tips to authenticated;
grant select on table public.op_community_tip_revisions to anon, authenticated;
grant insert (tip_id, author_id, revision_kind, reason) on public.op_community_tip_revisions to authenticated;
grant select on table public.op_community_tip_settlements to anon, authenticated;
grant select on table public.op_public_tipster_performance to anon, authenticated;
grant select on table public.op_public_tipster_leaderboard to anon, authenticated;

grant all on table
  public.op_match_polls,
  public.op_match_poll_votes,
  public.op_community_tips,
  public.op_community_tip_revisions,
  public.op_community_tip_settlements,
  public.op_community_consensus_research_receipts
to service_role;

revoke execute on function public.op_refresh_match_poll_counts() from public, anon, authenticated;
revoke execute on function public.op_sync_match_poll_from_fixture() from public, anon, authenticated;
revoke execute on function public.op_canonicalize_community_tip_fixture() from public, anon, authenticated;
revoke execute on function public.op_validate_community_tip_revision() from public, anon, authenticated;

alter table public.op_user_rate_limits drop constraint op_user_rate_limits_action_check;
alter table public.op_user_rate_limits add constraint op_user_rate_limits_action_check check (action in (
  'profile_update', 'follow_team', 'push_subscription', 'community_post', 'community_comment',
  'community_like', 'forum_thread', 'forum_reply', 'community_poll_vote', 'community_tip'
));

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
    ('community_tip'::text, 12, 3600)
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

revoke all on function public.op_consume_user_rate_limit(text) from public, anon;
grant execute on function public.op_consume_user_rate_limit(text) to authenticated, service_role;

comment on table public.op_match_polls is 'Public aggregate fan pulse for a provider-backed fixture. Raw voter identity stays owner-only.';
comment on table public.op_community_tips is 'Immutable fan-authored betting opinions. Never used as OddsPadi model input or public model accuracy.';
comment on column public.op_community_tips.fixture_db_id is 'Canonical stored provider fixture selected by the database trigger; client metadata cannot replace it.';
comment on table public.op_community_tip_revisions is 'Append-only corrections and withdrawals; original tip fields never change.';
comment on table public.op_community_tip_settlements is 'Service-settled results for community tips, independent of op_public_picks.';
comment on view public.op_public_tipster_performance is 'Public community-tip performance only. Never blended with OddsPadi model performance.';
comment on view public.op_public_tipster_leaderboard is 'Community ranking with a five-result eligibility floor and a transparent 20-unit evidence prior. Never blended with OddsPadi model performance.';
comment on table public.op_community_consensus_research_receipts is 'Private frozen-poll research comparing model and crowd forecasts after provider settlement. Research-only: never model performance or an automatic training input.';
