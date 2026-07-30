import { describe, expect, it } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { modelFootballMatch } from "@/lib/sports/prediction/footballModel";
import { gradeMarketDecision } from "@/lib/sports/results/marketDecisionSettlement";

/**
 * The football model always computed a full Dixon-Coles score matrix and then
 * emitted only six read-outs from it, which is why match pages showed "win or
 * loss and nothing more". These tests pin the expanded market set and the
 * probability identities that make one matrix trustworthy across many markets —
 * if any derivation drifts from the matrix, an identity breaks before a user
 * sees an incoherent page.
 */
async function markets(): Promise<Map<string, Record<string, number>>> {
  const [match] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
  const { markets: predicted } = modelFootballMatch(match, { now: new Date("2026-08-21T10:00:00.000Z") });
  return new Map(predicted.map((market) => [market.marketId as string, market.probabilities]));
}

describe("football model markets", () => {
  it("emits the full market set from the score matrix", async () => {
    const byId = await markets();
    for (const marketId of [
      "match_winner",
      "over_under_05",
      "over_under_15",
      "over_under_25",
      "over_under_35",
      "over_under_45",
      "both_teams_to_score",
      "home_team_over_under_15",
      "away_team_over_under_15",
      "clean_sheet_home",
      "clean_sheet_away",
      "correct_score",
      "double_chance",
      "draw_no_bet"
    ]) {
      expect(byId.has(marketId), `missing market ${marketId}`).toBe(true);
    }
  });

  it("keeps every two-way market summing to one", async () => {
    const byId = await markets();
    for (const [marketId, probabilities] of byId) {
      if (marketId === "match_winner" || marketId === "double_chance" || marketId === "correct_score") continue;
      const total = Object.values(probabilities).reduce((sum, value) => sum + value, 0);
      expect(Math.abs(total - 1), `${marketId} sums to ${total}`).toBeLessThan(0.001);
    }
  });

  it("keeps the totals ladder monotonic", async () => {
    const byId = await markets();
    const over = (marketId: string, selection: string) => byId.get(marketId)![selection];
    expect(over("over_under_05", "over_05")).toBeGreaterThanOrEqual(over("over_under_15", "over_15"));
    expect(over("over_under_15", "over_15")).toBeGreaterThanOrEqual(over("over_under_25", "over_25"));
    expect(over("over_under_25", "over_25")).toBeGreaterThanOrEqual(over("over_under_35", "over_35"));
    expect(over("over_under_35", "over_35")).toBeGreaterThanOrEqual(over("over_under_45", "over_45"));
  });

  it("keeps BTTS consistent with the clean-sheet complements", async () => {
    const byId = await markets();
    // P(BTTS) = 1 − P(away blanks) − P(home blanks) + P(0-0). The 0-0 cell is
    // only directly visible when it makes the correct-score leaders, so assert
    // the inequality that must hold regardless: both clean sheets together
    // overcount by at most the 0-0 probability.
    const btts = byId.get("both_teams_to_score")!.yes;
    const csHome = byId.get("clean_sheet_home")!.yes;
    const csAway = byId.get("clean_sheet_away")!.yes;
    expect(btts).toBeGreaterThanOrEqual(1 - csHome - csAway - 0.001);
    expect(btts).toBeLessThanOrEqual(1 - Math.max(csHome, csAway) + 0.001);
    const zeroZero = byId.get("correct_score")!["0_0"];
    if (typeof zeroZero === "number") {
      expect(Math.abs(btts - (1 - csHome - csAway + zeroZero))).toBeLessThan(0.001);
    }
  });

  it("keeps the correct-score market a true distribution", async () => {
    const byId = await markets();
    const correctScore = byId.get("correct_score")!;
    const total = Object.values(correctScore).reduce((sum, value) => sum + value, 0);
    expect(Math.abs(total - 1)).toBeLessThan(0.001);
    expect(Object.keys(correctScore)).toContain("other");
    // Team totals must never exceed the match total at the same line.
    expect(byId.get("home_team_over_under_15")!.over_15).toBeLessThanOrEqual(byId.get("over_under_15")!.over_15 + 0.001);
    expect(byId.get("away_team_over_under_15")!.over_15).toBeLessThanOrEqual(byId.get("over_under_15")!.over_15 + 0.001);
  });
});

describe("expanded market settlement", () => {
  const finished = (home: number, away: number) => ({ status: "finished" as const, homeScore: home, awayScore: away });

  it("grades team totals with pushes on the exact line", () => {
    expect(gradeMarketDecision({ market: "home_team_over_under_15", selection: "over_15", fixture: finished(2, 0) }).result).toBe("won");
    expect(gradeMarketDecision({ market: "home_team_over_under_15", selection: "over_15", fixture: finished(1, 3) }).result).toBe("lost");
    expect(gradeMarketDecision({ market: "away_team_over_under_15", selection: "under_15", fixture: finished(0, 1) }).result).toBe("won");
    // Integer lines can land exactly; `over_2` is the 2.0 line.
    expect(gradeMarketDecision({ market: "home_team_over_under_2", selection: "over_2", fixture: finished(2, 0) }).result).toBe("push");
  });

  it("grades clean sheets from the conceded side", () => {
    expect(gradeMarketDecision({ market: "clean_sheet_home", selection: "yes", fixture: finished(3, 0) }).result).toBe("won");
    expect(gradeMarketDecision({ market: "clean_sheet_home", selection: "yes", fixture: finished(3, 1) }).result).toBe("lost");
    expect(gradeMarketDecision({ market: "clean_sheet_away", selection: "no", fixture: finished(1, 1) }).result).toBe("won");
  });

  it("grades exact correct scores and refuses the aggregate bucket", () => {
    expect(gradeMarketDecision({ market: "correct_score", selection: "2_1", fixture: finished(2, 1) }).result).toBe("won");
    expect(gradeMarketDecision({ market: "correct_score", selection: "2_1", fixture: finished(1, 2) }).result).toBe("lost");
    // `other` aggregates unlisted scorelines the decision row cannot enumerate.
    expect(gradeMarketDecision({ market: "correct_score", selection: "other", fixture: finished(4, 4) }).result).toBe("needs_review");
  });

  it("still grades the widened match-total lines", () => {
    expect(gradeMarketDecision({ market: "over_under_45", selection: "over_45", fixture: finished(3, 2) }).result).toBe("won");
    expect(gradeMarketDecision({ market: "over_under_05", selection: "under_05", fixture: finished(0, 0) }).result).toBe("won");
  });
});
