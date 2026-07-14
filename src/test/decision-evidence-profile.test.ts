import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DecisionEvidenceProfile } from "@/components/odds/DecisionEvidenceProfile";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildPrediction } from "@/lib/sports/service";
import type { DecisionLearningProfile } from "@/lib/sports/types";

describe("public decision evidence profile", () => {
  it("never borrows another selection's factor trace for a different canonical candidate", async () => {
    const [match] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const prediction = buildPrediction(match);
    const trace = prediction.decision.probabilityTrace;
    const differentCandidate = prediction.canonicalDecision.allMarketAnalyses.find(
      (candidate) => candidate.marketId !== trace.marketId || candidate.label !== trace.selection
    );

    expect(differentCandidate).toBeDefined();
    const html = renderToStaticMarkup(createElement(DecisionEvidenceProfile, {
      decision: prediction.decision,
      publicCandidate: differentCandidate
    }));

    expect(html).toContain("Evidence for the public candidate");
    expect(html).toContain(differentCandidate!.label);
    expect(html).toContain("keeps their evidence separate");
    expect(html).toContain("intentionally not reused");
    expect(html).not.toContain("Decision factor contribution");
  });

  it("keeps the full factor and uncertainty charts when the canonical candidate owns the trace", async () => {
    const [match] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const prediction = buildPrediction(match);
    const trace = prediction.decision.probabilityTrace;
    const tracedCandidate = prediction.canonicalDecision.allMarketAnalyses.find(
      (candidate) => candidate.marketId === trace.marketId && candidate.label === trace.selection
    );

    expect(tracedCandidate).toBeDefined();
    const html = renderToStaticMarkup(createElement(DecisionEvidenceProfile, {
      decision: prediction.decision,
      publicCandidate: tracedCandidate
    }));

    expect(html).toContain("How the engine reached this view");
    expect(html).toContain("Decision factor contribution");
    expect(html).toContain("Decision-risk profile");
  });

  it("labels benchmark history as historical evidence instead of the runtime model", async () => {
    const [match] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const learningProfile: DecisionLearningProfile = {
      status: "shadow-only",
      source: "supabase:op_fixtures:real-only",
      active: false,
      modelKey: "football-poisson-elo-v1",
      engineVersion: "decision-engine-v1",
      modelCompatibility: "benchmark-only",
      sampleSize: 5000,
      testSize: 1500,
      realFinishedFixtures: 21694,
      minimumRecommendedFixtures: 1000,
      minimumEdge: null,
      valueEdgeWeight: null,
      dataQualityWeight: null,
      marketAdjustmentWeight: null,
      homeAdvantageElo: null,
      brierScore: 0.189308,
      logLoss: 0.959779,
      calibrationError: 0.035785,
      yield: 0.135221,
      closingLineValue: 0.001488,
      playerFormFixtures: null,
      playerFormCoverage: null,
      minimumPlayerFormCoverage: 0.6,
      calibrationBuckets: [],
      generatedAt: "2026-07-14T12:00:00.000Z",
      reason: "Latest run evaluates a benchmark model, not the live runtime model.",
      notes: []
    };
    const prediction = buildPrediction(match, { learningProfile });
    const html = renderToStaticMarkup(createElement(DecisionEvidenceProfile, { decision: prediction.decision }));

    expect(html).toContain("Historical evidence model");
    expect(html).toContain("football-poisson-elo-v1");
    expect(html).toContain("Runtime parity");
    expect(html).toContain("benchmark only");
    expect(html).toContain("Held-out sample");
    expect(html).toContain("Normalized Brier");
    expect(html).not.toContain("<dt>Runtime model</dt><dd>football-poisson-elo-v1</dd>");
  });
});
