import { LocalTime } from "@/components/odds/LocalTime";
import type { DataAvailability } from "@/lib/domain/states";

/**
 * The one component that tells a visitor what state the data is in.
 *
 * Pages used to render a failed read as an empty list, so an outage and a
 * quiet Tuesday looked identical. Each state below says something different
 * and true, and none of them shows a raw error: database cancellation text and
 * provider stack traces are operator information, not product copy.
 */
export type PublicStateNoticeProps = {
  availability: DataAvailability;
  /** What the surface is about, e.g. "Today's slate". Used in the sentence. */
  subject: string;
  /** When the snapshot being shown was built. */
  builtAt?: string | null;
  ageMs?: number | null;
  /** Copy for the confirmed-empty case; only this state can be phrased as a fact. */
  emptyMessage?: string;
  /** Extra explanation for the partial case, e.g. which evidence is missing. */
  partialDetail?: string;
};

function ageLabel(ageMs: number | null | undefined): string | null {
  if (ageMs === null || ageMs === undefined) return null;
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 1) return "less than a minute old";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} old`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} old`;
}

export function PublicStateNotice({
  availability,
  subject,
  builtAt,
  ageMs,
  emptyMessage,
  partialDetail
}: PublicStateNoticeProps) {
  if (availability === "complete") return null;

  const age = ageLabel(ageMs);
  const asOf = builtAt ? <LocalTime iso={builtAt} variant="datetime" /> : null;

  if (availability === "unavailable") {
    return (
      <div className="public-state-notice unavailable" role="status">
        <strong>{subject} is temporarily unavailable.</strong>
        <p>
          We could not verify the current data, so nothing is shown rather than a figure we cannot stand behind.
          {asOf ? <> The last verified snapshot was built {asOf}.</> : null} This is not a zero — please check back shortly.
        </p>
      </div>
    );
  }

  if (availability === "stale") {
    return (
      <div className="public-state-notice stale" role="status">
        <strong>Showing the last verified snapshot{age ? `, ${age}` : ""}.</strong>
        <p>
          {subject} may not reflect the last few minutes of changes.{asOf ? <> Snapshot built {asOf}.</> : null}
        </p>
      </div>
    );
  }

  if (availability === "partial") {
    return (
      <div className="public-state-notice partial" role="status">
        <strong>{subject} is showing with known gaps.</strong>
        <p>{partialDetail ?? "Some evidence is still missing, so parts of this view are withheld rather than estimated."}</p>
      </div>
    );
  }

  return (
    <div className="public-state-notice empty" role="status">
      <strong>Nothing to show — and that is the real answer.</strong>
      <p>{emptyMessage ?? `We checked successfully and no qualifying records exist for ${subject.toLowerCase()}.`}</p>
    </div>
  );
}
