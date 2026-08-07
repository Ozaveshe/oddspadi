import { describe, expect, it } from "vitest";

import { DECISION_ACTIONABILITY_COPY, decisionState } from "@/lib/sports/lifecycle/decisionState";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-08-06T12:00:00Z");

const decision = (overrides: Partial<Parameters<typeof decisionState>[0]> = {}) => ({
  decisionStatus: "pick" as const,
  generatedAt: at("2026-08-06T09:00:00Z"),
  fixtureState: "scheduled" as const,
  priceState: "fresh" as const,
  ...overrides
});

describe("a decision goes stale three ways, and the reason matters", () => {
  it("is actionable while everything holds", () => {
    const state = decisionState(decision(), NOW);
    expect(state.actionability).toBe("actionable");
    expect(state.actionable).toBe(true);
    expect(state.supportsClaim).toBe(true);
  });

  it("distinguishes a moved price from an expired selection", () => {
    // Collapsing these into one "stale" flag loses the reason, and the reason
    // is what a visitor needs: one says our opinion timed out, the other says
    // the number under it is gone.
    const moved = decisionState(decision({ priceState: "ageing" }), NOW);
    expect(moved.actionability).toBe("price-moved");

    const expired = decisionState(decision({ expiresAt: at("2026-08-06T11:00:00Z") }), NOW);
    expect(expired.actionability).toBe("expired");
  });

  it("treats a kicked-off match as moot rather than late", () => {
    for (const fixtureState of ["live", "due", "unresolved", "finished"] as const) {
      const state = decisionState(decision({ fixtureState }), NOW);
      expect(state.actionability, `${fixtureState} should close the decision`).toBe("closed");
    }
  });

  it("lets settlement outrank every kind of freshness", () => {
    const state = decisionState(
      decision({ settlementStatus: "won", generatedAt: at("2026-08-06T11:59:00Z") }),
      NOW
    );
    expect(state.actionability).toBe("settled");
  });

  it("says plainly when there was never a selection", () => {
    for (const decisionStatus of ["pass", "withheld", "unavailable"] as const) {
      expect(decisionState(decision({ decisionStatus }), NOW).actionability).toBe("no-decision");
    }
  });

  it("holds a claim to a stricter bar than actionability", () => {
    // A decision whose price moved is still a legitimate opinion. It is not
    // evidence of an edge, because the edge was measured against a price that
    // no longer exists.
    const moved = decisionState(decision({ priceState: "ageing" }), NOW);
    expect(moved.supportsClaim).toBe(false);

    const noPrice = decisionState(decision({ priceState: null }), NOW);
    expect(noPrice.actionable).toBe(true);
    expect(noPrice.supportsClaim, "no price is not evidence of an edge").toBe(false);
  });

  it("gives every actionability state public copy", () => {
    for (const [state, copy] of Object.entries(DECISION_ACTIONABILITY_COPY)) {
      expect(copy.length, `${state} has no copy`).toBeGreaterThan(0);
    }
  });
});
