-- ============================================================
-- OddsPadi community: accounts (profiles), feed, and forums.
-- Live migration version: 20260712050714.
-- Read-open, write-own, authenticated-write. RLS enabled on every table.
-- Apply via the supabase_oddspadi MCP connector (project ref
-- wncwtzqipnoqwmqlznqn) — see docs/community-feature-plan.md.
-- ============================================================

-- ---------- Shared helpers ----------
create or replace function public.op_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- Profiles (1:1 with auth.users) ----------
create table if not exists public.op_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
  bio text,
  favourite_team text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint op_profiles_username_format check (username ~ '^[a-zA-Z0-9_]{3,24}$'),
  constraint op_profiles_bio_length check (bio is null or char_length(bio) <= 500)
);

create trigger op_profiles_set_updated_at
  before update on public.op_profiles
  for each row execute function public.op_set_updated_at();

alter table public.op_profiles enable row level security;

create policy "profiles are readable by everyone"
  on public.op_profiles for select
  to anon, authenticated
  using (true);

create policy "users insert their own profile"
  on public.op_profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "users update their own profile"
  on public.op_profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Auto-create a profile row when a new auth user signs up.
create or replace function public.op_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_handle text;
  candidate text;
  suffix int := 0;
begin
  base_handle := regexp_replace(lower(coalesce(split_part(new.email, '@', 1), 'padi')), '[^a-z0-9_]', '', 'g');
  if char_length(base_handle) < 3 then
    base_handle := 'padi' || base_handle;
  end if;
  base_handle := left(base_handle, 20);
  candidate := base_handle;
  while exists (select 1 from public.op_profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := left(base_handle, 20) || suffix::text;
  end loop;

  insert into public.op_profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    candidate,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists op_on_auth_user_created on auth.users;
create trigger op_on_auth_user_created
  after insert on auth.users
  for each row execute function public.op_handle_new_user();

-- ---------- Community feed ----------
create table if not exists public.op_feed_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.op_profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  match_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists op_feed_posts_created_idx on public.op_feed_posts (created_at desc);
create index if not exists op_feed_posts_author_idx on public.op_feed_posts (author_id);

create trigger op_feed_posts_set_updated_at
  before update on public.op_feed_posts
  for each row execute function public.op_set_updated_at();

alter table public.op_feed_posts enable row level security;

create policy "feed posts are readable by everyone"
  on public.op_feed_posts for select
  to anon, authenticated
  using (true);
create policy "authenticated users create their own posts"
  on public.op_feed_posts for insert
  to authenticated
  with check ((select auth.uid()) = author_id);
create policy "authors edit their own posts"
  on public.op_feed_posts for update
  to authenticated
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);
create policy "authors delete their own posts"
  on public.op_feed_posts for delete
  to authenticated
  using ((select auth.uid()) = author_id);

create table if not exists public.op_feed_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.op_feed_posts (id) on delete cascade,
  author_id uuid not null references public.op_profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists op_feed_comments_post_idx on public.op_feed_comments (post_id, created_at);

alter table public.op_feed_comments enable row level security;

create policy "feed comments are readable by everyone"
  on public.op_feed_comments for select
  to anon, authenticated
  using (true);
create policy "authenticated users create their own comments"
  on public.op_feed_comments for insert
  to authenticated
  with check ((select auth.uid()) = author_id);
create policy "authors delete their own comments"
  on public.op_feed_comments for delete
  to authenticated
  using ((select auth.uid()) = author_id);

