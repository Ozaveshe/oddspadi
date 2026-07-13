"use client";

import Link from "next/link";
import { useState } from "react";
import type { ComposerMatch } from "./FeedComposer";
import { PostComments } from "./PostComments";
import { trackEvent } from "@/lib/analytics/events";

export type CommunityPost = {
  id: string; author_id: string; body: string; match_id: string | null; created_at: string;
  author: { username?: string | null; display_name?: string | null } | Array<{ username?: string | null; display_name?: string | null }> | null;
  likes: Array<{ user_id: string }> | null;
  comments?: Array<{ count: number }> | null;
};

function author(post: CommunityPost) { return Array.isArray(post.author) ? post.author[0] : post.author; }
function ago(iso: string) { const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000); return mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" }); }

function commentCount(post: CommunityPost) { return post.comments?.[0]?.count ?? 0; }

export function CommunityFeed({ initialPosts, initialCursor, userId, matches }: { initialPosts: CommunityPost[]; initialCursor: string | null; userId: string | null; matches: ComposerMatch[] }) {
  const [posts, setPosts] = useState(initialPosts);
  const [cursor, setCursor] = useState(initialCursor);
  const [busy, setBusy] = useState<string | null>(null);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [countAdjust, setCountAdjust] = useState<Record<string, number>>({});
  const labels = new Map(matches.map((match) => [match.id, match.label]));

  async function toggleLike(post: CommunityPost) {
    if (!userId) { window.location.href = "/account"; return; }
    const liked = Boolean(post.likes?.some((like) => like.user_id === userId));
    const original = post.likes ?? [];
    const likes = liked ? original.filter((like) => like.user_id !== userId) : [...original, { user_id: userId }];
    setPosts((rows) => rows.map((row) => row.id === post.id ? { ...row, likes } : row));
    const response = await fetch(liked ? `/api/community/likes?postId=${encodeURIComponent(post.id)}` : "/api/community/likes", {
      method: liked ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: liked ? undefined : JSON.stringify({ postId: post.id })
    });
    if (!response.ok) setPosts((rows) => rows.map((row) => row.id === post.id ? { ...row, likes: original } : row));
    else trackEvent(liked ? "community_post_unliked" : "community_post_liked", { post_id: post.id, ...(post.match_id ? { match_id: post.match_id } : {}) });
  }

  async function remove(postId: string) {
    if (!window.confirm("Delete this post?")) return;
    setBusy(postId);
    const response = await fetch(`/api/community/posts?postId=${encodeURIComponent(postId)}`, { method: "DELETE" });
    if (response.ok) setPosts((rows) => rows.filter((row) => row.id !== postId));
    setBusy(null);
  }

  async function loadMore() {
    if (!cursor) return; setBusy("more");
    const response = await fetch(`/api/community/posts?cursor=${encodeURIComponent(cursor)}`);
    const result = await response.json();
    if (response.ok) { setPosts((rows) => [...rows, ...(result.posts ?? [])]); setCursor(result.nextCursor ?? null); }
    setBusy(null);
  }

  if (!posts.length) return <div className="empty-state"><h2>No posts yet</h2><p className="muted">Be the first to share your read on today&apos;s matches.</p></div>;
  return <div className="feed-list">
    {posts.map((post) => { const profile = author(post); const handle = profile?.username ?? "padi"; const liked = Boolean(post.likes?.some((like) => like.user_id === userId)); const threadOpen = openThread === post.id; const comments = commentCount(post) + (countAdjust[post.id] ?? 0); return (
      <article className="panel feed-post" key={post.id}>
        <div className="feed-post-head"><Link href={`/community/u/${encodeURIComponent(handle)}`}><strong>@{handle}</strong></Link>{profile?.display_name ? <span className="muted small">{profile.display_name}</span> : null}<span className="muted small" suppressHydrationWarning style={{ marginLeft: "auto" }}>{ago(post.created_at)}</span></div>
        <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{post.body}</p>
        {post.match_id ? <Link className="community-match-chip" href={`/predictions/${encodeURIComponent(post.match_id)}`}>⚽ {labels.get(post.match_id) ?? "Match discussion"}</Link> : null}
        <div className="feed-actions">
          <button type="button" className={liked ? "liked" : ""} aria-pressed={liked} onClick={() => toggleLike(post)}>♥ {post.likes?.length ?? 0}</button>
          <button type="button" aria-expanded={threadOpen} onClick={() => setOpenThread(threadOpen ? null : post.id)}>💬 {comments}</button>
          {userId === post.author_id ? <button type="button" disabled={busy === post.id} onClick={() => remove(post.id)}>Delete</button> : null}
        </div>
        {threadOpen ? <PostComments postId={post.id} userId={userId} onCountChange={(delta) => setCountAdjust((current) => ({ ...current, [post.id]: (current[post.id] ?? 0) + delta }))} /> : null}
      </article>
    ); })}
    {cursor ? <button className="button secondary" type="button" disabled={busy === "more"} onClick={loadMore}>{busy === "more" ? "Loading…" : "Load more"}</button> : null}
  </div>;
}
