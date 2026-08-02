import { decisionStatusFromSlateStatus, settlementStatusFromLegacy, type FixtureStatus } from "@/lib/domain/states";
import { normaliseScore, type PublicSurface, type SurfaceClaim } from "@/lib/domain/surfaceClaim";
import type { MatchIntelligence } from "@/lib/match/matchIntelligence";
import type { CanonicalFixtureStatus, SlateFixture } from "@/lib/sports/intelligence/types";
import type { PublicationRecord } from "@/lib/domain/publication";

/**
 * One place per source shape where a claim is derived.
 *
 * Surfaces read through different modules — the slate, the match view-model,
 * the publication ledger — and each has its own vocabulary for the same facts.
 * If every surface converted for itself, the conversions would drift and the
 * consistency test would be comparing two bugs. These adapters are the only
 * sanctioned translation, so a surface can be wrong about *which* fixture it is
 * showing but not about *what the state means*.
 */

/** Provider statuses normalise into the canonical lifecycle. */
const FIXTURE_STATUS: Record<CanonicalFixtureStatus, FixtureStatus> = {
  scheduled: "scheduled",
  live: "live",
  finished: "finished",
  postponed: "postponed",
  cancelled: "cancelled",
  abandoned: "abandoned",
  suspended: "delayed"
};

export function fixtureStatusFromCanonical(status: CanonicalFixtureStatus): FixtureStatus {
  return FIXTURE_STATUS[status] ?? "unknown";
}

/**
 * A slate row as Today, the listings, value picks and history all see it.
 *
 * `asOf` is the slate's generation instant, not the render instant: two
 * surfaces rendering the same slate seconds apart are speaking as of the same
 * moment, and using `Date.now()` here would manufacture disagreement.
 */
export function claimFromSlateFixture(
  surface: PublicSurface,
  row: SlateFixture,
  options: { asOf?: string; publication?: PublicationRecord | null } = {}
): SurfaceClaim {
  const { fixture, decisionSummary, bestDecision } = row;
  const publication = options.publication ?? null;
  const status = fixtureStatusFromCanonical(fixture.status);

  // Odds availability is tri-state. "No priced market" and "we never looked"
  // are different answers, and collapsing them is one of the listed
  // contradictions.
  const oddsAvailable = row.odds.length > 0 ? true : decisionSummary.publicStatus === "needs_data" ? null : false;

  return {
    surface,
    fixtureId: fixture.fixtureId,
    fixtureStatus: status,
    score: normaliseScore(fixture.score?.home, fixture.score?.away),
    market: bestDecision?.market ?? null,
    selection: bestDecision?.selection ?? null,
    decision: decisionStatusFromSlateStatus(row.publicStatus),
    publicationId: publication?.publicationId ?? null,
    publicationStatus: publication?.publicationStatus ?? null,
    publishedAt: publication?.publishedAt ?? null,
    // Settlement is only meaningful against a published claim. Without one
    // there is nothing to grade, so the surface stays silent rather than
    // asserting "unsettled" and appearing to disagree with the ledger.
    settlement: publication && bestDecision ? settlementStatusFromLegacy(bestDecision.settlementStatus) : null,
    oddsAvailable,
    dataAvailability: availabilityFromSlateStatus(row.publicStatus),
    asOf: options.asOf ?? decisionSummary.generatedAt
  };
}

function availabilityFromSlateStatus(status: SlateFixture["publicStatus"]): SurfaceClaim["dataAvailability"] {
  if (status === "needs_data") return "unavailable";
  if (status === "stale") return "stale";
  if (status === "preliminary") return "partial";
  if (status === "no_clear_value") return "confirmed_empty";
  return "complete";
}

/** The match page's own view-model. */
export function claimFromMatchIntelligence(
  intelligence: MatchIntelligence,
  options: { fixtureId: string; publication?: PublicationRecord | null; availability: SurfaceClaim["dataAvailability"] }
): SurfaceClaim {
  const publication = options.publication ?? null;
  const { header, odds, decision } = intelligence;
  return {
    surface: "match",
    fixtureId: options.fixtureId,
    fixtureStatus: header.status,
    score: normaliseScore(header.score?.home, header.score?.away),
    market: decision.publication?.market ?? null,
    selection: decision.publication?.selectionLabel ?? null,
    decision: decision.status,
    publicationId: publication?.publicationId ?? null,
    publicationStatus: publication?.publicationStatus ?? null,
    publishedAt: publication?.publishedAt ?? null,
    settlement: publication?.settlementStatus ?? null,
    // "unavailable" is a failed read; "none" is a real absence of a price.
    oddsAvailable: odds.state === "unavailable" ? null : odds.state === "none" || odds.state === "in-play-unpriced" ? false : true,
    dataAvailability: options.availability,
    asOf: header.lastVerifiedAt
  };
}

/**
 * The ledger's own claim, used by results and performance.
 *
 * This one is the reference: where a surface disagrees with the ledger, the
 * ledger is right by construction, because a publication is the only record
 * that carries a pre-kickoff timestamp and an immutable claim.
 */
export function claimFromPublication(
  surface: PublicSurface,
  publication: PublicationRecord,
  fixture: { status: FixtureStatus; score: string | null; asOf: string | null }
): SurfaceClaim {
  return {
    surface,
    fixtureId: publication.fixtureId,
    fixtureStatus: fixture.status,
    score: fixture.score,
    market: publication.market,
    selection: publication.selection,
    decision: "pick",
    publicationId: publication.publicationId,
    publicationStatus: publication.publicationStatus,
    publishedAt: publication.publishedAt,
    settlement: publication.settlementStatus,
    // A publication always records the price it was struck at.
    oddsAvailable: typeof publication.oddsAtPublication === "number" ? true : null,
    dataAvailability: "complete",
    asOf: fixture.asOf
  };
}
