import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDecisionBeliefState } from "@/lib/sports/prediction/decisionBeliefState";
import { buildDecisionEvidence } from "@/lib/sports/prediction/decisionEvidence";
import { buildDecisionAttribution } from "@/lib/sports/prediction/decisionAttribution";
import { selectBestPick } from "@/lib/sports/prediction/odds";
import {
  buildDecisionMarketMovement,
  buildDecisionOddsIntelligence,
  edgeAfterOddsMultiplier
} from "@/lib/sports/prediction/decisionMarketIntelligence";
import { buildDecisionBoundary } from "@/lib/sports/prediction/decisionBoundary";
import { buildDecisionRobustnessAudit } from "@/lib/sports/prediction/decisionRobustness";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildPrediction } from "@/lib/sports/service";
import type {
  DecisionCalibration,
  DecisionCaseMemory,
  DecisionEvidence,
  FootballModelDiagnostics,
  Match,
  NoValuePick
} from "@/lib/sports/types";

const match: Match = {
  id: "boundary-fixture",
  sport: "football",
  league: { id: "test-league", name: "Test League", country: "Test", strength: 0.8 },
  kickoffTime: "2026-07-14T13:30:00.000Z",
  homeTeam: { id: "home", name: "Home", rating: 80 },
  awayTeam: { id: "away", name: "Away", rating: 78 },
  status: "scheduled",
  oddsMarkets: [],
  homeForm: { teamId: "home", recentResults: [], goalsFor: 0, goalsAgainst: 0, attackStrength: 1, defenseStrength: 1 },
  awayForm: { teamId: "away", recentResults: [], goalsFor: 0, goalsAgainst: 0, attackStrength: 1, defenseStrength: 1 },
  dataQualityScore: 0.8
};

const diagnostics: FootballModelDiagnostics = {
  modelVersion: "test-model",
  expectedGoals: { home: 1.3, away: 1.1, total: 2.4 },
  topCorrectScores: [],
  homeDrawAwayTotal: 1,
  dataQualityScore: 0.8,
  uncertainty: "medium",
  signalScores: [],
  calibrationNotes: []
};

const noValue: NoValuePick = { hasValue: false, label: "No clear value found" };
const calibration: DecisionCalibration = {
  reliabilityScore: 58,
  health: "review",
  action: "discount",
  detail: "Calibration requires review."
};
const caseMemory: DecisionCaseMemory = {
  status: "no-memory",
  configured: true,
  sampleSize: 0,
  similarCases: [],
  actionMix: { consider: 0, monitor: 0, avoid: 0 },
  averageSimilarity: null,
  averageReliabilityScore: null,
  averageDecisionScore: null,
  adjustment: "none",
  summary: "No comparable settled cases.",
  notes: []
};
const evidence: DecisionEvidence[] = [
  { category: "model", label: "Model evidence", quality: "acceptable", impact: "positive", detail: "Model supports the home side." },
  { category: "lineups", label: "Confirmed lineups", quality: "missing", impact: "unknown", detail: "Lineups are not confirmed." }
];

