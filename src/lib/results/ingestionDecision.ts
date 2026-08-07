import type { CanonicalResult } from "@/lib/results/canonicalResult";
import { verifyResult, type ResultObservation, type VerificationVerdict } from "@/lib/results/verification";
import type { CanonicalSport } from "@/lib/markets/canonicalMarkets";

/**
 * What to do with a fixture's accumulated observations.
 *
 * Pure, so the interesting cases — a provider revising a score after we
 * verified it, two observations disagreeing, a result arriving that changes
 * nothing — are testable without a database. The IO wrapper does exactly what
 * this returns and decides nothing itself.
 */

export type ResultIngestionDecision =
  | { action: "none"; reason: string }
  | { action: "insert"; result: CanonicalResult; verdict: VerificationVerdict }
  | { action: "supersede"; result: CanonicalResult; verdict: VerificationVerdict; correctionReason: string }
  | { action: "raise"; kind: string; detail: Record<string, unknown>; reason: string };

/** The score fields a correction is judged on. Everything else is annotation. */
function materialScore(result: CanonicalResult): string {
  return JSON.stringify([
    result.resultStatus,
    result.regulationHome,
    result.regulationAway,
    result.extraTimeHome,
    result.extraTimeAway,
    result.shootoutHome,
    result.shootoutAway,
    result.setsHome,
    result.setsAway,
    result.gamesHome,
    result.gamesAway,
    result.winner
  ]);
}

export function decideResultIngestion({
  sport,
  observations,
  parsed,
  existing,
  liveEventGoals = null,
  now
}: {
  sport: CanonicalSport;
  observations: ResultObservation[];
  /** The canonical result built from the latest observation. */
  parsed: CanonicalResult | null;
  /** The current result row, if one exists. */
  existing: CanonicalResult | null;
  liveEventGoals?: { home: number; away: number } | null;
  now: Date;
}): ResultIngestionDecision {
  if (!parsed) {
    return { action: "none", reason: "No observation parsed into a canonical result." };
  }

  const verdict = verifyResult({ sport, observations, liveEventGoals, now });

  if (!existing) {
    // Written at whatever state the ladder gave it, conflicted included. A
    // conflicted row is still the honest record of what we observed, and it
    // gives the exception something to point at instead of floating free.
    // `verdict.exception` travels with the decision for the caller to raise.
    return { action: "insert", result: { ...parsed, verificationState: verdict.state }, verdict };
  }

  const changed = materialScore(parsed) !== materialScore(existing);

  if (!changed) {
    // The score is the same. The verification state may still have moved — a
    // second observation arriving is exactly how `provisional` becomes
    // `verified` — and that is a revision worth writing.
    if (verdict.state !== existing.verificationState) {
      return {
        action: "supersede",
        result: { ...parsed, verificationState: verdict.state, revision: existing.revision + 1 },
        verdict,
        correctionReason: `Verification moved from ${existing.verificationState} to ${verdict.state}: ${verdict.reason}`
      };
    }
    return { action: "none", reason: "Result and verification state are unchanged." };
  }

  /**
   * The score changed under a result we had already verified.
   *
   * This is a provider correction, and it is the case that must never be a
   * silent overwrite: a settled claim was graded against the old number, and
   * the correction has to cascade into a superseding settlement rather than
   * making the original verdict look as though it was always this.
   */
  if (existing.verificationState === "verified") {
    return {
      action: "supersede",
      result: {
        ...parsed,
        verificationState: verdict.state,
        revision: existing.revision + 1
      },
      verdict,
      correctionReason:
        `Provider revised a verified result: ${describe(existing)} became ${describe(parsed)}. ` +
        "Any settlement produced from the previous revision must be re-settled."
    };
  }

  // Changed while still provisional. Not a correction to anything public — the
  // provider is simply still making up its mind — so it supersedes without the
  // correction language that would imply a public record moved.
  return {
    action: "supersede",
    result: { ...parsed, verificationState: verdict.state, revision: existing.revision + 1 },
    verdict,
    correctionReason: `Unverified result updated: ${describe(existing)} became ${describe(parsed)}.`
  };
}

function describe(result: CanonicalResult): string {
  const regulation =
    result.regulationHome === null || result.regulationAway === null
      ? "no regulation score"
      : `${result.regulationHome}-${result.regulationAway}`;
  const extra =
    result.extraTimeHome === null || result.extraTimeAway === null
      ? ""
      : ` (ET ${result.extraTimeHome}-${result.extraTimeAway})`;
  const shootout =
    result.shootoutHome === null || result.shootoutAway === null
      ? ""
      : ` (pens ${result.shootoutHome}-${result.shootoutAway})`;
  return `${result.resultStatus} ${regulation}${extra}${shootout}`;
}

/**
 * Whether a decision requires a re-settle of claims already graded.
 *
 * Only a correction to a result that was verified can invalidate a verdict; a
 * provisional result never produced one.
 */
export function requiresResettle(decision: ResultIngestionDecision, existing: CanonicalResult | null): boolean {
  return (
    decision.action === "supersede" &&
    existing?.verificationState === "verified" &&
    materialScore(decision.result) !== materialScore(existing)
  );
}
