import { describe, expect, it } from "vitest";
import type { DecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import type { LearnedWeightPromotionGovernor } from "@/lib/sports/training/learnedWeightPromotionGovernor";
import { buildLearnedWeightShadowComparison } from "@/lib/sports/training/learnedWeightShadowComparison";
import type { ShadowTrainingCandidates } from "@/lib/sports/training/shadowTrainingCandidates";

describe("learned-weight shadow governance", () => {
  it("computes research shadow scores while live promotion remains blocked", () => {
    const oddsBoard = {
      boardHash: "fnv1a-board",
      selections: [
        {
          id: "arsenal-coventry-away",
          sport: "football",
          matchId: "epl-2026-arsenal-coventry-city",
          match: "Arsenal vs Coventry",
          marketName: "Match winner",
          selection: "Coventry",
          action: "watch",
          edge: 0.12,
          expectedValue: 0.24,
          dataQualityScore: 82
        }
      ]
    } as unknown as DecisionOddsBoard;
    const shadowCandidates = {
      status: "ready-shadow",
      candidateHash: "fnv1a-candidate",
      candidates: [
        {
          sport: "football",
          status: "ready-shadow",
          learnedWeights: [
            { key: "minimumEdge", value: 0.055, status: "pass", application: "threshold" },
            { key: "valueEdgeWeight", value: 0.2885, status: "pass", application: "value" },
            { key: "dataQualityWeight", value: 0.18, status: "pass", application: "quality" },
            { key: "marketAdjustmentWeight", value: 0.16, status: "pass", application: "market" }
          ],
          nextAction: "Keep the candidate in research shadow mode."
        }
      ],
      totals: { learnedWeights: 4 },
      blockers: [],
      proofUrls: []
    } as unknown as ShadowTrainingCandidates;
    const promotionGovernor = {
      status: "waiting-governance",
      governorHash: "fnv1a-governor",
      decisions: [
        {
          sport: "football",
          status: "waiting-governance",
          nextAction: "Collect complete live provider features before promotion."
        }
      ],
      totals: { eligibleShadow: 0 },
      blockers: ["Live feature governance is pending."],
      proofUrls: []
    } as unknown as LearnedWeightPromotionGovernor;

    const comparison = buildLearnedWeightShadowComparison({
      date: "2026-08-21",
      oddsBoard,
      shadowCandidates,
      promotionGovernor,
      now: new Date("2026-07-10T00:00:00.000Z")
    });

    expect(comparison.status).toBe("ready-shadow");
    expect(comparison.rows[0]?.status).toBe("watch-only");
    expect(comparison.rows[0]?.learnedValueScore).toBeTypeOf("number");
    expect(comparison.rows[0]?.reason).toContain("research shadow review");
    expect(comparison.controls.canApplyLearnedWeightsToPredictions).toBe(false);
    expect(comparison.controls.canPublishPicks).toBe(false);
  });
});