create table if not exists public.op_feed_post_likes (
  post_id uuid not null references public.op_feed_posts (id) on delete cascade,
  user_id uuid not null references public.op_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.op_feed_post_likes enable row level security;

create policy "likes are readable by everyone"
  on public.op_feed_post_likes for select
  to anon, authenticated
  using (true);
create policy "users manage their own likes"
  on public.op_feed_post_likes for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
create policy "users remove their own likes"
  on public.op_feed_post_likes for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------- Forums ----------
create table if not exists public.op_forum_categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.op_forum_categories enable row level security;
-- Categories are curated: read-open, writes only via service role (no write policy).
create policy "forum categories are readable by everyone"
  on public.op_forum_categories for select
  to anon, authenticated
  using (true);

create table if not exists public.op_forum_threads (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.op_forum_categories (id) on delete cascade,
  author_id uuid not null references public.op_profiles (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 160),
  body text not null check (char_length(body) between 1 and 8000),
  is_pinned boolean not null default false,
  is_locked boolean not null default false,
  reply_count int not null default 0,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists op_forum_threads_category_idx on public.op_forum_threads (category_id, last_activity_at desc);

create trigger op_forum_threads_set_updated_at
  before update on public.op_forum_threads
  for each row execute function public.op_set_updated_at();

alter table public.op_forum_threads enable row level security;

create policy "forum threads are readable by everyone"
  on public.op_forum_threads for select
  to anon, authenticated
  using (true);
create policy "authenticated users create their own threads"
  on public.op_forum_threads for insert
  to authenticated
  with check ((select auth.uid()) = author_id);
create policy "authors edit their own threads"
  on public.op_forum_threads for update
  to authenticated
  using ((select auth.uid()) = author_id and is_locked = false)
  with check ((select auth.uid()) = author_id and is_locked = false);
create policy "authors delete their own threads"
  on public.op_forum_threads for delete
  to authenticated
  using ((select auth.uid()) = author_id);

create table if not exists public.op_forum_replies (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.op_forum_threads (id) on delete cascade,
  author_id uuid not null references public.op_profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists op_forum_replies_thread_idx on public.op_forum_replies (thread_id, created_at);

create trigger op_forum_replies_set_updated_at
  before update on public.op_forum_replies
  for each row execute function public.op_set_updated_at();

alter table public.op_forum_replies enable row level security;

create policy "forum replies are readable by everyone"
  on public.op_forum_replies for select
  to anon, authenticated
  using (true);
-- Replies only allowed on threads that are not locked.
create policy "authenticated users reply on open threads"
  on public.op_forum_replies for insert
  to authenticated
  with check (
    (select auth.uid()) = author_id
    and exists (select 1 from public.op_forum_threads t where t.id = thread_id and t.is_locked = false)
  );
create policy "authors edit their own replies"
  on public.op_forum_replies for update
  to authenticated
  using (
    (select auth.uid()) = author_id
    and exists (select 1 from public.op_forum_threads t where t.id = thread_id and t.is_locked = false)
  )
  with check (
    (select auth.uid()) = author_id
    and exists (select 1 from public.op_forum_threads t where t.id = thread_id and t.is_locked = false)
  );
create policy "authors delete their own replies"
  on public.op_forum_replies for delete
  to authenticated
  using ((select auth.uid()) = author_id);

-- Keep thread activity + reply_count fresh.
create or replace function public.op_touch_thread_on_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT') then
    update public.op_forum_threads
      set reply_count = reply_count + 1, last_activity_at = now()
      where id = new.thread_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.op_forum_threads
      set reply_count = greatest(0, reply_count - 1)
      where id = old.thread_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger op_forum_replies_touch_thread
  after insert or delete on public.op_forum_replies
  for each row execute function public.op_touch_thread_on_reply();

-- ---------- Data API privileges ----------
-- RLS controls rows; column privileges keep users away from moderation and
-- denormalized fields even when they own the row.
revoke all on table
  public.op_profiles,
  public.op_feed_posts,
  public.op_feed_comments,
  public.op_feed_post_likes,
  public.op_forum_categories,
  public.op_forum_threads,
  public.op_forum_replies
from anon, authenticated;

grant select on table
  public.op_profiles,
  public.op_feed_posts,
  public.op_feed_comments,
  public.op_feed_post_likes,
  public.op_forum_categories,
  public.op_forum_threads,
  public.op_forum_replies
to anon, authenticated;

grant insert (id, username, display_name, avatar_url, bio, favourite_team)
  on public.op_profiles to authenticated;
grant update (username, display_name, avatar_url, bio, favourite_team)
  on public.op_profiles to authenticated;

grant insert (author_id, body, match_id) on public.op_feed_posts to authenticated;
grant update (body, match_id) on public.op_feed_posts to authenticated;
grant delete on public.op_feed_posts to authenticated;

grant insert (post_id, author_id, body) on public.op_feed_comments to authenticated;
grant delete on public.op_feed_comments to authenticated;

grant insert (post_id, user_id) on public.op_feed_post_likes to authenticated;
grant delete on public.op_feed_post_likes to authenticated;

grant insert (category_id, author_id, title, body) on public.op_forum_threads to authenticated;
grant update (title, body) on public.op_forum_threads to authenticated;
grant delete on public.op_forum_threads to authenticated;

grant insert (thread_id, author_id, body) on public.op_forum_replies to authenticated;
grant update (body) on public.op_forum_replies to authenticated;
grant delete on public.op_forum_replies to authenticated;

-- Trigger functions are not client APIs. Revoking EXECUTE does not prevent
-- PostgreSQL from invoking them through their configured triggers.
revoke execute on function public.op_set_updated_at() from public, anon, authenticated;
revoke execute on function public.op_handle_new_user() from public, anon, authenticated;
revoke execute on function public.op_touch_thread_on_reply() from public, anon, authenticated;

-- ---------- Seed a few starter forum categories ----------
insert into public.op_forum_categories (slug, name, description, sort_order) values
  ('match-talk',   'Match talk',      'Pre- and post-match discussion, live threads, and hot takes.', 10),
  ('predictions',  'Predictions & tips', 'Share your reads, debate the model, and track calls.',     20),
  ('leagues',      'Leagues & clubs',  'Premier League, CAF, NPFL and beyond — talk your team.',      30),
  ('site-feedback','Feedback',         'Ideas and issues for OddsPadi itself.',                       40)
on conflict (slug) do nothing;
