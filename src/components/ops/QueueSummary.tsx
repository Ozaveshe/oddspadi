import type { QueueCount } from "@/lib/ops/queues";

/**
 * The named work-lists of a role home, each with its active-case count. Every
 * queue shows even at zero so the home is the full board, not just the busy
 * lanes.
 */
export function QueueSummary({ title, queues }: { title: string; queues: QueueCount[] }) {
  return (
    <section className="panel" aria-label={title}>
      <h2>{title}</h2>
      <dl className="stat-grid">
        {queues.map((queue) => (
          <div key={queue.id} data-busy={queue.count > 0 ? "true" : undefined}>
            <dt>{queue.label}</dt>
            <dd>{queue.count}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
