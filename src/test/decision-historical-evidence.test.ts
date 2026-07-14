import { describe, expect, it } from "vitest";
import type { Match, MatchContextSignal } from "@/lib/sports/types";
import { isRequiredProductionDataSignalBlocked } from "@/lib/sports/prediction/contextSignalPolicy";
import { buildHistoricalResultsCoverageSignal } from "@/lib/sports/prediction/decisionHistoricalEvidence";
import { buildPrediction } from "@/lib/sports/service";

const NOW = new Date("2026-07-14T12:00:00.000Z");

function playerForm(
  publishedAt = "2026-07-10T12:00:00.000Z",
  quality: MatchContextSignal["quality"] = "acceptable"
): MatchContextSignal {
  return {
    id: "fixture-player-form",
    category: "player-form",
    label: "Leakage-safe player form",
    detail: "Five completed fixtures per team, all before kickoff.",
    quality,
    impact: "neutral",
    confidence: 0.7,
    weight: 0,
    source: "supabase-player-performance",
    publishedAt
  };
}

function match(kind: "provider" | "mock" = "provider"): Match {
  return {
    id: "api-football:101",
    sport: "football",
    league: { id: "api-football:39", name: "Premier League", country: "England", strength: 0.94 },
    kickoffTime: "2026-07-20T15:00:00.000Z",
    homeTeam: {
      id: "api-football:1",
      name: "Arsenal",
      rating: 86,
      ratingEvidence: {
        source: "supabase-football-data-historical-elo-v1",
        sampleSize: 380,
        asOf: "2026-05-24T15:00:00.000Z"
      }
    },
    awayTeam: {
      id: "api-football:2",
      name: "Aston Villa",
      rating: 82,
      ratingEvidence: {
        source: "supabase-football-data-historical-elo-v1",
        sampleSize: 380,
        asOf: "2026-05-24T15:00:00.000Z"
      }
    },
    status: "scheduled",
    oddsMarkets: [],
    homeForm: { teamId: "api-football:1", recentResults: ["W", "D", "W"], goalsFor: 6, goalsAgainst: 2, attackStrength: 0.8, defenseStrength: 0.78 },
    awayForm: { teamId: "api-football:2", recentResults: ["W", "L", "W"], goalsFor: 5, goalsAgainst: 3, attackStrength: 0.74, defenseStrength: 0.7 },
    dataQualityScore: 0.9,
    dataSource: {
      kind,
      fixtureProvider: kind === "provider" ? "api-football" : "mockSportsDataProvider",
      strengthProvider: "supabase-football-data-historical-elo-v1",
      fetchedAt: "2026-07-14T11:55:00.000Z"
    }
  };
}

describe("decision historical evidence coverage", () => {
  it("credits chronological team and player history only when every input is provider-backed", () => {
    const signal = buildHistoricalResultsCoverageSignal({ match: match(), playerFormSignal: playerForm(), now: NOW });
    expect(signal.status).toBe("provider-backed");
    expect(signal.freshness).toBe("historical");
    expect(signal.source).toContain("supabase-football-data-historical-elo-v1");
    expect(signal.source).toContain("supabase-player-performance");
    expect(signal.detail).toContain("Chronological team and player history is provider-backed");
  });

  it("keeps real team history partial and production-blocked when player history is absent", () => {
    const signal = buildHistoricalResultsCoverageSignal({ match: match(), now: NOW });
    expect(signal.status).toBe("computed");
    expect(signal.detail).toContain("no leakage-safe player-performance form was attached");
    expect(isRequiredProductionDataSignalBlocked({ category: "historical-results", status: signal.status, requiredForProduction: true })).toBe(true);
  });

  it("marks expired player history stale instead of silently using it", () => {
    const signal = buildHistoricalResultsCoverageSignal({
      match: match(),
      playerFormSignal: playerForm("2026-05-01T12:00:00.000Z"),
      now: NOW
    });
    expect(signal.status).toBe("stale");
    expect(signal.freshness).toBe("stale");
  });

  it("does not promote a thin player sample to production-backed history", () => {
    const signal = buildHistoricalResultsCoverageSignal({
      match: match(),
      playerFormSignal: playerForm("2026-07-10T12:00:00.000Z", "thin"),
      now: NOW
    });
    expect(signal.status).toBe("computed");
    expect(signal.detail).toContain("thin evidence");
  });

  it("does not promote an undersized team-history sample", () => {
    const input = match();
    input.awayTeam.ratingEvidence = { ...input.awayTeam.ratingEvidence!, sampleSize: 1 };
    const signal = buildHistoricalResultsCoverageSignal({ match: input, playerFormSignal: playerForm(), now: NOW });
    expect(signal.status).toBe("computed");
    expect(signal.detail).toContain("Aston Villa: computed");
  });

  it("never upgrades mock fixtures even when provider-shaped evidence is attached", () => {
    const signal = buildHistoricalResultsCoverageSignal({ match: match("mock"), playerFormSignal: playerForm(), now: NOW });
    expect(signal.status).toBe("mock");
    expect(signal.freshness).toBe("mock");
  });

  it("threads provider-backed historical evidence through the real prediction entrypoint", () => {
    const input = match();
    input.providerContextSignals = [playerForm()];
    const prediction = buildPrediction(input);
    const history = prediction.decision.dataCoverage.signals.find((signal) => signal.id === "historical-results");
    expect(history).toMatchObject({ status: "provider-backed", freshness: "historical" });
    expect(prediction.decision.dataCoverage.requiredBeforeTrust.join(" ")).not.toContain("Chronological team and player history");
  });
});
