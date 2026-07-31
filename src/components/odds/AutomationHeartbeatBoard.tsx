import type { AutomationJobStatus } from "@/lib/sports/automationHeartbeat";

/**
 * Status rows for the scheduled jobs that run the engine unattended.
 *
 * Freshness is measured against each job's own schedule, not a mood: a job is
 * "late" only after missing more than one pass, and a red row carries the run
 * ledger's actual error message.
 */
const FRESHNESS_LABEL: Record<AutomationJobStatus["freshness"], string> = {
  ok: "On schedule",
  late: "Running late",
  failed: "Last run failed",
  none: "No runs yet"
};

function age(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function AutomationHeartbeatBoard({ jobs }: { jobs: AutomationJobStatus[] }) {
  return (
    <ul className="heartbeat-list">
      {jobs.map((job) => (
        <li key={job.id} className={`heartbeat-row hb-${job.freshness}`}>
          <span className="heartbeat-dot" aria-hidden="true" />
          <span className="heartbeat-main">
            <span className="heartbeat-label">{job.label}</span>
            <span className="heartbeat-cadence">{job.cadence}</span>
          </span>
          <span className="heartbeat-state">
            <strong>{FRESHNESS_LABEL[job.freshness]}</strong>
            <span className="muted small">{age(job.minutesSinceRun)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
