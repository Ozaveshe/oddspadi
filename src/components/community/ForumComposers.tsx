"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trackEvent } from "@/lib/analytics/events";

async function postJson(url: string, payload: unknown): Promise<{ id?: string; error?: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "Something went wrong.");
  return result;
}

export function NewThreadForm({ categoryId }: { categoryId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/community/threads", { categoryId, title: title.trim(), body: body.trim() });
      trackEvent("forum_thread_created", { category_id: categoryId });
      setTitle("");
      setBody("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel feed-composer" onSubmit={submit}>
      <div className="field">
        <label htmlFor="thread-title">Thread title</label>
        <input
          id="thread-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={160}
          required
          placeholder="What's on your mind?"
        />
      </div>
      <textarea
        className="feed-textarea"
        style={{ marginTop: 12 }}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        maxLength={8000}
        required
        placeholder="Say more…"
        aria-label="Thread body"
      />
      {error ? (
        <p className="small" role="alert" style={{ color: "var(--red)", marginTop: 8 }}>
          {error}
        </p>
      ) : null}
      <div className="row-between" style={{ marginTop: 10, justifyContent: "flex-end" }}>
        <button className="button primary small-btn" type="submit" disabled={busy || !title.trim() || !body.trim()}>
          {busy ? "Posting…" : "Start thread"}
        </button>
      </div>
    </form>
  );
}

export function ReplyForm({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/community/replies", { threadId, body: body.trim() });
      trackEvent("forum_reply_created", { thread_id: threadId });
      setBody("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel feed-composer" onSubmit={submit}>
      <textarea
        className="feed-textarea"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        maxLength={8000}
        placeholder="Write a reply…"
        aria-label="Reply"
      />
      {error ? (
        <p className="small" role="alert" style={{ color: "var(--red)", marginTop: 8 }}>
          {error}
        </p>
      ) : null}
      <div className="row-between" style={{ marginTop: 10, justifyContent: "flex-end" }}>
        <button className="button primary small-btn" type="submit" disabled={busy || !body.trim()}>
          {busy ? "Posting…" : "Reply"}
        </button>
      </div>
    </form>
  );
}
