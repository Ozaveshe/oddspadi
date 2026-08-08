import { legacySelectionKey } from "@/lib/markets/legacyKeys";
import { canonicalSelection } from "@/lib/markets/canonicalMarkets";
import type { CanonicalSelection, LegEntryPoint } from "@/lib/workspace/selection";

/**
 * Leg resolution: the gate between what a user typed and what the workspace
 * analyses.
 *
 * Every analysable leg resolves to a fixture, a market, a selection and a
 * price with a timestamp. Free text resolves to none of those, so it is held
 * as an `UnresolvedEntry` — visible in the workspace, waiting for the user to
 * bind it to a real fixture and market, and **never** fed into probability
 * analysis. The failure this prevents: "Arsenal to win @ 1.8" analysed as if
 * it named a specific Saturday fixture, when three Arsenals play that week.
 */

export type UnresolvedEntry = {
  entryId: string;
  /** The user's text, kept verbatim so nothing is silently reinterpreted. */
  text: string;
  addedAt: string;
  reason: string;
};

/**
 * The structured payload an entry point supplies when adding a leg.
 *
 * Entry points (Today, Explore, Match Intelligence, an official publication,
 * a watchlist candidate, a supported import) have all of this on hand; manual
 * entry gathers it through pickers. What no entry point may do is fabricate
 * the fields it lacks — absent model data stays null and the leg analysis
 * says so.
 */
export type StructuredLegInput = {
  fixtureId: string;
  sport: "football" | "basketball" | "tennis" | null;
  marketId: string;
  selectionId: string;
  marketLine?: number | null;
  label: string;
  fixtureLabel: string;
  competition: string;
  source: string;
  entryPoint: LegEntryPoint;
  userOdds: number;
  oddsObservedAt: string | null;
  marketNoVigProbability?: number | null;
  modelProbability?: number | null;
  modelGeneratedAt?: string | null;
  decisionState?: CanonicalSelection["decisionState"];
  publicationId?: string | null;
  kickoffAt: string;
  fixtureStatus: CanonicalSelection["fixtureStatus"];
  marketSupported: boolean;
  modelInterval?: { low: number; high: number } | null;
};

export type ResolveResult =
  | { kind: "leg"; selection: CanonicalSelection }
  | { kind: "rejected"; reason: string };

/**
 * Resolve a structured input into an analysable leg.
 *
 * The canonical selection key is derived here, once, through the same legacy
 * bridge settlement uses — so the key a leg carries is the key its settlement
 * would grade against. A market outside the bridge yields a leg with a null
 * key: still carried, still priced, but excluded from platform conversion and
 * canonical settlement, with the exclusion stated.
 */
export function resolveStructuredLeg(input: StructuredLegInput, legId: string): ResolveResult {
  if (!input.fixtureId || !input.marketId || !input.selectionId) {
    return { kind: "rejected", reason: "A leg needs a fixture, a market and a selection. One of those is missing." };
  }
  if (!Number.isFinite(input.userOdds) || input.userOdds <= 1) {
    return { kind: "rejected", reason: "Odds must be a decimal price above 1.00." };
  }
  if (!input.kickoffAt || Number.isNaN(Date.parse(input.kickoffAt))) {
    return { kind: "rejected", reason: "A leg needs the event start time." };
  }

  const canonicalKey = input.sport
    ? legacySelectionKey({
        sport: input.sport,
        market: input.marketId,
        selection: input.selectionId,
        marketLine: input.marketLine ?? null
      })
    : null;

  return {
    kind: "leg",
    selection: {
      legId,
      fixtureId: input.fixtureId,
      marketId: input.marketId,
      selectionId: input.selectionId,
      canonicalSelectionKey: canonicalKey,
      sport: input.sport,
      marketLine: input.marketLine ?? null,
      label: input.label,
      fixtureLabel: input.fixtureLabel,
      competition: input.competition,
      source: input.source,
      entryPoint: input.entryPoint,
      userOdds: input.userOdds,
      oddsObservedAt: input.oddsObservedAt,
      marketNoVigProbability: input.marketNoVigProbability ?? null,
      modelProbability: input.modelProbability ?? null,
      modelGeneratedAt: input.modelGeneratedAt ?? null,
      decisionState: input.decisionState ?? null,
      publicationId: input.publicationId ?? null,
      kickoffAt: input.kickoffAt,
      fixtureStatus: input.fixtureStatus,
      marketSupported: input.marketSupported,
      modelInterval: input.modelInterval ?? null
    }
  };
}

/**
 * Free text becomes an unresolved entry, never a leg.
 *
 * There is no fuzzy matching here on purpose. Binding "Arsenal to win" to a
 * fixture is a user decision made through a picker with the real candidates
 * in front of them — not a string-similarity guess made on their behalf.
 */
export function holdUnresolvedText(text: string, entryId: string, addedAt: string): UnresolvedEntry {
  return {
    entryId,
    text: text.trim(),
    addedAt,
    reason:
      "This text has not been matched to a fixture and market yet, so it is not part of the analysis. Pick the exact fixture and market to include it."
  };
}

/** The canonical key's registry label, for display next to a resolved leg. */
export function canonicalKeyLabel(canonicalSelectionKey: string | null | undefined): string | null {
  if (!canonicalSelectionKey) return null;
  return canonicalSelection(canonicalSelectionKey)?.selection.label ?? null;
}
