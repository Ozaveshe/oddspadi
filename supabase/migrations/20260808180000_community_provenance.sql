-- Community provenance: every account is typed (organic | staff | system | demo),
-- seeded personas are labelled honestly, staff-looking handles are reserved for
-- labelled accounts, and discussions gain canonical subjects (fixture,
-- competition, team, player, official publication, season outlook, strategy
-- topic, product feedback).

-- 1) Account provenance ------------------------------------------------------
alter table public.op_profiles
  add column if not exists account_type text not null default 'organic';
alter table public.op_profiles
  add constraint op_profiles_account_type_check
  check (account_type in ('organic','staff','system','demo'));

alter table public.op_profiles
  add column if not exists integrity_flagged_at timestamptz;
alter table public.op_profiles
  add column if not exists integrity_flag_reason text;
alter table public.op_profiles
  add constraint op_profiles_integrity_reason_length
  check (integrity_flag_reason is null or char_length(integrity_flag_reason) between 1 and 500);

comment on column public.op_profiles.account_type is
  'organic = real user; staff = OddsPadi employee (visibly labelled); system = automated OddsPadi account; demo = seeded persona (visibly labelled, excluded from leaderboards and engagement metrics).';

-- Column-level insert/update grants for authenticated remain the explicit
-- five-column list from 20260712050714; account_type and integrity_* are
-- deliberately NOT granted, so they stay service-role-only.

-- 2) Label the eight seed personas (no-op where they do not exist) -----------
update public.op_profiles set account_type = 'staff', is_admin = true
  where username = 'oddspadi_desk';
update public.op_profiles set account_type = 'demo'
  where username in ('kunle_lagos','ama_kotoko','tunde_united','zainab_hoops','chidi_naija','mariam_casa','sipho_amakhosi');

-- 3) Reserve staff-looking handles for labelled accounts ---------------------
-- NOT VALID: never breaks a pre-existing organic row; still enforced on every
-- new insert/update, which is what impersonation protection needs.
alter table public.op_profiles
  add constraint op_profiles_reserved_handles
  check (
    account_type <> 'organic'
    or username !~* '^(oddspadi|odds_padi|admin|moderator|staff|support|official)'
  ) not valid;

-- 4) Canonical discussion subjects ------------------------------------------
alter table public.op_feed_posts add column if not exists subject_type text;
alter table public.op_feed_posts add column if not exists subject_id text;
alter table public.op_feed_posts
  add constraint op_feed_posts_subject_check
  check (
    (subject_type is null and subject_id is null)
    or (
      subject_type in ('fixture','competition','team','player','publication','season_outlook','strategy','product_feedback')
      and subject_id is not null
      and char_length(subject_id) between 1 and 120
    )
  );
create index if not exists op_feed_posts_subject_idx
  on public.op_feed_posts (subject_type, subject_id, created_at desc);

alter table public.op_forum_threads add column if not exists subject_type text;
alter table public.op_forum_threads add column if not exists subject_id text;
alter table public.op_forum_threads
  add constraint op_forum_threads_subject_check
  check (
    (subject_type is null and subject_id is null)
    or (
      subject_type in ('fixture','competition','team','player','publication','season_outlook','strategy','product_feedback')
      and subject_id is not null
      and char_length(subject_id) between 1 and 120
    )
  );
create index if not exists op_forum_threads_subject_idx
  on public.op_forum_threads (subject_type, subject_id, last_activity_at desc);

-- Fixture chatter that already carried a match id becomes a fixture subject.
update public.op_feed_posts
  set subject_type = 'fixture', subject_id = match_id
  where match_id is not null and subject_type is null;

grant insert (subject_type, subject_id) on public.op_feed_posts to authenticated;
grant insert (subject_type, subject_id) on public.op_forum_threads to authenticated;
