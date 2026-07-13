"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/analytics/events";

export type FeedComment = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: { username?: string | null; display_name?: string | null } | Array<{ username?: string | null; display_name?: string | null }> | null;
};

function author(comment: FeedComment) {
  return Array.isArray(comment.author) ? comment.author[0] : comment.author;
}

function ago(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  return mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}

export function PostComments({ postId, userId, onCountChange }: { postId: string; userId: string | null; onCountChange: (delta: number) => void }) {
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy first load — the component only mounts once the thread is opened.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`/api/community/comments?postId=${encodeURIComponent(postId)}`);
        const result = (await response.json().catch(() => ({}))) as { comments?: FeedComment[] };
        if (alive) setComments(result.comments ?? []);
      } catch {
        if (alive) setComments([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [postId]);

  if (comments === null) {
    return <p className="muted small" style={{ margin: "10px 0 0" }}>Loading comments…</p>;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/community/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postId, body })
    });
    const result = (await response.json().catch(() => ({}))) as { comment?: FeedComment; error?: string };
    if (response.ok && result.comment) {
      setComments((rows) => [...(rows ?? []), result.comment as FeedComment]);
      setDraft("");
      onCountChange(1);
      trackEvent("community_comment_posted", { post_id: postId });
    } else {
      setError(result.error ?? "The comment could not be posted.");
    }
    setBusy(false);
  }

  async function remove(commentId: string) {
    const response = await fetch(`/api/community/comments?commentId=${encodeURIComponent(commentId)}`, { method: "DELETE" });
    if (response.ok) {
      setComments((rows) => (rows ?? []).filter((row) => row.id !== commentId));
      onCountChange(-1);
    }
  }

  return (
    <div className="feed-comments">
      {comments.length ? (
        comments.map((comment) => {
          const profile = author(comment);
          const handle = profile?.username ?? "padi";
          return (
            <div className="feed-comment" key={comment.id}>
              <div className="feed-comment-head">
                <Link href={`/community/u/${encodeURIComponent(handle)}`}><strong>@{handle}</strong></Link>
                <span className="muted small">{ago(comment.created_at)}</span>
                {userId === comment.author_id ? (
                  <button type="button" className="feed-comment-delete" onClick={() => void remove(comment.id)} aria-label="Delete comment">×</button>
                ) : null}
              </div>
              <p>{comment.body}</p>
            </div>
          );
        })
      ) : (
        <p className="muted small">No comments yet — start the thread.</p>
      )}
      {userId ? (
        <form className="feed-comment-form" onSubmit={submit}>
          <input
            type="text"
            value={draft}
            maxLength={1000}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="button small-btn primary" type="submit" disabled={busy || !draft.trim()}>
            {busy ? "…" : "Reply"}
          </button>
        </form>
      ) : (
        <p className="muted small"><Link className="inline-link" href="/account">Sign in</Link> to join the thread.</p>
      )}
      {error ? <p className="muted small" role="alert">{error}</p> : null}
    </div>
  );
}
