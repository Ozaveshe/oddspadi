import { describe, expect, it } from "vitest";
import { buildDecisionEvidenceBundle } from "@/lib/sports/prediction/decisionEvidenceBundle";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildPrediction } from "@/lib/sports/service";

async function providerPrediction() {
  const [match] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
  const providerMatch = {
    ...match,
    dataSource: {
      ...match.dataSource,
      kind: "provider" as const,
      fixtureProvider: "api-football",
      fixtureProviderId: "fixture-123",
      oddsProvider: "the-odds-api",
      oddsProviderEventId: "odds-123",
      fetchedAt: "2026-08-21T08:00:00.000Z"
    }
  };
  return { match: providerMatch, prediction: buildPrediction(providerMatch) };
}

describe("decision evidence bundle", () => {
  it("captures normalized inputs, provider lineage, model state, and decision output", async () => {
    const { match, prediction } = await providerPrediction();
    const bundle = buildDecisionEvidenceBundle({ match, prediction });

    expect(bundle.schemaVersion).toBe("decision-evidence-bundle-v1");
    expect(bundle.evidenceHash).toMatch(/^fnv1a-[a-f0-9]{8}$/);
    expect(bundle.decisionHash).toMatch(/^fnv1a-[a-f0-9]{8}$/);
    expect(bundle.inputSnapshot.normalizedMatch).toEqual(match);
    expect(bundle.sourceManifest).toMatchObject({
      sourceKind: "provider",
      fixtureProvider: "api-football",
      fixtureProviderId: "fixture-123",
      oddsProvider: "the-odds-api",
      oddsProviderEventId: "odds-123",
      hasProviderEvidence: true
    });
    expect(bundle.marketSnapshot.bestPick).toEqual(prediction.bestPick);
    expect(bundle.modelSnapshot.caseMemory).toEqual(prediction.decision.caseMemory);
    expect(bundle.contextSnapshot.evidence).toEqual(prediction.decision.evidence);
    expect(bundle.decisionSnapshot.aiReview).toBeNull();
  });

  it("keeps transport timestamps out of the evidence identity while retaining them in the audit snapshot", async () => {
    const { match, prediction } = await providerPrediction();
    const first = buildDecisionEvidenceBundle({ match, prediction });
    const refetched = buildDecisionEvidenceBundle({
      match: {
        ...match,
        dataSource: match.dataSource ? { ...match.dataSource, fetchedAt: "2026-08-21T08:05:00.000Z" } : undefined
      },
      prediction: { ...prediction, generatedAt: "2026-08-21T08:05:00.000Z" }
    });

    expect(refetched.evidenceHash).toBe(first.evidenceHash);
    expect((refetched.inputSnapshot.normalizedMatch as { dataSource?: { fetchedAt?: string } }).dataSource?.fetchedAt).toBe(
      "2026-08-21T08:05:00.000Z"
    );
  });

  it("creates a new evidence identity for case-memory changes and a new decision revision for a reviewed output", async () => {
    const { match, prediction } = await providerPrediction();
    const base = buildDecisionEvidenceBundle({ match, prediction });
    const memoryAdjusted = buildDecisionEvidenceBundle({
      match,
      prediction: {
        ...prediction,
        decision: {
          ...prediction.decision,
          caseMemory: {
            ...prediction.decision.caseMemory,
            sampleSize: prediction.decision.caseMemory.sampleSize + 1,
            summary: "A new settled case changed the reliability adjustment."
          }
        }
      }
    });
    const reviewed = buildDecisionEvidenceBundle({
      match,
      prediction,
      aiReview: {
        requested: true,
        provider: "openai",
        status: "reviewed",
        model: "gpt-5.5",
        reason: null,
        review: {
          reviewVerdict: "downgrade",
          recommendedAction: "monitor",
          confidenceAdjustment: "lower",
          riskAdjustment: "raise",
          summary: "Provider context needs a final lineup check.",
          rationale: ["Lineup uncertainty is material."],
          riskFlags: ["Late team news can move the market."],
          dataGaps: ["Confirmed lineups"],
          saferAlternatives: ["Wait for team news."],
          checksBeforeAction: ["Refresh the odds."],
          auditSummary: "The review found a material context gap.",
          evidenceChecks: [],
          safetyGates: [],
          unsupportedClaims: []
        }
      }
    });

    expect(memoryAdjusted.evidenceHash).not.toBe(base.evidenceHash);
    expect(reviewed.evidenceHash).toBe(base.evidenceHash);
    expect(reviewed.decisionHash).not.toBe(base.decisionHash);
    expect(reviewed.decisionSnapshot.aiReview).toMatchObject({ provider: "openai", status: "reviewed", model: "gpt-5.5" });
  });
});