describe("decision engine module boundaries", () => {
  it("builds deterministic belief expiry and explicit unavailable calibration outside the orchestrator", () => {
    const generatedAt = new Date("2026-07-14T12:00:00.000Z");
    const belief = buildDecisionBeliefState({
      match,
      diagnostics,
      bestPick: noValue,
      evidence,
      missingSignals: ["Confirmed lineups"],
      contradictionChecks: [],
      abstentionRules: [],
      calibration,
      action: "monitor",
      caseMemory,
      generatedAt
    });

    expect(belief.generatedAt).toBe("2026-07-14T12:00:00.000Z");
    expect(belief.ttlMinutes).toBe(30);
    expect(belief.expiresAt).toBe("2026-07-14T12:30:00.000Z");
    expect(belief.grade).toBe("moderate");
    expect(belief.evidenceBalance).toEqual({ supports: 1, opposes: 1, uncertain: 3 });
    expect(belief.confidenceInterval.method).toBe("unavailable");
    expect(belief.confidenceInterval.detail).toBe("No selected runtime probability is available for an empirical calibration interval.");
    expect(belief.invalidationTriggers[0]).toContain("fresh odds create a positive no-vig edge");
  });

  it("keeps belief and diagnostic uncertainty calculations out of the report orchestrator", () => {
    const engine = readFileSync("src/lib/sports/prediction/decisionEngine.ts", "utf8");
    expect(engine).toContain('import { buildDecisionBeliefState } from "./decisionBeliefState"');
    expect(engine).toContain('import { buildDecisionUncertaintyDecomposition } from "./decisionUncertainty"');
    expect(engine).not.toContain("function buildDecisionBeliefState(");
    expect(engine).not.toContain("function buildDecisionUncertaintyDecomposition(");
    expect(engine).toContain('import { buildDecisionEvidence, findCoreModelContextSignal, hasLiveInPlayModel } from "./decisionEvidence"');
    expect(engine).toContain('import { buildDecisionAttribution } from "./decisionAttribution"');
    expect(engine).not.toContain("function buildDecisionEvidence(");
    expect(engine).not.toContain("function buildDecisionAttribution(");
    expect(engine).toContain('from "./decisionMarketIntelligence"');
    expect(engine).not.toContain("function buildDecisionOddsIntelligence(");
    expect(engine).not.toContain("function buildDecisionMarketMovement(");
    expect(engine).toContain('import { buildDecisionBoundary } from "./decisionBoundary"');
    expect(engine).toContain('import { buildDecisionRobustnessAudit } from "./decisionRobustness"');
    expect(engine).not.toContain("function buildDecisionBoundary(");
    expect(engine).not.toContain("function buildDecisionRobustnessAudit(");
    expect(engine.split(/\r?\n/).length).toBeLessThan(4800);
  });

  it("preserves evidence and attribution output across football, basketball, and tennis", async () => {
    for (const sport of ["football", "basketball", "tennis"] as const) {
      const fixtures = await mockSportsDataProvider.getFixtures("2026-07-14", sport);
      const fixture = fixtures.find((item) => item.status === "live") ?? fixtures[0];
      const prediction = buildPrediction(fixture);
      const decision = prediction.decision;
      const selectedPick = selectBestPick(prediction.valueEdges, { learningProfile: decision.learningProfile });

      const rebuiltEvidence = buildDecisionEvidence({
        match: fixture,
        markets: prediction.markets,
        diagnostics: prediction.diagnostics,
        bestPick: selectedPick,
        contextAdjustment: decision.contextAdjustment
      });
      const rebuiltAttribution = buildDecisionAttribution({
        bestPick: selectedPick,
        action: decision.action,
        probabilityTrace: decision.probabilityTrace,
        oddsIntelligence: decision.oddsIntelligence,
        marketMovement: decision.marketMovement,
        dataCoverage: decision.dataCoverage,
        caseMemory: decision.caseMemory,
        calibration: decision.calibration,
        abstentionRules: decision.abstentionRules,
        actionability: decision.actionability,
        reviewLoop: decision.reviewLoop
      });
      const rebuiltOddsIntelligence = buildDecisionOddsIntelligence({ match: fixture, valueEdges: prediction.valueEdges });
      const rebuiltRobustness = buildDecisionRobustnessAudit({
        bestPick: selectedPick,
        action: decision.action,
        diagnostics: prediction.diagnostics,
        missingSignals: decision.missingSignals,
        monitoringPlan: decision.monitoringPlan,
        actionability: decision.actionability,
        reviewLoop: decision.reviewLoop,
        saferAlternatives: decision.saferAlternatives
      });
      const rebuiltBoundary = buildDecisionBoundary({
        diagnostics: prediction.diagnostics,
        bestPick: selectedPick,
        action: decision.action,
        decisionScore: decision.decisionScore,
        learningProfile: decision.learningProfile,
        probabilityTrace: decision.probabilityTrace,
        marketMovement: decision.marketMovement,
        dataCoverage: decision.dataCoverage,
        uncertainty: decision.uncertainty,
        robustness: rebuiltRobustness,
        abstentionRules: decision.abstentionRules
      });

      expect(rebuiltEvidence, `${sport} evidence`).toEqual(decision.evidence);
      expect(rebuiltAttribution, `${sport} attribution`).toEqual(decision.attribution);
      expect(rebuiltOddsIntelligence, `${sport} odds intelligence`).toEqual(decision.oddsIntelligence);
      expect(rebuiltRobustness, `${sport} robustness`).toEqual(decision.robustness);
      expect(rebuiltBoundary, `${sport} boundary`).toEqual(decision.decisionBoundary);
      expect(rebuiltAttribution.valueScore).toBeGreaterThanOrEqual(0);
      expect(rebuiltAttribution.riskScore).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps price stress arithmetic explicit and fails closed without a priced candidate", () => {
    const noMarket = buildDecisionMarketMovement({ bestPick: noValue, action: "avoid" });
    expect(noMarket).toMatchObject({
      status: "no-market",
      currentOdds: null,
      currentEdge: null,
      maxShorteningBeforeNoValue: null,
      nextAction: "Refresh bookmaker markets and rerun value-edge ranking."
    });
    expect(noMarket.alerts).toContain("No priced candidate is available; do not manufacture market movement intelligence.");

    const priced = {
      hasValue: true as const,
      marketId: "match_winner" as const,
      selectionId: "home",
      label: "Home",
      modelProbability: 0.6,
      rawImpliedProbability: 0.5,
      noVigImpliedProbability: 0.5 / 1.04,
      impliedProbability: 0.5,
      bookmakerMargin: 0.04,
      edge: 0.6 - 0.5 / 1.04,
      expectedValue: 0.2,
      expectedRoi: 0.2,
      odds: 2,
      confidence: "high" as const,
      risk: "medium" as const
    };
    const movement = buildDecisionMarketMovement({ bestPick: priced, action: "consider" });
    const fivePercent = movement.scenarios.find((scenario) => scenario.id === "five-percent-shortening");

    expect(edgeAfterOddsMultiplier(priced, 1)).toBeCloseTo(priced.edge, 10);
    expect(movement.currentOdds).toBe(2);
    expect(movement.fairOdds).toBeCloseTo(1 / 0.6, 10);
    expect(movement.maxShorteningBeforeNoValue).toBeCloseTo(1 - (1 / 0.6) / 2, 10);
    expect(fivePercent?.odds).toBeCloseTo(1.9, 10);
    expect(fivePercent?.expectedValue).toBeCloseTo(0.14, 10);
  });

  it("keeps robustness shocks mathematically traceable and decision boundaries measurable", async () => {
    const fixture = (await mockSportsDataProvider.getFixtures("2026-07-14", "football"))[0];
    const prediction = buildPrediction(fixture);
    const decision = prediction.decision;
    const priced = {
      hasValue: true as const,
      marketId: "match_winner" as const,
      selectionId: "home",
      label: "Home",
      modelProbability: 0.6,
      rawImpliedProbability: 0.5,
      noVigImpliedProbability: 0.5 / 1.04,
      impliedProbability: 0.5,
      bookmakerMargin: 0.04,
      edge: 0.6 - 0.5 / 1.04,
      expectedValue: 0.2,
      expectedRoi: 0.2,
      odds: 2,
      confidence: "high" as const,
      risk: "medium" as const
    };
    const robustness = buildDecisionRobustnessAudit({
      bestPick: priced,
      action: "consider",
      diagnostics,
      missingSignals: [],
      monitoringPlan: decision.monitoringPlan,
      actionability: decision.actionability,
      reviewLoop: decision.reviewLoop,
      saferAlternatives: decision.saferAlternatives
    });

    for (const stress of robustness.cases) {
      expect(stress.edgeAfterShock, stress.id).toBeCloseTo(priced.edge + stress.probabilityShift, 10);
      expect(stress.expectedValueAfterShock, stress.id).toBeCloseTo(priced.expectedValue + stress.probabilityShift * priced.odds, 10);
    }

    const boundary = buildDecisionBoundary({
      diagnostics,
      bestPick: priced,
      action: "consider",
      decisionScore: 50,
      probabilityTrace: {
        ...decision.probabilityTrace,
        posteriorProbability: priced.modelProbability,
        posteriorEdge: priced.edge,
        posteriorExpectedValue: priced.expectedValue
      },
      marketMovement: buildDecisionMarketMovement({ bestPick: priced, action: "consider" }),
      dataCoverage: decision.dataCoverage,
      uncertainty: decision.uncertainty,
      robustness,
      abstentionRules: []
    });
    const probabilityFloor = boundary.metrics.find((metric) => metric.id === "probability-floor");
    const oddsFloor = boundary.metrics.find((metric) => metric.id === "odds-floor");

    expect(probabilityFloor).toMatchObject({ current: 0.6, threshold: 0.5, status: "safe" });
    expect(probabilityFloor?.margin).toBeCloseTo(0.1, 10);
    expect(oddsFloor?.threshold).toBeCloseTo(1 / 0.6, 10);
    expect(oddsFloor?.margin).toBeCloseTo(2 - 1 / 0.6, 10);

    const unavailable = buildDecisionRobustnessAudit({
      bestPick: noValue,
      action: "avoid",
      diagnostics,
      missingSignals: [],
      monitoringPlan: decision.monitoringPlan,
      actionability: decision.actionability,
      reviewLoop: decision.reviewLoop,
      saferAlternatives: []
    });
    expect(unavailable.survivalRate).toBe(0);
    expect(unavailable.cases.every((stress) => stress.status === "breaks")).toBe(true);
    expect(unavailable.cases.every((stress) => stress.edgeAfterShock === null && stress.expectedValueAfterShock === null)).toBe(true);
  });
});
