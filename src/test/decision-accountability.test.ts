import { describe, expect, it } from "vitest";
import { buildDecisionEvaluationPlan } from "@/lib/sports/prediction/decisionEvaluationPlan";
import { buildDecisionNotebook } from "@/lib/sports/prediction/decisionNotebook";
import { buildDecisionResearchBrief } from "@/lib/sports/prediction/decisionResearchBrief";
import { selectBestPick } from "@/lib/sports/prediction/odds";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildPrediction } from "@/lib/sports/service";
import type { NoValuePick } from "@/lib/sports/types";

const noValue: NoValuePick = { hasValue: false, label: "No clear value found" };

describe("decision accountability modules", () => {
  it("preserves evaluation, research, and notebook output across every supported sport", async () => {
    for (const sport of ["football", "basketball", "tennis"] as const) {
      const fixtures = await mockSportsDataProvider.getFixtures("2026-07-14", sport);
      const fixture = fixtures.find((item) => item.status === "live") ?? fixtures[0];
      const prediction = buildPrediction(fixture);
      const decision = prediction.decision;
      const bestPick = selectBestPick(prediction.valueEdges, { learningProfile: decision.learningProfile });
      const evaluationPlan = buildDecisionEvaluationPlan({
        match: fixture,
        bestPick,
        action: decision.action,
        monitoringPlan: decision.monitoringPlan,
        reviewLoop: decision.reviewLoop,
        robustness: decision.robustness,
        learningProfile: decision.learningProfile
      });
      const researchBrief = buildDecisionResearchBrief({
        match: fixture,
        bestPick,
        action: decision.action,
        summary: decision.summary,
        evidence: decision.evidence,
        missingSignals: decision.missingSignals,
        oddsIntelligence: decision.oddsIntelligence,
        dataCoverage: decision.dataCoverage,
        beliefState: decision.beliefState,
        deliberation: decision.deliberation,
        committee: decision.committee,
        monitoringPlan: decision.monitoringPlan,
        actionability: decision.actionability,
        reviewLoop: decision.reviewLoop,
        robustness: decision.robustness,
        evaluationPlan,
        caseMemory: decision.caseMemory,
        learningProfile: decision.learningProfile
      });
      const notebook = buildDecisionNotebook({
        match: fixture,
        bestPick,
        action: decision.action,
        missingSignals: decision.missingSignals,
        abstentionRules: decision.abstentionRules,
        dataCoverage: decision.dataCoverage,
        beliefState: decision.beliefState,
        monitoringPlan: decision.monitoringPlan,
        actionability: decision.actionability,
        reviewLoop: decision.reviewLoop,
        robustness: decision.robustness,
        evaluationPlan,
        caseMemory: decision.caseMemory,
        researchBrief,
        learningProfile: decision.learningProfile
      });

      expect(evaluationPlan, `${sport} evaluation`).toEqual(decision.evaluationPlan);
      expect(researchBrief, `${sport} research`).toEqual(decision.researchBrief);
      expect(notebook, `${sport} notebook`).toEqual(decision.notebook);
    }
  });

  it("keeps abstentions auditable and renders decision clocks deterministically", async () => {
    const fixture = (await mockSportsDataProvider.getFixtures("2026-07-14", "football"))[0];
    const prediction = buildPrediction(fixture);
    const decision = prediction.decision;
    const bestPick = selectBestPick(prediction.valueEdges, { learningProfile: decision.learningProfile });
    const abstentionPlan = buildDecisionEvaluationPlan({
      match: fixture,
      bestPick: noValue,
      action: "avoid",
      monitoringPlan: decision.monitoringPlan,
      reviewLoop: decision.reviewLoop,
      robustness: decision.robustness,
      learningProfile: decision.learningProfile
    });

    expect(abstentionPlan.status).toBe("no-action");
    expect(abstentionPlan.settlementSelection).toBeNull();
    expect(abstentionPlan.requiredOutcomeSignals.find((signal) => signal.id === "settled-result")?.status).toBe("pending");
    expect(abstentionPlan.requiredOutcomeSignals.find((signal) => signal.id === "calibration-outcome")?.status).toBe("required");
    expect(abstentionPlan.postMatchActions).toContain(
      "Store the settled outcome through the decision outcome endpoint with the linked decision_run_id."
    );

    const researchInput = {
      match: fixture,
      bestPick,
      action: decision.action,
      summary: decision.summary,
      evidence: decision.evidence,
      missingSignals: decision.missingSignals,
      oddsIntelligence: decision.oddsIntelligence,
      dataCoverage: decision.dataCoverage,
      beliefState: { ...decision.beliefState, expiresAt: "2026-07-14T12:30:00.000Z" },
      deliberation: decision.deliberation,
      committee: decision.committee,
      monitoringPlan: { ...decision.monitoringPlan, nextReviewAt: "2026-07-14T12:45:00.000Z" },
      actionability: decision.actionability,
      reviewLoop: decision.reviewLoop,
      robustness: decision.robustness,
      evaluationPlan: decision.evaluationPlan,
      caseMemory: decision.caseMemory,
      learningProfile: decision.learningProfile
    };
    expect(buildDecisionResearchBrief(researchInput).decisionClock).toBe(
      "Belief expires at 12:30 UTC; next review is 12:45 UTC."
    );
    expect(
      buildDecisionResearchBrief({
        ...researchInput,
        beliefState: { ...researchInput.beliefState, expiresAt: "invalid" },
        monitoringPlan: { ...researchInput.monitoringPlan, nextReviewAt: "invalid" }
      }).decisionClock
    ).toBe("Belief expires at unavailable; next review is unavailable.");
  });
});
