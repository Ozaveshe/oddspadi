import type { Handover } from "@/lib/ops/handover";

const STATUS_COPY: Record<Handover["status"], string> = {
  clear: "Clear — nothing open needs attention.",
  attention: "Attention — open work needs a look.",
  degraded: "Degraded — a source could not be read. Do not treat this as clear."
};

/**
 * The read a shift starts with. When a source fails, it says so loudly rather
 * than showing zeros — a handover that looks clear because the query failed is
 * the failure mode this whole system exists to prevent.
 */
export function DailyHandover({ handover }: { handover: Handover }) {
  const { openBySeverity } = handover;
  return (
    <section className="panel" aria-labelledby="handover-heading">
      <div className="page-heading">
        <span className="section-kicker">Daily handover</span>
        <h2 id="handover-heading">Shift status</h2>
        <p className={handover.status === "clear" ? "muted" : "notice"} role="status">
          {STATUS_COPY[handover.status]}
        </p>
      </div>

      {handover.degraded ? (
        <p className="notice" role="alert">
          Could not read: {handover.couldNotRead.join(", ")}. The figures below are incomplete.
        </p>
      ) : null}

      <dl className="stat-grid">
        <div>
          <dt>Open · critical</dt>
          <dd>{openBySeverity.critical}</dd>
        </div>
        <div>
          <dt>Open · warning</dt>
          <dd>{openBySeverity.warning}</dd>
        </div>
        <div>
          <dt>Open · info</dt>
          <dd>{openBySeverity.info}</dd>
        </div>
        <div>
          <dt>Breached now</dt>
          <dd>{handover.breachedNow}</dd>
        </div>
        <div>
          <dt>Open escalations</dt>
          <dd>{handover.openEscalations}</dd>
        </div>
        <div>
          <dt>Resolved · last 24h</dt>
          <dd>{handover.resolvedLast24h}</dd>
        </div>
      </dl>

      <h3>Handover</h3>
      <dl className="stat-grid">
        {handover.sections.map((section) => (
          <div key={section.id}>
            <dt>{section.label}</dt>
            <dd>{section.value === null ? "—" : section.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
