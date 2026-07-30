-- Guest fan-pulse votes: one tap, no account.
--
-- op_match_poll_votes has held zero rows since launch: every voter on a
-- one-tap mood widget hit a sign-in wall. Votes are a pulse, not evidence —
-- the accountability bar community tips carry does not fit here. Guests now
-- vote under a server-minted device key (httpOnly cookie). The key never
-- reaches page JavaScript, the table has no anon/authenticated grants at all,
-- and the only write path is this security-definer RPC — called by the
-- service role from the API route — which carries its own per-key throttle.
--
-- Remote migration receipt: 20260730203925 on OddsPadi wncwtzqipnoqwmqlznqn.

create table public.op_match_poll_guest_votes (
  poll_id uuid not null references public.op_match_polls (id) on delete cascade,
  voter_key uuid not null,
  choice text not null check (choice in ('home', 'draw', 'away')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (poll_id, voter_key)
);

create index op_match_poll_guest_votes_recent_idx
  on public.op_match_poll_guest_votes (voter_key, updated_at);

alter table public.op_match_poll_guest_votes enable row level security;
-- No policies on purpose: the service role is the only reader and writer.

comment on table public.op_match_poll_guest_votes is
  'Device-keyed fan pulse votes. Same separate-truth-lane rules as op_match_poll_votes: never blended with OddsPadi model performance.';

-- Poll counters aggregate both identity lanes.
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
    home_votes = (select count(*) from public.op_match_poll_votes where poll_id = v_poll_id and choice = 'home')
               + (select count(*) from public.op_match_poll_guest_votes where poll_id = v_poll_id and choice = 'home'),
    draw_votes = (select count(*) from public.op_match_poll_votes where poll_id = v_poll_id and choice = 'draw')
               + (select count(*) from public.op_match_poll_guest_votes where poll_id = v_poll_id and choice = 'draw'),
    away_votes = (select count(*) from public.op_match_poll_votes where poll_id = v_poll_id and choice = 'away')
               + (select count(*) from public.op_match_poll_guest_votes where poll_id = v_poll_id and choice = 'away'),
    updated_at = clock_timestamp()
  where id = v_poll_id;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger op_match_poll_guest_votes_refresh_counts
  after insert or update or delete on public.op_match_poll_guest_votes
  for each row execute function public.op_refresh_match_poll_counts();

create or replace function public.op_cast_guest_poll_vote(
  p_poll_id uuid,
  p_voter_key uuid,
  p_choice text
)
returns table (saved boolean, reason text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_poll public.op_match_polls%rowtype;
  v_recent integer;
begin
  if p_poll_id is null or p_voter_key is null then
    return query select false, 'invalid-request'::text;
    return;
  end if;
  if p_choice not in ('home', 'draw', 'away') then
    return query select false, 'invalid-choice'::text;
    return;
  end if;
  select * into v_poll from public.op_match_polls where id = p_poll_id;
  if not found then
    return query select false, 'poll-missing'::text;
    return;
  end if;
  if v_poll.status <> 'open' then
    return query select false, 'poll-closed'::text;
    return;
  end if;
  if p_choice = 'draw' and v_poll.draw_label is null then
    return query select false, 'invalid-choice'::text;
    return;
  end if;
  -- One device key gets a bounded number of vote writes per hour across all
  -- polls: a fan changing their mind stays comfortable, a script does not.
  select count(*) into v_recent
  from public.op_match_poll_guest_votes
  where voter_key = p_voter_key and updated_at > now() - interval '1 hour';
  if v_recent >= 30 then
    return query select false, 'rate-limited'::text;
    return;
  end if;
  insert into public.op_match_poll_guest_votes (poll_id, voter_key, choice)
  values (p_poll_id, p_voter_key, p_choice)
  on conflict (poll_id, voter_key)
  do update set choice = excluded.choice, updated_at = now();
  return query select true, null::text;
end;
$$;

comment on function public.op_cast_guest_poll_vote is
  'Casts or updates a device-keyed guest pulse vote. Service-role only; validates poll state and throttles per voter key.';

revoke all on function public.op_cast_guest_poll_vote(uuid, uuid, text) from public, anon, authenticated;
