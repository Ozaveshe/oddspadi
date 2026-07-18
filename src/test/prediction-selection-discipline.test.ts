import { describe, expect, it } from "vitest";

import {
  BASELINE_MINIMUM_VALUE_EDGE,
  effectiveMinimumEdge,
  selectBestPick
} from "@/lib/sports/prediction/odds";
import type { ValueEdge } from "@/lib/sports/types";

function valueEdge(edge: number): ValueEdge {
  return {
    marketId: "match_winner",
    selectionId: "home",
    label: "Home",
    modelProbability: 0.53,
    rawImpliedProbability: 0.51,
    noVigImpliedProbability: 0.53 - edge,
    impliedProbability: 0.53 - edge,
    bookmakerMargin: 0.04,
    edge,
    expectedValue: 0.04,
    expectedRoi: 0.04,
    odds: 2,
    confidence: "medium",
    risk: "medium"
  };
}

describe("prediction selection discipline", () => {
  it("uses a conservative edge floor until governed learned thresholds are active", () => {
    expect(effectiveMinimumEdge()).toBe(BASELINE_MINIMUM_VALUE_EDGE);
    expect(selectBestPick([valueEdge(0.03)])).toEqual({
      hasValue: false,
      label: "No clear value found"
    });
    expect(selectBestPick([valueEdge(0.04)])).toMatchObject({
      hasValue: true,
      edge: 0.04,
      scoreComponents: {
        learnedMinimumEdge: null,
        effectiveMinimumEdge: BASELINE_MINIMUM_VALUE_EDGE
      }
    });
  });
});
