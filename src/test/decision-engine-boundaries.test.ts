import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDecisionBeliefState } from "@/lib/sports/prediction/decisionBeliefState";
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
    expect(engine.split(/\r?\n/).length).toBeLessThan(6100);
  });
});
