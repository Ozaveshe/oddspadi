import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DecisionEvidenceProfile } from "@/components/odds/DecisionEvidenceProfile";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildPrediction } from "@/lib/sports/service";

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
});
