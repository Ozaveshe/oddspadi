import { settle } from "@/lib/settlement/grade";
import type { CanonicalResult } from "@/lib/results/canonicalResult";
import type { CanonicalSelection } from "@/lib/workspace/selection";
import type { PersonalLegOutcome } from "@/lib/workspace/analysis";

/**
 * Personal settlement: grading a user's legs from canonical results.
 *
 * Two rules carry this file:
 *
 * 1. **Same grader as the official ledger.** A leg with a canonical selection
 *    key is settled by `settlement/grade.ts` — the exact engine that settles
 *    official publications. A user's Asian -0.25 half-loses under the same
 *    versioned rule an official pick would; two graders for one result is how
 *    a product ends up arguing with itself.
 *
 * 2. **Personal is not official.** These outcomes belong to the user's own
 *    record. They never enter `op_publications`, never count toward the
 *    OddsPadi track record, and the copy that presents them says whose record
 *    they are. `PERSONAL_RECORD_COPY` exists so every surface says it the
 *    same way.
 */

export const PERSONAL_RECORD_COPY =
  "This is your selection's result, settled from the verified match result. It is not part of the official OddsPadi track record — that record only contains picks OddsPadi published in advance.";

export type PersonalLegSettlement = {
  legId: string;
  outcome: PersonalLegOutcome;
  /** Profit per unit staked at the leg's odds; null while pending/ungradeable. */
  returnMultiple: number | null;
  detail: string;
};

/**
 * Grade one leg against a canonical result.
 *
 * A leg without a canonical key cannot be graded canonically — that is
 * `needs_review` with the reason stated, not a guess. A missing or unverified
 * result leaves the leg `pending`; the caller only passes verified results,
 * but stating the default here keeps the contract visible.
 */
export function gradePersonalLeg(
  selection: CanonicalSelection,
  result: CanonicalResult | null
): PersonalLegSettlement {
  if (!result) {
    return {
      legId: selection.legId,
      outcome: "pending",
      returnMultiple: null,
      detail: "No verified result yet."
    };
  }
  if (!selection.canonicalSelectionKey) {
    return {
      legId: selection.legId,
      outcome: "needs_review",
      returnMultiple: null,
      detail:
        "This market is outside the canonical settlement rules, so OddsPadi cannot grade it. The result shown for the match is unaffected."
    };
  }

  const graded = settle(result, { selectionKey: selection.canonicalSelectionKey });
  const returnMultiple =
    graded.outcome === "won"
      ? selection.userOdds - 1
      : graded.outcome === "half_won"
        ? (selection.userOdds - 1) / 2
        : graded.outcome === "half_lost"
          ? -0.5
          : graded.outcome === "lost"
            ? -1
            : graded.outcome === "needs_review"
              ? null
              : 0;

  return {
    legId: selection.legId,
    outcome: graded.outcome,
    returnMultiple,
    detail: graded.reason
  };
}

/**
 * Grade a set of legs from whatever verified results exist.
 *
 * Legs whose fixtures have not resolved stay pending; a partially settled
 * workspace is the normal state for a multi-day accumulator, not an error.
 */
export function gradePersonalLegs(
  selections: CanonicalSelection[],
  resultsByFixture: ReadonlyMap<string, CanonicalResult>
): PersonalLegSettlement[] {
  return selections.map((selection) => gradePersonalLeg(selection, resultsByFixture.get(selection.fixtureId) ?? null));
}

/**
 * The combined personal outcome, using accumulator conventions: any lost leg
 * loses the combination; voids and pushes drop out of the multiplication;
 * everything still pending keeps the combination pending.
 */
export function combinePersonalOutcomes(settlements: PersonalLegSettlement[]): {
  outcome: PersonalLegOutcome;
  detail: string;
} {
  if (!settlements.length) return { outcome: "pending", detail: "No legs to settle." };
  if (settlements.some((entry) => entry.outcome === "lost")) {
    return { outcome: "lost", detail: "At least one leg lost, which settles the combination." };
  }
  if (settlements.some((entry) => entry.outcome === "needs_review")) {
    return { outcome: "needs_review", detail: "A leg could not be graded canonically, so the combination cannot settle cleanly." };
  }
  if (settlements.some((entry) => entry.outcome === "pending")) {
    return { outcome: "pending", detail: "Some legs have not resolved yet." };
  }
  if (settlements.some((entry) => entry.outcome === "half_lost" || entry.outcome === "half_won")) {
    // Half outcomes make the combined return a multiplication, not a verdict;
    // present the legs rather than pretending a single word covers it.
    return {
      outcome: settlements.some((entry) => entry.outcome === "half_lost") ? "half_lost" : "half_won",
      detail: "A leg settled at a half outcome; the combined return multiplies the leg returns."
    };
  }
  if (settlements.every((entry) => entry.outcome === "void" || entry.outcome === "push")) {
    return { outcome: "void", detail: "Every leg voided or pushed; the combination returns the stake." };
  }
  return { outcome: "won", detail: "Every counted leg won." };
}
