import { describe, expect, it } from "vitest";
import { buildDecisionOutcomeSettlement } from "@/lib/sports/prediction/decisionOutcomeSettlement";
import { getHistorySummary, isPublicAccuracyEligible, type PublicPredictionHistoryItem } from "@/lib/sports/prediction/history";
import { summarizeResultsBackfill } from "@/lib/sports/results/backfill";
import {
  buildPublicPickKey,
  buildPublicPickPublicationMetadata,
  dedupePublicPickDrafts,
  isCanonicalPublicPickEligible,
  type PublicPickDraft
} from "@/lib/sports/results/publicPicks";
import { resolvePublicPickSettlement, type SettleablePublicPick } from "@/lib/sports/results/settlement";
import type { CanonicalDecision } from "@/lib/sports/intelligence/types";
import type { DecisionSummary } from "@/lib/sports/types";

const now = new Date("2026-07-14T12:00:00.000Z");

function pick(overrides: Partial<SettleablePublicPick> = {}): SettleablePublicPick {
  return {
    id: "pick-1", fixtureId: "api-football:1", sport: "football", kickoffAt: "2026-07-13T18:00:00.000Z",
    market: "both_teams_to_score", selection: "yes", marketLine: null, odds: 1.9, modelProbability: 0.62,
    impliedProbability: 0.526, valueEdge: 0.094, status: "published", settlementStatus: "awaiting_final_score",
    result: "pending", finalStatusObservedAt: "2026-07-14T10:00:00.000Z", closingOdds: 1.82, ...overrides
  };
}

function draft(overrides: Partial<PublicPickDraft> = {}): PublicPickDraft {
  return {
    fixtureId: "api-football:1", fixtureDbId: "fixture-db-1", predictionRunId: "run-1", publicDecisionId: "decision-1",
    sport: "football", league: "NPFL", country: "Nigeria", homeTeam: "Kano Pillars", awayTeam: "Enyimba",
    kickoffAt: "2026-07-14T18:00:00.000Z", market: "both_teams_to_score", selection: "yes", selectionLabel: "Yes",
    marketLine: null, odds: 1.9, modelVersion: "football-v1", engineVersion: "engine-v1", modelProbability: 0.62,
    impliedProbability: 0.526, noVigProbability: 0.51, valueEdge: 0.11, expectedValue: 0.178, confidence: "medium",
    risk: "medium", publishedAt: "2026-07-14T09:00:00.000Z", publishedDate: "2026-07-14", status: "published",
    settlementStatus: "waiting_kickoff", result: "pending", settlementReason: "Waiting for kickoff.", provider: "api-football",
    providerFixtureId: "1", revision: 1, ...overrides
  };
}

