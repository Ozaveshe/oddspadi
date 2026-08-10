"use client";

import { useCallback, useEffect, useState } from "react";

type OpsCase = {
  id: string;
  workspace: string;
  kind: string;
  severity: string;
  title: string;
  state: string;
  assigneeFingerprint: string | null;
  dueAt: string | null;
  sla: string;
};

const ACTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "claim", label: "Claim (assign to me)" },
  { value: "acknowledge", label: "Acknowledge" },
  { value: "start", label: "Start work" },
  { value: "wait", label: "Waiting on someone" },
  { value: "resolve", label: "Resolve" },
  { value: "escalate", label: "Escalate" },
  { value: "dismiss", label: "Dismiss" },
  { value: "note", label: "Add note" },
  { value: "quality_review", label: "Quality review" }
];

const NEEDS_NOTE = new Set(["resolve", "dismiss", "escalate", "note", "quality_review"]);

/**
 * The case board for one workspace. Reads /api/ops/cases and applies audited
 * actions; every action is validated server-side and writes a timeline event,
 * so this component never decides policy — it just presents the queue.
 */
export function CaseBoard({ workspace }: { workspace: "market_ops" | "community" }) {
  const [cases, setCases] = useState<OpsCase[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch(`/api/ops/cases?workspace=${workspace}&state=active`);
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Case queue unavailable.");
      setCases(Array.isArray(payload.cases) ? payload.cases : []);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Case queue unavailable.");
      setState("error");
    }
  }, [workspace]);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply(item: OpsCase, formData: FormData) {
    const action = String(formData.get("action") ?? "");
    const note = String(formData.get("note") ?? "").trim();
    setBusy(item.id);
    setMessage(null);
    try {
      const response = await fetch("/api/ops/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caseId: item.id, action, note: note || undefined })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Action failed.");
      setMessage(payload.status === "training-preview" ? `Training preview: ${payload.wouldHave}` : `Recorded (${action}).`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  if (state === "loading") return <p className="muted">Loading cases…</p>;
  if (state === "error") return <p className="notice" role="alert">{message}</p>;
  if (!cases.length) {
    return (
      <div className="empty-state">
        <h2>No open cases</h2>
        <p className="muted">Nothing needs an owner right now.</p>
      </div>
    );
  }

  return (
    <div className="feed-list">
      {message ? <p className="notice" role="status">{message}</p> : null}
      {cases.map((item) => (
        <article className="panel feed-post" key={item.id} data-severity={item.severity} data-sla={item.sla}>
          <div className="feed-post-head">
            <strong>{item.title}</strong>
            <span className="muted small">{item.severity}</span>
            <span className="muted small">{item.state}</span>
            <span className="muted small">SLA: {item.sla.replaceAll("_", " ")}</span>
            {item.assigneeFingerprint ? <code className="muted small">{item.assigneeFingerprint}</code> : null}
          </div>
          <form
            className="feed-comment-form"
            onSubmit={(event) => {
              event.preventDefault();
              void apply(item, new FormData(event.currentTarget));
            }}
          >
            <select name="action" defaultValue="claim" aria-label="Case action">
              {ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input name="note" minLength={3} maxLength={2000} placeholder="Note (required to resolve, escalate, dismiss)" aria-label="Case note" />
            <button className="button" type="submit" disabled={busy === item.id}>
              {busy === item.id ? "Applying…" : "Apply"}
            </button>
          </form>
        </article>
      ))}
      <p className="muted small">A note is required for: {[...NEEDS_NOTE].join(", ")}.</p>
    </div>
  );
}
