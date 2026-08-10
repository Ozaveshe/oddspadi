import Link from "next/link";
import { LocalTimeText } from "@/components/odds/LocalTime";
import { SurfaceClaimMarker } from "@/components/system/SurfaceClaimMarker";
import type { SurfaceClaim } from "@/lib/domain/surfaceClaim";
import type { EntityFixture } from "@/lib/entities/entityReads";

const CLAIM_STATUSES = new Set(["scheduled", "live", "finished", "postponed", "cancelled", "abandoned", "suspended"]);

function claimFor(fixture: EntityFixture, asOf: string): SurfaceClaim {
  return {
    surface: "competition",
    fixtureId: fixture.fixtureId,
    fixtureStatus: (CLAIM_STATUSES.has(fixture.status) ? fixture.status : "scheduled") as SurfaceClaim["fixtureStatus"],
    score: fixture.homeScore !== null && fixture.awayScore !== null ? `${fixture.homeScore}-${fixture.awayScore}` : null,
    market: null,
    selection: null,
    decision: null,
    publicationId: null,
    publicationStatus: null,
    publishedAt: null,
    settlement: null,
    oddsAvailable: null,
    dataAvailability: "complete",
    asOf
  };
}

/**
 * Canonical fixture rows for entity pages: kickoff, team links, fixture link,
 * model-coverage chip, correction-aware scores. Every row stamps a surface
 * claim so cross-surface reconciliation can see this page.
 */
export function EntityFixtureList({
  fixtures,
  emptyNote,
  asOf,
  showScores = false
}: {
  fixtures: EntityFixture[];
  emptyNote: string;
  asOf: string;
  showScores?: boolean;
}) {
  if (!fixtures.length) {
    return <p className="muted small">{emptyNote}</p>;
  }
  return (
    <div className="feed-list entity-fixture-list">
      {fixtures.map((fixture) => (
        <article className="panel feed-post" key={fixture.fixtureId}>
          <SurfaceClaimMarker claim={claimFor(fixture, asOf)} />
          <div className="feed-post-head">
            <span className="muted small">
              <LocalTimeText iso={fixture.kickoffAt} variant="datetime" />
            </span>
            {fixture.status === "live" ? <span className="badge live">Live</span> : null}
            {fixture.hasModelCoverage ? <span className="badge scheduled">Model coverage</span> : null}
          </div>
          <p style={{ margin: "6px 0" }}>
            <Link href={`/predictions/team/${encodeURIComponent(fixture.homeTeamId)}`}>{fixture.homeTeamName}</Link>
            {showScores && fixture.homeScore !== null && fixture.awayScore !== null ? (
              <strong>
                {" "}
                {fixture.homeScore}–{fixture.awayScore}{" "}
              </strong>
            ) : (
              <span className="muted"> vs </span>
            )}
            <Link href={`/predictions/team/${encodeURIComponent(fixture.awayTeamId)}`}>{fixture.awayTeamName}</Link>
          </p>
          <div className="feed-post-head">
            <Link className="inline-link" href={`/predictions/${encodeURIComponent(fixture.fixtureId)}`}>
              Match page
            </Link>
            {fixture.scoreSource === "verified-result" ? (
              <span className="muted small">Score from the verified result record.</span>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
