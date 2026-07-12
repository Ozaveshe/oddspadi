"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function FeedComposer() {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Could not post.");
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
        placeholder="Share your read on today's matches…"
        rows={3}
        maxLength={2000}
        aria-label="Write a post"
      />
      {error ? (
        <p className="small" style={{ color: "var(--red)", marginTop: 8 }}>
          {error}
        </p>
      ) : null}
      <div className="row-between" style={{ marginTop: 10, alignItems: "center" }}>
        <span className="small muted">{body.length}/2000</span>
        <button className="button primary small-btn" type="submit" disabled={busy || !body.trim()}>
          {busy ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}