describe("public results credibility", () => {
  it("settles finished football BTTS Yes won when both teams score", () => {
    const result = buildDecisionOutcomeSettlement({ fixtureExternalId: "f1", sport: "football", market: "both_teams_to_score", selection: "yes", homeScore: 2, awayScore: 1 });
    expect(result.result).toBe("won");
  });

  it("settles finished football BTTS Yes lost when one team does not score", () => {
    const result = buildDecisionOutcomeSettlement({ fixtureExternalId: "f1", sport: "football", market: "both_teams_to_score", selection: "yes", homeScore: 2, awayScore: 0 });
    expect(result.result).toBe("lost");
  });

  it("settles Over 2.5 correctly", () => {
    expect(buildDecisionOutcomeSettlement({ fixtureExternalId: "f1", sport: "football", market: "over_under_25", selection: "over_25", homeScore: 2, awayScore: 1 }).result).toBe("won");
    expect(buildDecisionOutcomeSettlement({ fixtureExternalId: "f2", sport: "football", market: "over_under_25", selection: "over_25", homeScore: 1, awayScore: 1 }).result).toBe("lost");
  });

  it("settles football 1X2 correctly", () => {
    expect(buildDecisionOutcomeSettlement({ fixtureExternalId: "f1", sport: "football", market: "match_winner", selection: "draw", homeScore: 1, awayScore: 1 }).result).toBe("won");
    expect(buildDecisionOutcomeSettlement({ fixtureExternalId: "f2", sport: "football", market: "match_winner", selection: "away", homeScore: 3, awayScore: 1 }).result).toBe("lost");
  });

  it("voids a cancelled match", () => {
    const result = resolvePublicPickSettlement(pick(), { fixtureId: "api-football:1", providerBacked: true, status: "cancelled", homeScore: null, awayScore: null, statusDetail: "CANC", observedAt: now.toISOString() }, now);
    expect(result).toMatchObject({ result: "void", settlementStatus: "void", status: "void" });
  });

  it("moves an old unresolved match to manual review instead of pending forever", () => {
    const result = resolvePublicPickSettlement(pick({ kickoffAt: "2026-07-12T10:00:00.000Z" }), null, now);
    expect(result.settlementStatus).toBe("needs_manual_review");
    expect(result.settlementReason).toContain("24 hours");
  });

  it("deduplicates the canonical public pick key", () => {
    const older = draft();
    const newer = draft({ publishedAt: "2026-07-14T10:00:00.000Z", odds: 1.95 });
    expect(buildPublicPickKey(older)).toBe(buildPublicPickKey(newer));
    expect(dedupePublicPickDrafts([older, newer])).toEqual([newer]);
  });

  it("stores an auditable publication-time quote, consensus, and economic floor receipt", () => {
    const metadata = buildPublicPickPublicationMetadata(draft({
      publicationEvidence: {
        executionQuote: {
          bookmakerId: "book-1",
          bookmakerName: "Example Book",
          observedAt: "2026-07-14T08:59:00.000Z",
          method: "best-executable-price",
          decimalOdds: 1.9
        },
        marketConsensus: {
          independentBookmakers: 4,
          maxProbabilitySpread: 0.045,
          noVigProbability: 0.51
        },
        economicConfidence: {
          status: "verified",
          method: "wilson-calibration-bucket",
          confidenceLevel: 0.95,
          sampleSize: 80,
          source: "calibration-promotion:promotion-1/candidate:candidate-1",
          probabilityLow: 0.55,
          probabilityHigh: 0.72,
          edgeLow: 0.04,
          expectedValueLow: 0.045,
          detail: "Approved exact-runtime cohort."
        }
      }
    }));

    expect(metadata).toMatchObject({
      evidenceSchemaVersion: "public-pick-economics-v1",
      executionQuote: { bookmakerName: "Example Book", decimalOdds: 1.9 },
      marketConsensus: { independentBookmakers: 4, noVigProbability: 0.51 },
      economicConfidence: {
        status: "verified",
        sampleSize: 80,
        expectedValueLow: 0.045
      }
    });
  });

  it("excludes internal model runs from public accuracy", () => {
    const item = { recordSource: "internal-model-run", edge: 0.2, result: "won" } as unknown as PublicPredictionHistoryItem;
    expect(isPublicAccuracyEligible(item)).toBe(false);
    expect(getHistorySummary([]).totalPublicPicks).toBe(0);
  });

  it("does not publish a negative-edge internal analysis as a public value pick", () => {
    const decision = { valueEdge: -0.02, expectedValue: -0.01, modelProbability: 0.5, impliedProbability: 0.52, noVigProbability: 0.51, decimalOdds: 1.9, publicStatus: "value_pick", isPreliminary: false } as CanonicalDecision;
    const summary = { publicStatus: "value_pick", bestPublishedPick: { edge: -0.02 }, auditSummary: { publicInvariantPassed: true } } as DecisionSummary;
    expect(isCanonicalPublicPickEligible(decision, summary)).toBe(false);
  });

  it("summarizes backfill pending, settled, duplicates, and manual review counts", () => {
    const summary = summarizeResultsBackfill({
      pending: 12,
      duplicateRows: 4,
      internalTagged: 7,
      settlement: { totals: { pendingRead: 12, settled: 5, voided: 1, waitingKickoff: 1, live: 0, awaitingScore: 0, awaitingMarket: 0, providerMissing: 1, manualReview: 5, failed: 0 } }
    });
    expect(summary).toMatchObject({ pending: 12, settled: 5, duplicates: 4, manualReview: 5, internalTagged: 7 });
  });
});
