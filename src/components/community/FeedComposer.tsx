"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trackEvent } from "@/lib/analytics/events";

export type ComposerMatch = { id: string; label: string; kickoff: string };

export function FeedComposer({ matches = [], initialMatchId = "", initialBody = "" }: { matches?: ComposerMatch[]; initialMatchId?: string; initialBody?: string }) {
  const router = useRouter();
  const [body, setBody] = useState(initialBody);
  const [matchId, setMatchId] = useState(initialMatchId);
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
        body: JSON.stringify({ body: text, matchId: matchId || null })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Could not post.");
      trackEvent("community_post_created", { ...(matchId ? { match_id: matchId } : {}) });
      setBody("");
      setMatchId("");
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
      {matches.length ? (
        <label className="composer-match-picker">
          <span>Attach a match</span>
          <select value={matchId} onChange={(event) => setMatchId(event.target.value)}>
            <option value="">No match attached</option>
            {matches.map((match) => <option value={match.id} key={match.id}>{match.label}</option>)}
          </select>
        </label>
      ) : null}
      {error ? (
        <p className="small" role="alert" style={{ color: "var(--red)", marginTop: 8 }}>
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
