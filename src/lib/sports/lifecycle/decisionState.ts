import type { DecisionStatus, SettlementStatus } from "@/lib/domain/states";
import { isTerminalSettlement } from "@/lib/domain/states";
import type { FixtureLifecycleState } from "./fixtureState";
import type { PriceState } from "./priceState";

/**
 * Whether a decision is still something a visitor can act on.
 *
 * The decision *vocabulary* already existed — `DecisionStatus` says what the
 * engine concluded, `SettlementStatus` says how it turned out. Neither says
 * whether the conclusion is still usable **now**, and that was the gap: a pick
 * generated at 09:00 for a 15:00 kick-off is a different object at 14:59, at
 * 15:01 and at 21:00, and all three rendered identically.
 *
 * Three inputs, because a decision can go stale three ways that are not
 * interchangeable: its own expiry passes, the price under it moves, or the
 * match it is about stops being a match you can bet on. Collapsing them into
 * one "stale" flag loses the reason, and the reason is what the visitor needs.
 */

export type DecisionActionability =
  /** Live and usable. */
  | "actionable"
  /** Still standing, but the price behind it is no longer current. */
  | "price-moved"
  /** Past its own expiry. The conclusion may be fine; we will not stand behind it. */
  | "expired"
  /** The fixture is under way or over. Nothing to act on. */
  | "closed"
  /** Already settled. History. */
  | "settled"
  /** The engine did not publish a decision to act on. */
  | "no-decision";

export type DecisionTemporalFacts = {
  decisionStatus: DecisionStatus;
  settlementStatus?: SettlementStatus | null;
  generatedAt: Date;
  expiresAt?: Date | null;
  fixtureState: FixtureLifecycleState;
  priceState?: PriceState | null;
};

export type DecisionAssessment = {
  actionability: DecisionActionability;
  /** Fresh, unexpired, unsettled, on an upcoming fixture, with a live price. */
  actionable: boolean;
  /** May this decision back a public value claim? Stricter than actionable. */
  supportsClaim: boolean;
  ageMs: number;
  reason: string;
};

/** Conclusions that were never something to act on. */
const NON_ACTIONABLE: ReadonlySet<DecisionStatus> = new Set<DecisionStatus>(["pass", "withheld", "unavailable"]);

export function decisionState(facts: DecisionTemporalFacts, now: Date): DecisionAssessment {
  const ageMs = now.getTime() - facts.generatedAt.getTime();
  const assess = (actionability: DecisionActionability, reason: string): DecisionAssessment => ({
    actionability,
    actionable: actionability === "actionable",
    // A claim needs a live price behind it, not merely an open fixture. A
    // decision whose price has moved is still a legitimate opinion; it is not
    // evidence of an edge, because the edge was measured against a price that
    // is gone.
    supportsClaim: actionability === "actionable" && facts.priceState === "fresh",
    ageMs,
    reason
  });

  // Settlement outranks everything: once an outcome is known, no amount of
  // freshness makes the decision actionable again.
  if (facts.settlementStatus && isTerminalSettlement(facts.settlementStatus)) {
    return assess("settled", "This selection has been settled.");
  }

  if (NON_ACTIONABLE.has(facts.decisionStatus)) {
    return assess("no-decision", "The engine did not publish a selection for this market.");
  }

  // The fixture's own state comes before the decision's, because a decision
  // about a match that has kicked off is not late — it is moot.
  if (facts.fixtureState !== "scheduled") {
    return assess("closed", "This match is no longer open.");
  }

  if (facts.expiresAt && facts.expiresAt.getTime() <= now.getTime()) {
    return assess("expired", "This selection is past the window we will stand behind it for.");
  }

  // Price last, because it downgrades rather than disqualifies: the conclusion
  // still stands, the number under it does not.
  if (facts.priceState && facts.priceState !== "fresh") {
    return assess("price-moved", "The price behind this selection has moved.");
  }

  return assess("actionable", "Current.");
}

export const DECISION_ACTIONABILITY_COPY: Record<DecisionActionability, string> = {
  actionable: "Current",
  "price-moved": "Price moved",
  expired: "No longer current",
  closed: "Match closed",
  settled: "Settled",
  "no-decision": "No selection"
};
