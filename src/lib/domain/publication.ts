import type {
  DataAvailability,
  DecisionStatus,
  PublicationStatus,
  RecordClass,
  SettlementStatus
} from "@/lib/domain/states";

/**
 * The immutable publication record — the only object that may enter OddsPadi's
 * official public performance ledger.
 *
 * Every field here exists because a public claim depends on it. A record that
 * cannot say which model produced it, at what price, against which market, at
 * what time, relative to which kickoff, is not auditable, and an unauditable
 * claim is indistinguishable from an invented one.
 */
export type PublicationRecord = {
  /** Stable ledger identity. Articles cite this, never a recomputed count. */
  publicationId: string;
  fixtureId: string;
  sport: string;
  competition: string;
  market: string;
  selection: string;
  selectionLabel: string;
  marketLine: number | null;

  /** Provenance of the reasoning — four independently versioned inputs. */
  modelVersion: string;
  featureSetVersion: string;
  calibrationVersion: string;
  decisionPolicyVersion: string;

  modelProbability: number;
  /** The price this claim was struck at. Never rewritten by a later result. */
  oddsAtPublication: number;
  impliedProbability: number;

  /** Server-generated. A client-supplied publication time is not evidence. */
  publishedAt: string;
  kickoffAt: string;
  /** Latest moment of evidence the decision was allowed to see. */
  evidenceCutoffAt: string;
  oddsSnapshotAt: string;
  oddsSnapshotId: string | null;

  dataQuality: DataAvailability;
  decisionStatus: DecisionStatus;
  /** Reference to the rendered public explanation, not the prose itself. */
  publicCopyRef: string | null;

  publicationStatus: PublicationStatus;
  settlementStatus: SettlementStatus;
  settledAt: string | null;
  /** Present only on corrected or retracted records. */
  correctionReason: string | null;
  supersedesPublicationId: string | null;
  recordClass: RecordClass;
};

export type PublicationRevision = {
  revisionId: string;
  publicationId: string;
  revision: number;
  /** Full prior state, verbatim, so the original claim stays readable forever. */
  previousState: Record<string, unknown>;
  reason: string;
  createdAt: string;
};

export type PublicationSettlement = {
  settlementId: string;
  publicationId: string;
  status: SettlementStatus;
  /** The score or market resolution the verdict was derived from. */
  resolutionBasis: Record<string, unknown>;
  settledAt: string;
  /** Exactly one settlement per publication may be current. */
  isCurrent: boolean;
  supersededBySettlementId: string | null;
};

export type PublicationInvariantViolation = {
  rule: string;
  detail: string;
};

/**
 * Application-side gate for creating a publication.
 *
 * The database enforces these too (see the ledger migration); this exists so
 * the caller fails with a readable reason instead of a constraint name, and so
 * the rules are testable without a database.
 */
export function checkPublicationInvariants(
  candidate: Pick<
    PublicationRecord,
    "publishedAt" | "kickoffAt" | "evidenceCutoffAt" | "oddsAtPublication" | "modelProbability" | "recordClass"
  >
): PublicationInvariantViolation[] {
  const violations: PublicationInvariantViolation[] = [];
  const published = Date.parse(candidate.publishedAt);
  const kickoff = Date.parse(candidate.kickoffAt);
  const cutoff = Date.parse(candidate.evidenceCutoffAt);

  if (!Number.isFinite(published)) {
    violations.push({ rule: "published-at-valid", detail: "publishedAt is not a valid timestamp." });
  }
  if (!Number.isFinite(kickoff)) {
    violations.push({ rule: "kickoff-valid", detail: "kickoffAt is not a valid timestamp." });
  }
  // The central rule: a pick made after the ball is kicked is not a prediction.
  if (Number.isFinite(published) && Number.isFinite(kickoff) && published >= kickoff) {
    violations.push({
      rule: "publish-before-kickoff",
      detail: `publishedAt (${candidate.publishedAt}) is at or after kickoff (${candidate.kickoffAt}).`
    });
  }
  if (Number.isFinite(cutoff) && Number.isFinite(published) && cutoff > published) {
    violations.push({
      rule: "evidence-cutoff-before-publication",
      detail: "evidenceCutoffAt is after publishedAt, so the decision saw evidence it could not have had."
    });
  }
  if (!(candidate.oddsAtPublication > 1)) {
    violations.push({ rule: "odds-plausible", detail: "oddsAtPublication must be greater than 1." });
  }
  if (!(candidate.modelProbability > 0 && candidate.modelProbability < 1)) {
    violations.push({ rule: "probability-range", detail: "modelProbability must be strictly between 0 and 1." });
  }
  if (candidate.recordClass !== "official_public_pick") {
    violations.push({
      rule: "official-class-only",
      detail: `recordClass ${candidate.recordClass} may not be written to the publication ledger.`
    });
  }
  return violations;
}
