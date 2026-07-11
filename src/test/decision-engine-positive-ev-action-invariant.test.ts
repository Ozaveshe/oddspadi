import { describe, expect, it } from "vitest";
import { buildDecisionEngineReport } from "@/lib/sports/prediction/decisionEngine";
import { modelFootballMatch } from "@/lib/sports/prediction/footballModel";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import type { BestPickResult, ValueEdge } from "@/lib/sports/types";

const valueVerdicts = ["strong-value", "lean-value"] as const;

function valueEdge(overrides: Partial<ValueEdge> = {}): ValueEdge {
  return {
    marketId: "match_winner",
    selectionId: "home",
    label: "Arsenal",
    modelProbability: 0.64,
    rawImpliedProbability: 0.5,
    noVigImpliedProbability: 0.48,
    impliedProbability: 0.48,
    bookmakerMargin: 0.05,
    edge: 0.16,
    expectedValue: 0.28,
    expectedRoi: 0.28,
    odds: 2,
    confidence: "high",
    risk: "low",
    ...overrides
  };
}

async function reportFor(bestPick: BestPickResult, valueEdges: ValueEdge[]) {
  const [match] = await mockSportsDataProvider.getFixtures("2026-06-24", "football");
  const model = modelFootballMatch(match);

  return buildDecisionEngineReport({
    match,
    markets: model.markets,
    diagnostics: model.diagnostics,
    bestPick,
    valueEdges
  });
}

describe("decision engine positive-EV action invariant", () => {
  it("abstains when no best pick passed the value selector", async () => {
    const report = await reportFor({ hasValue: false, label: "No clear value found" }, [valueEdge()]);

    expect(report.action).toBe("avoid");
    expect(valueVerdicts).not.toContain(report.verdict);
    expect(report.calibration.action).toBe("abstain");
    expect(report.recommendedSelection).toBeNull();
    expect(report.abstentionRules.find((rule) => rule.id === "no-positive-edge")?.triggered).toBe(true);
  });

  it("rejects a claimed value pick whose expected value is negative", async () => {
    const negativeEv = valueEdge({ expectedValue: -0.04, expectedRoi: -0.04 });
    const report = await reportFor({ ...negativeEv, hasValue: true }, [negativeEv]);

    expect(report.action).toBe("avoid");
    expect(valueVerdicts).not.toContain(report.verdict);
    expect(report.calibration.action).toBe("abstain");
    expect(report.recommendedSelection).toBeNull();
    expect(report.abstentionRules.find((rule) => rule.id === "no-positive-edge")?.triggered).toBe(true);
  });

  it("keeps raw positive EV on the watchlist when required production evidence is missing", async () => {
    const positiveEv = valueEdge();
    const report = await reportFor({ ...positiveEv, hasValue: true }, [positiveEv]);
    const requiredProductionBlockers = report.dataCoverage.signals.filter(
      (signal) => signal.requiredForProduction && ["mock", "missing", "stale"].includes(signal.status)
    );

    expect(positiveEv.expectedValue).toBeGreaterThan(0);
    expect(requiredProductionBlockers.length).toBeGreaterThan(0);
    expect(report.calibration.action).toBe("trust");
    expect(report.actionability.status).toBe("actionable");
    expect(report.action).toBe("monitor");
    expect(report.verdict).toBe("watchlist");
    expect(report.recommendedSelection).toBe(positiveEv.label);
    expect(report.abstentionRules.find((rule) => rule.id === "no-positive-edge")?.triggered).toBe(false);
  });
});
