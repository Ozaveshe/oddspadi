import { readPublicationsByIds, type OfficialPublicationSummary } from "@/lib/domain/canonicalReads";
import { countsTowardRecord } from "@/lib/domain/states";

/**
 * Editorial claims must survive contact with the ledger at render time.
 *
 * Stories used to recompute wins and losses from whatever rows the generator
 * happened to read, then bake the numbers into prose. That prose then aged:
 * if a pick was later corrected or retracted, the article kept asserting the
 * original count forever, and nothing in the system noticed.
 *
 * A story now records the publication ids it described. At render time those
 * ids are re-resolved and the claim is recomputed from the ledger. If the
 * ledger disagrees with what the story says, the reader sees a correction
 * notice rather than a stale assertion.
 */
export type EditorialClaim = {
  /** What the story asserted when it was written. */
  statedWins: number;
  statedLosses: number;
  statedGraded: number;
  /** The exact ledger rows the assertion was built from. */
  publicationIds: string[];
};

export type ClaimVerification = {
  status: "verified" | "corrected" | "unverifiable";
  /** Recomputed from the ledger right now. */
  currentWins: number;
  currentLosses: number;
  currentGraded: number;
  /** Ids that no longer resolve to a published claim. */
  missingIds: string[];
  /** Ids whose publication was corrected or retracted since publication. */
  amendedIds: string[];
  notice: string | null;
};

export function verifyClaimAgainstLedger(
  claim: EditorialClaim,
  publications: OfficialPublicationSummary[],
  availability: "complete" | "partial" | "confirmed_empty" | "unavailable" | "stale"
): ClaimVerification {
  if (availability === "unavailable") {
    return {
      status: "unverifiable",
      currentWins: 0,
      currentLosses: 0,
      currentGraded: 0,
      missingIds: [],
      amendedIds: [],
      // Not a correction: we could not check. Saying "corrected" here would be
      // as wrong as saying "verified".
      notice: "The publication ledger could not be read, so the figures in this article are unverified right now."
    };
  }

  const found = new Map(publications.map((publication) => [publication.publicationId, publication]));
  const missingIds = claim.publicationIds.filter((id) => !found.has(id));
  const amendedIds = publications
    .filter((publication) => publication.publicationStatus !== "published")
    .map((publication) => publication.publicationId);

  const scorable = publications.filter((publication) => publication.publicationStatus !== "retracted");
  const currentWins = scorable.filter((publication) => publication.settlementStatus === "won").length;
  const currentLosses = scorable.filter((publication) => publication.settlementStatus === "lost").length;
  const currentGraded = scorable.filter((publication) => countsTowardRecord(publication.settlementStatus)).length;

  const drifted =
    currentWins !== claim.statedWins || currentLosses !== claim.statedLosses || currentGraded !== claim.statedGraded;

  if (!drifted && !missingIds.length && !amendedIds.length) {
    return { status: "verified", currentWins, currentLosses, currentGraded, missingIds, amendedIds, notice: null };
  }

  const parts: string[] = [];
  if (drifted) {
    parts.push(
      `This article was written when the ledger showed ${claim.statedWins}-${claim.statedLosses} from ${claim.statedGraded} settled picks; it now shows ${currentWins}-${currentLosses} from ${currentGraded}.`
    );
  }
  if (amendedIds.length) {
    parts.push(`${amendedIds.length} referenced pick${amendedIds.length === 1 ? " has" : "s have"} since been corrected or retracted.`);
  }
  if (missingIds.length) {
    parts.push(`${missingIds.length} referenced publication${missingIds.length === 1 ? "" : "s"} could not be found in the ledger.`);
  }
  return {
    status: "corrected",
    currentWins,
    currentLosses,
    currentGraded,
    missingIds,
    amendedIds,
    notice: parts.join(" ")
  };
}

/** Server-side helper: resolve and verify in one call. */
export async function verifyEditorialClaim(claim: EditorialClaim | null): Promise<ClaimVerification | null> {
  if (!claim || !claim.publicationIds.length) return null;
  const page = await readPublicationsByIds(claim.publicationIds);
  return verifyClaimAgainstLedger(claim, page.items, page.availability);
}
