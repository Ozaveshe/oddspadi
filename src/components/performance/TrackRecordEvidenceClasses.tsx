import Link from "next/link";
import {
  EVIDENCE_SEPARATION_STATEMENT,
  type EvidenceClass
} from "@/lib/performance/trackRecordEvidence";

/**
 * The evidence classes, rendered as separate blocks with no total.
 *
 * There is intentionally no count beside the non-official classes and no
 * combined figure anywhere in this component. A number next to "backtests"
 * sitting in the same grid as a number next to "official public picks" is an
 * invitation to add them, and the whole point of the taxonomy is that they
 * cannot be added.
 */
export function TrackRecordEvidenceClasses({ classes }: { classes: EvidenceClass[] }) {
  const official = classes.filter((entry) => entry.countsOfficially);
  const separate = classes.filter((entry) => !entry.countsOfficially);

  return (
    <div className="track-record-evidence">
      <ul className="evidence-class-list">
        {official.map((entry) => (
          <li className="evidence-class official" key={entry.id}>
            <strong>{entry.title}</strong>
            <span>{entry.summary}</span>
            <span className="small muted">{entry.note}</span>
            {entry.href ? (
              <Link className="text-link small" href={entry.href}>
                {entry.hrefLabel}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>

      <h3 className="track-record-evidence-heading">Kept separate, and why</h3>
      <ul className="evidence-class-list">
        {separate.map((entry) => (
          <li className="evidence-class" key={entry.id}>
            <strong>{entry.title}</strong>
            <span>{entry.summary}</span>
            <span className="small muted">{entry.note}</span>
            {entry.href ? (
              <Link className="text-link small" href={entry.href}>
                {entry.hrefLabel}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="muted small">{EVIDENCE_SEPARATION_STATEMENT}</p>
    </div>
  );
}
