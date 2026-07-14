import { describe, expect, it } from "vitest";
import type { Match } from "@/lib/sports/types";
import { buildPrediction } from "@/lib/sports/service";

function match({
  kind = "provider",
  formProvider = "api-football-recent-fixtures"
}: {
  kind?: "provider" | "mock";
  formProvider?: string;
} = {}): Match {
  return {
    id: kind === "provider" ? "api-football:coverage-101" : "mock:coverage-101",
    sport: "football",
    league: { id: "api-football:39", name: "Premier League", country: "England", strength: 0.94 },
    kickoffTime: "2026-07-20T15:00:00.000Z",
    homeTeam: {
      id: "api-football:1",
      name: "Arsenal",
      rating: 86,
      ratingEvidence: { source: "supabase-football-data-historical-elo-v1", sampleSize: 380, asOf: "2026-05-24T15:00:00.000Z" }
    },
    awayTeam: {
      id: "api-football:2",
      name: "Aston Villa",
      rating: 82,
      ratingEvidence: { source: "supabase-football-data-historical-elo-v1", sampleSize: 380, asOf: "2026-05-24T15:00:00.000Z" }
    },
    status: "scheduled",
    oddsMarkets: [],
    homeForm: {
      teamId: "api-football:1",
      recentResults: ["W", "D", "W", "W", "L"],
      goalsFor: 9,
      goalsAgainst: 4,
      attackStrength: 0.82,
      defenseStrength: 0.79
    },
    awayForm: {
      teamId: "api-football:2",
      recentResults: ["W", "L", "W", "D", "W"],
      goalsFor: 8,
      goalsAgainst: 5,
      attackStrength: 0.76,
      defenseStrength: 0.71
    },
    dataQualityScore: 0.9,
    dataSource: {
      kind,
      fixtureProvider: kind === "provider" ? "api-football" : "mockSportsDataProvider",
      formProvider: kind === "provider" ? formProvider : "mockSportsDataProvider",
      strengthProvider: kind === "provider" ? "supabase-football-data-historical-elo-v1" : "mockSportsDataProvider",
      fetchedAt: "2026-07-14T11:55:00.000Z"
    }
  };
}

function homeAwayCoverage(input: Match) {
  return buildPrediction(input).decision.dataCoverage.signals.find((signal) => signal.id === "home-away-performance");
}

describe("decision data coverage classification", () => {
  it("credits provider recent-form windows in home/away coverage", () => {
    expect(homeAwayCoverage(match())).toMatchObject({
      status: "provider-backed",
      source: "api-football-recent-fixtures",
      freshness: "pre-match"
    });
  });

  it("keeps deterministic provider form explicitly computed", () => {
    expect(homeAwayCoverage(match({ formProvider: "deterministic-provider-proxy" }))).toMatchObject({
      status: "computed",
      source: "deterministic-provider-proxy",
      freshness: "pre-match"
    });
  });

  it("does not upgrade mock form into real home/away evidence", () => {
    expect(homeAwayCoverage(match({ kind: "mock" }))).toMatchObject({
      status: "mock",
      source: "mockSportsDataProvider",
      freshness: "mock"
    });
  });
});
