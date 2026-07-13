import Link from "next/link";

export function EmptyState({ title, body, emoji, actionHref, actionLabel }: { title: string; body: string; emoji?: string; actionHref?: string; actionLabel?: string }) {
  return (
    <div className="empty-state">
      {emoji ? (
        <div className="empty-emoji" aria-hidden="true">
          {emoji}
        </div>
      ) : null}
      <h2>{title}</h2>
      <p className="muted">{body}</p>
      {actionHref && actionLabel ? (
        <Link className="button" href={actionHref} style={{ marginTop: 10 }}>
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="empty-state" aria-live="polite">
      <h2>Crunching the numbers…</h2>
      <p className="muted">Fetching the latest odds and match data for you.</p>
    </div>
  );
}
