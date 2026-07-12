-- Cover community foreign keys used by ownership checks and cascading deletes.
create index if not exists op_feed_comments_author_idx
  on public.op_feed_comments (author_id);
create index if not exists op_feed_post_likes_user_idx
  on public.op_feed_post_likes (user_id);
create index if not exists op_forum_threads_author_idx
  on public.op_forum_threads (author_id);
create index if not exists op_forum_replies_author_idx
  on public.op_forum_replies (author_id);
