import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { buildDecisionOutcomeSettlement } from "@/lib/sports/prediction/decisionOutcomeSettlement";
import { getHistorySummary, isPublicAccuracyEligible, type PublicPredictionHistoryItem } from "@/lib/sports/prediction/history";
import { summarizeResultsBackfill } from "@/lib/sports/results/backfill";
import {
  buildPublicPickKey,
  buildPublicPickPublicationMetadata,
  dedupePublicPickDrafts,
  isCanonicalPublicPickEligible,
  persistCanonicalPublicPicks,
  type PublicPickDraft
} from "@/lib/sports/results/publicPicks";
import { resolvePublicPickSettlement, type SettleablePublicPick } from "@/lib/sports/results/settlement";
import type { CanonicalDecision } from "@/lib/sports/intelligence/types";
import type { DecisionSummary, Match } from "@/lib/sports/types";

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

  it("does not query the public-pick repository when no canonical pick is eligible", async () => {
    const from = vi.fn();
    const result = await persistCanonicalPublicPicks({
      matches: [{ id: "fixture-1", dataSource: { kind: "provider" } } as Match],
      summariesByFixture: new Map(),
      decisionsByFixture: new Map(),
      fixtureIds: new Map([["fixture-1", "fixture-db-1"]]),
      client: { from } as unknown as SupabaseClient
    });

    expect(result).toEqual({ attempted: 0, published: 0, revised: 0, stale: 0, errors: [] });
    expect(from).not.toHaveBeenCalled();
  });

  it("chunks public-pick prerequisite reads for a large eligible slate", async () => {
    const summaryChunkSizes: number[] = [];
    const pickChunkSizes: number[] = [];
    const matches: Match[] = [];
    const summariesByFixture = new Map<string, DecisionSummary>();
    const decisionsByFixture = new Map<string, CanonicalDecision[]>();
    const fixtureIds = new Map<string, string>();
    for (let index = 0; index < 205; index += 1) {
      const fixtureId = `fixture-${index}`;
      matches.push({
        id: fixtureId,
        sport: "football",
        league: { id: "league", name: "League", country: "World", strength: 0.5 },
        kickoffTime: "2026-07-24T18:00:00.000Z",
        homeTeam: { id: `home-${index}`, name: `Home ${index}`, country: "World", rating: 0.5 },
        awayTeam: { id: `away-${index}`, name: `Away ${index}`, country: "World", rating: 0.5 },
        homeForm: { teamId: `home-${index}`, recentResults: [], goalsFor: 0, goalsAgainst: 0, xgFor: null, xgAgainst: null, attackStrength: 0.5, defenseStrength: 0.5 },
        awayForm: { teamId: `away-${index}`, recentResults: [], goalsFor: 0, goalsAgainst: 0, xgFor: null, xgAgainst: null, attackStrength: 0.5, defenseStrength: 0.5 },
        status: "scheduled",
        oddsMarkets: [],
        dataQualityScore: 0.9,
        dataSource: { kind: "provider", fixtureProvider: "provider", fixtureProviderId: fixtureId }
      });
      fixtureIds.set(fixtureId, `db-${index}`);
      summariesByFixture.set(fixtureId, {
        generatedAt: "2026-07-22T08:00:00.000Z",
        publicStatus: "value_pick",
        dataQuality: 0.9,
        bestPublishedPick: {
          marketId: "match_winner", selectionId: "home", label: "Home", odds: 2,
          modelProbability: 0.6, rawImpliedProbability: 0.5, noVigImpliedProbability: 0.48,
          edge: 0.12, expectedValue: 0.2
        },
        auditSummary: { publicInvariantPassed: true }
      } as DecisionSummary);
      decisionsByFixture.set(fixtureId, [{
        decisionId: `decision-${index}`, market: "match_winner", selection: "home", label: "Home",
        modelVersion: "model-v1", engineVersion: "engine-v1", modelProbability: 0.6,
        impliedProbability: 0.5, noVigProbability: 0.48, decimalOdds: 2, valueEdge: 0.12,
        expectedValue: 0.2, confidence: "medium", risk: "medium", publicStatus: "value_pick",
        isPreliminary: false
      } as CanonicalDecision]);
    }

    const client = {
      from(table: string) {
        return {
          select() {
            return {
              in(_column: string, values: string[]) {
                if (table === "op_fixture_decision_summaries") {
                  summaryChunkSizes.push(values.length);
                  return {
                    async is() {
                      return {
                        data: values.map((value) => ({
                          id: `summary-${value.slice(3)}`,
                          fixture_id: value,
                          fixture_external_id: `fixture-${value.slice(3)}`
                        })),
                        error: null
                      };
                    }
                  };
                }
                pickChunkSizes.push(values.length);
                return Promise.resolve({ data: [], error: null });
              }
            };
          },
          upsert() {
            return { async select() { return { data: [], error: null }; } };
          }
        };
      }
    } as unknown as SupabaseClient;

    const result = await persistCanonicalPublicPicks({ matches, summariesByFixture, decisionsByFixture, fixtureIds, client });
    expect(summaryChunkSizes).toEqual([100, 100, 5]);
    expect(pickChunkSizes).toEqual([100, 100, 5]);
    expect(result).toMatchObject({ attempted: 205, errors: [] });
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
