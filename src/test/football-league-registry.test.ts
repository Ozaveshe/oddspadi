import { describe, expect, it } from "vitest";
import { configuredPredictionLeagueIds, footballLeagueById, homeAdvantageForLeague, predictionFootballLeagues } from "@/lib/sports/footballLeagues";
import { recencyWeightedFormScore } from "@/lib/sports/prediction/footballModel";
import { modelFootballMatch } from "@/lib/sports/prediction/footballModel";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";

describe("football league registry", () => {
  it("contains the top five and three primary African prediction leagues", () => {
    expect(predictionFootballLeagues.map((league) => league.id)).toEqual([39, 140, 135, 78, 61, 399, 288, 233]);
    expect(footballLeagueById("api-football:233")?.slug).toBe("egyptian-premier-league");
  });

  it("fails closed to the prediction registry for empty or invalid configuration", () => {
    expect([...configuredPredictionLeagueIds("")]).toEqual(["39", "140", "135", "78", "61", "399", "288", "233"]);
    expect([...configuredPredictionLeagueIds("999999")]).toEqual(["39", "140", "135", "78", "61", "399", "288", "233"]);
    expect([...configuredPredictionLeagueIds("39,399,1")]).toEqual(["39", "399"]);
  });

  it("uses stronger home advantage in the NPFL than the EPL", () => {
    expect(homeAdvantageForLeague(399)).toBeGreaterThan(homeAdvantageForLeague(39));
  });

  it("moves home-win probability upward for the stronger NPFL home factor", async () => {
    const match = (await mockSportsDataProvider.getFixtures("2026-07-05", "football"))[0];
    const epl = modelFootballMatch({ ...match, league: { ...match.league, id: "api-football:39" } }).markets[0].probabilities.home;
    const npfl = modelFootballMatch({ ...match, league: { ...match.league, id: "api-football:399" } }).markets[0].probabilities.home;
    expect(npfl).toBeGreaterThan(epl);
  });
});

describe("recency weighted football form", () => {
  it("gives more credit to recent wins than equally sized old wins", () => {
    expect(recencyWeightedFormScore(["W", "W", "L", "L"])).toBeGreaterThan(recencyWeightedFormScore(["L", "L", "W", "W"]));
  });

  it("moves home-win probability toward the team with the more recent wins", async () => {
    const match = (await mockSportsDataProvider.getFixtures("2026-07-05", "football"))[0];
    const recentWins = modelFootballMatch({
      ...match,
      homeForm: { ...match.homeForm, recentResults: ["W", "W", "L", "L"] },
      awayForm: { ...match.awayForm, recentResults: ["L", "L", "W", "W"] }
    }).markets[0].probabilities.home;
    const oldWins = modelFootballMatch({
      ...match,
      homeForm: { ...match.homeForm, recentResults: ["L", "L", "W", "W"] },
      awayForm: { ...match.awayForm, recentResults: ["W", "W", "L", "L"] }
    }).markets[0].probabilities.home;
    expect(recentWins).toBeGreaterThan(oldWins);
  });
});
