import type { ConfidenceLevel, MatchStatus, RiskLevel } from "@/lib/sports/types";
import { formatSignedPercent } from "@/lib/sports/prediction/format";
import { fixtureLifecycle } from "@/lib/sports/lifecycle/fixtureState";
import { FixtureLifecycleBadge } from "@/components/odds/FixtureLifecycleBadge";

export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  return <span className={`badge ${level}`}>{level} confidence</span>;
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={`badge ${level}-risk`}>{level} risk</span>;
}

export function ValueEdgeBadge({ edge }: { edge: number }) {
  if (edge <= 0) return <span className="badge no-value">No value</span>;
  return <span className="badge positive">{formatSignedPercent(edge)} edge</span>;
}

/**
 * The fixture's state, derived rather than echoed.
 *
 * This used to be `<span className={`badge ${status}`}>{status}</span>` — the
 * stored column printed straight to the page. That is the component that
 * rendered "scheduled" under a match which had finished hours earlier, because
 * the column was only corrected by a sweep that ran four times a day.
 *
 * Given kick-off and sport it now asks `fixtureLifecycle`, the same function
 * reconciliation uses, so the badge is right between sweeps instead of only
 * after one. Those two are optional and it falls back to the raw status
 * without them — several callers have nothing else to give, and a bare label is
 * still better than an error.
 */
export function MatchStatusBadge({
  status,
  sport,
  kickoffAt,
  score,
  startedAt,
  resultedAt,
  now
}: {
  status: MatchStatus;
  sport?: string;
  kickoffAt?: string | null;
  score?: { home: number; away: number } | null;
  startedAt?: string | null;
  resultedAt?: string | null;
  /** Injectable so a snapshot test is not a function of when it ran. */
  now?: Date;
}) {
  if (!sport || !kickoffAt) return <span className={`badge ${status}`}>{status}</span>;

  const lifecycle = fixtureLifecycle(
    {
      sport,
      kickoffAt: new Date(kickoffAt),
      status,
      startedAt: startedAt ? new Date(startedAt) : null,
      resultedAt: resultedAt ? new Date(resultedAt) : null,
      homeScore: score?.home ?? null,
      awayScore: score?.away ?? null
    },
    now ?? new Date()
  );
  return <FixtureLifecycleBadge state={lifecycle.state} />;
}
