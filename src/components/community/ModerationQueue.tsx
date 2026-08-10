"use client";

import { useCallback, useEffect, useState } from "react";

type QueueReport = {
  id: string;
  reporter_id: string;
  content_type: string;
  content_id: string;
  category: string;
  note: string | null;
  status: string;
  created_at: string;
};

const ACTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "hide", label: "Hide content" },
  { value: "unhide", label: "Unhide content" },
  { value: "lock_thread", label: "Lock thread" },
  { value: "unlock_thread", label: "Unlock thread" },
  { value: "moderate_tip", label: "Moderate tip (tombstone)" },
  { value: "flag_account", label: "Flag account integrity" },
  { value: "unflag_account", label: "Clear account flag" },
  { value: "dismiss_report", label: "Dismiss report" },
  { value: "note", label: "Audit note only" }
];

export function ModerationQueue() {
  const [reports, setReports] = useState<QueueReport[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/community/moderation");
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Queue unavailable.");
      setReports(Array.isArray(payload.reports) ? payload.reports : []);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Queue unavailable.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply(report: QueueReport, formData: FormData) {
    const action = String(formData.get("action") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    setBusy(report.id);
    setMessage(null);
    try {
      const response = await fetch("/api/community/moderation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          contentType: report.content_type,
          contentId: report.content_id,
          targetUserId: report.content_type === "profile" ? report.content_id : undefined,
          reportId: report.id,
          reason
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Action failed.");
      setMessage(`Action recorded (${action}).`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  if (state === "loading") return <p className="muted">Loading the queue…</p>;
  if (state === "error") return <p className="notice" role="alert">{message}</p>;
  if (!reports.length) {
    return (
      <div className="empty-state">
        <h2>No open reports</h2>
        <p className="muted">The queue is clear. Honest and quiet beats busy and fake.</p>
      </div>
    );
  }
  return (
    <div className="feed-list">
      {message ? <p className="notice" role="status">{message}</p> : null}
      {reports.map((report) => (
        <article className="panel feed-post" key={report.id}>
          <div className="feed-post-head">
            <strong>{report.category.replaceAll("_", " ")}</strong>
            <span className="muted small">{report.content_type.replaceAll("_", " ")}</span>
            <code className="muted small">{report.content_id}</code>
          </div>
          {report.note ? <p className="muted">{report.note}</p> : null}
          <form
            className="feed-comment-form"
            onSubmit={(event) => {
              event.preventDefault();
              void apply(report, new FormData(event.currentTarget));
            }}
          >
            <select name="action" defaultValue="hide" aria-label="Moderation action">
              {ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input name="reason" required minLength={3} maxLength={500} placeholder="Reason (goes to the audit log)" aria-label="Reason" />
            <button className="button" type="submit" disabled={busy === report.id}>
              {busy === report.id ? "Applying…" : "Apply"}
            </button>
          </form>
        </article>
      ))}
    </div>
  );
}
