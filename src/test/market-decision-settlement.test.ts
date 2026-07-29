import { describe, expect, it } from "vitest";
import { gradeMarketDecision, type SettleableFixtureResult } from "@/lib/sports/results/marketDecisionSettlement";

function finished(home: number, away: number): SettleableFixtureResult {
  return { status: "finished", homeScore: home, awayScore: away };
}

function grade(market: string, selection: string, fixture: SettleableFixtureResult) {
  return gradeMarketDecision({ market, selection, fixture }).result;
}

describe("market decision settlement", () => {
  it("grades a home win", () => {
    expect(grade("match_winner", "home", finished(2, 0))).toBe("won");
    expect(grade("match_winner", "away", finished(2, 0))).toBe("lost");
    expect(grade("match_winner", "draw", finished(2, 0))).toBe("lost");
  });

  it("grades a draw", () => {
    expect(grade("match_winner", "draw", finished(1, 1))).toBe("won");
    expect(grade("match_winner", "home", finished(1, 1))).toBe("lost");
  });

  it("treats tennis moneyline the same way", () => {
    expect(grade("moneyline", "away", finished(0, 2))).toBe("won");
  });

  it("grades both teams to score", () => {
    expect(grade("both_teams_to_score", "yes", finished(1, 1))).toBe("won");
    expect(grade("both_teams_to_score", "yes", finished(3, 0))).toBe("lost");
    expect(grade("both_teams_to_score", "no", finished(3, 0))).toBe("won");
  });

  it("grades totals and decodes the line from the selection id", () => {
    // over_25 is the 2.5 line, not 25 goals.
    expect(grade("total_goals", "over_25", finished(2, 1))).toBe("won");
    expect(grade("total_goals", "over_25", finished(1, 1))).toBe("lost");
    expect(grade("total_goals", "under_25", finished(1, 1))).toBe("won");
  });

  it("pushes when the total lands exactly on a whole line", () => {
    expect(grade("total_goals", "over_2", finished(1, 1))).toBe("push");
  });

  it("voids a postponed or cancelled fixture", () => {
    expect(grade("match_winner", "home", { status: "postponed", homeScore: null, awayScore: null })).toBe("void");
    expect(grade("match_winner", "home", { status: "cancelled", homeScore: null, awayScore: null })).toBe("void");
  });

  it("refuses to grade an unfinished fixture", () => {
    expect(grade("match_winner", "home", { status: "live", homeScore: 1, awayScore: 0 })).toBe("needs_review");
  });

  it("refuses to grade a finished fixture with no score", () => {
    expect(grade("match_winner", "home", { status: "finished", homeScore: null, awayScore: null })).toBe("needs_review");
  });

  it("refuses handicaps rather than guessing the line", () => {
    // The decision row does not carry the line the price was struck at, so a
    // guess here would silently corrupt the calibration curve.
    expect(grade("spread", "home_cover", finished(3, 1))).toBe("needs_review");
    expect(grade("handicap", "away_cover", finished(3, 1))).toBe("needs_review");
  });

  it("refuses an unrecognised selection on a known market", () => {
    expect(grade("match_winner", "over_25", finished(1, 0))).toBe("needs_review");
    expect(grade("both_teams_to_score", "home", finished(1, 0))).toBe("needs_review");
  });
});
