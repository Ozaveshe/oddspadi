import { createHash } from "node:crypto";
import type { MarketAlias } from "@/lib/markets/alias";

/**
 * The pre-approval impact preview, and the token that makes it a gate rather
 * than a display.
 *
 * An analyst reads "3 fixtures affected", a sweep lands 400 more, and the
 * approval goes through against a number that was true a minute ago. The token
 * closes that window: it hashes the counts and the alias body the analyst was
 * shown, and approval requires it to still match.
 */

export type MappingImpact = {
  fixturesAffected: number;
  oddsSnapshotsAffected: number;
  decisionsAffected: number;
  betWorkspacesAffected: number;
  unsettledPublicationsAffected: number;
  /** Published claims on the affected key, which make this a public correction. */
  officialPublicationsAffected: number;
};

export type ImpactPreview = {
  impact: MappingImpact;
  impactToken: string;
  reviewRequired: boolean;
  reviewReasons: string[];
};

export const FIXTURES_REVIEW_THRESHOLD = 50;

/**
 * Hash the counts together with the parts of the alias that change meaning.
 *
 * Deliberately not the whole alias: `notes` and `confidence` can be edited
 * between preview and approval without changing what the mapping does, and
 * forcing a re-preview for a typo fix trains people to click through.
 */
export function impactToken(alias: MarketAlias, impact: MappingImpact): string {
  const material = JSON.stringify({
    provider: alias.provider,
    sourceSport: alias.sourceSport,
    rawMarket: alias.rawMarket,
    rawSelection: alias.rawSelection,
    rawLine: alias.rawLine,
    participantOrder: alias.participantOrder,
    canonicalSelectionKey: alias.canonicalSelectionKey,
    mappingState: alias.mappingState,
    conditions: [...alias.conditions].sort(),
    impact
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

export type ReviewContext = {
  alias: MarketAlias;
  impact: MappingImpact;
  /** Active aliases already recorded for this provider. */
  providerAliasCount: number;
  /** Parser version the ingestion run currently emits. */
  currentParserVersion: string | null;
  /** Parser version the alias was built against. */
  aliasParserVersion: string | null;
};

/**
 * Whether a second recorded actor must approve.
 *
 * Parser drift is the quietest of the five: nothing about the alias changed,
 * and the mapping was correct against the text the old parser produced.
 */
export function reviewRequirements(context: ReviewContext): { required: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const { alias, impact } = context;

  if (impact.officialPublicationsAffected > 0) {
    reasons.push(
      `${impact.officialPublicationsAffected} official publication(s) exist on this key; a change here is a correction to a public record.`
    );
  }
  if (impact.fixturesAffected > FIXTURES_REVIEW_THRESHOLD) {
    reasons.push(`${impact.fixturesAffected} fixtures affected, above the ${FIXTURES_REVIEW_THRESHOLD} threshold.`);
  }
  if (context.providerAliasCount === 0) {
    reasons.push(`${alias.provider} has no active aliases yet; a new provider is reviewed in full.`);
  }
  if (
    context.currentParserVersion !== null &&
    context.aliasParserVersion !== null &&
    context.currentParserVersion !== context.aliasParserVersion
  ) {
    reasons.push(
      `Parser drift: the alias was built against ${context.aliasParserVersion}, ingestion now emits ${context.currentParserVersion}.`
    );
  }
  if (alias.mappingState === "different_settlement") {
    reasons.push("Mapping declares differing settlement, which cannot be approved without a second reader.");
  }
  if (alias.mappingState === "conditionally_equivalent") {
    reasons.push(
      `Mapping is equivalent only under ${alias.conditions.length || "unrecorded"} condition(s); a second reader confirms they hold.`
    );
  }

  return { required: reasons.length > 0, reasons };
}

export type ApprovalRequest = {
  alias: MarketAlias;
  actor: string;
  suppliedToken: string;
  currentImpact: MappingImpact;
  review: { required: boolean; reasons: string[] };
};

export type ApprovalDecision =
  | { status: "approved" }
  | { status: "refused"; reason: string; freshImpact?: MappingImpact };

export function decideApproval(request: ApprovalRequest): ApprovalDecision {
  const expected = impactToken(request.alias, request.currentImpact);
  if (request.suppliedToken !== expected) {
    return {
      status: "refused",
      reason: "The impact preview is stale: the underlying counts or the alias changed since it was generated. Re-read the preview and approve against the current numbers.",
      freshImpact: request.currentImpact
    };
  }

  // Self-approval is refused on the recorded actor. The admin surface holds one
  // shared token and has no per-analyst identity, so this is accountability
  // rather than access control — but an unreviewed approval is then visible in
  // the trail instead of indistinguishable from a reviewed one.
  if (request.review.required && request.actor === request.alias.createdBy) {
    return {
      status: "refused",
      reason: `This mapping requires a second reader: ${request.review.reasons.join(" ")}`
    };
  }

  return { status: "approved" };
}
