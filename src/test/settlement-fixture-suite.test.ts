import { describe, expect, it } from "vitest";
import { emptyResult, type CanonicalResult, type PeriodScore } from "@/lib/results/canonicalResult";
import { settle, type SettlementOutcome } from "@/lib/settlement/grade";

/**
 * The settlement fixture suite.
 *
 * Table-driven and database-free, which is the point of keeping the engine
 * pure. Every case here is a settlement this repository has previously got
 * wrong, could not express at all, or would get wrong the first time somebody
 * re-derived the rule from a final score.
 */

function football(overrides: Partial<CanonicalResult> = {}): CanonicalResult {
  return { ...emptyResult("fx-1", "football"), verificationState: "verified", ...overrides };
}

function basketball(overrides: Partial<CanonicalResult> = {}): CanonicalResult {
  return { ...emptyResult("fx-2", "basketball"), verificationState: "verified", ...overrides };
}

function tennis(overrides: Partial<CanonicalResult> = {}): CanonicalResult {
  return { ...emptyResult("fx-3", "tennis"), verificationState: "verified", ...overrides };
}

function outcome(result: CanonicalResult, selectionKey: string): SettlementOutcome {
  return settle(result, { selectionKey }).outcome;
}

describe("football regulation", () => {
  const draw = football({ regulationHome: 1, regulationAway: 1, winner: "draw", winnerBasis: "regulation" });

  it("settles a regulation draw", () => {
    expect(outcome(draw, "football.1x2.regulation.draw")).toBe("won");
    expect(outcome(draw, "football.1x2.regulation.home")).toBe("lost");
  });

  it("settles double chance from the same score", () => {
    expect(outcome(draw, "football.double_chance.regulation.1x")).toBe("won");
    expect(outcome(draw, "football.double_chance.regulation.12")).toBe("lost");
    expect(outcome(draw, "football.double_chance.regulation.x2")).toBe("won");
  });

  it("pushes draw no bet on a draw rather than losing it", () => {
    expect(outcome(draw, "football.draw_no_bet.regulation.home")).toBe("push");
    expect(settle(draw, { selectionKey: "football.draw_no_bet.regulation.home" }).returnMultiple(2.5)).toBe(0);
  });

  it("settles BTTS", () => {
    expect(outcome(draw, "football.btts.regulation.yes")).toBe("won");
    const nilNil = football({ regulationHome: 0, regulationAway: 0, winner: "draw" });
    expect(outcome(nilNil, "football.btts.regulation.no")).toBe("won");
  });
});

describe("extra time and penalties", () => {
  /**
   * The case that motivated the whole canonical result store: a cup tie level
   * at 90 minutes, won in extra time, decided on penalties. 1X2 must settle as
   * a draw; qualification must settle on the side that advanced.
   */
  const cupTie = football({
    resultStatus: "finished",
    regulationHome: 1,
    regulationAway: 1,
    extraTimeHome: 2,
    extraTimeAway: 2,
    shootoutHome: 4,
    shootoutAway: 3,
    winner: "home",
    winnerBasis: "shootout"
  });

  it("settles 1X2 on normal time, not on who eventually went through", () => {
    expect(outcome(cupTie, "football.1x2.regulation.draw")).toBe("won");
    expect(outcome(cupTie, "football.1x2.regulation.home")).toBe("lost");
  });

  it("settles qualification on the shootout", () => {
    expect(outcome(cupTie, "football.to_qualify.including_shootout.home")).toBe("won");
    expect(outcome(cupTie, "football.to_qualify.including_shootout.away")).toBe("lost");
  });

  it("settles an extra-time winner on normal time for 1X2", () => {
    const etWinner = football({
      regulationHome: 0,
      regulationAway: 0,
      extraTimeHome: 1,
      extraTimeAway: 0,
      winner: "home",
      winnerBasis: "extra_time"
    });
    expect(outcome(etWinner, "football.1x2.regulation.draw")).toBe("won");
    expect(outcome(etWinner, "football.to_qualify.including_shootout.home")).toBe("won");
  });

  it("settles totals on normal-time goals only", () => {
    // 2-2 after extra time is over 2.5; 1-1 in normal time is not.
    expect(outcome(cupTie, "football.total_goals.regulation.under.2_5")).toBe("won");
    expect(outcome(cupTie, "football.total_goals.regulation.over.2_5")).toBe("lost");
  });
});

describe("asian handicap", () => {
  const homeByOne = football({ regulationHome: 2, regulationAway: 1, winner: "home", winnerBasis: "regulation" });
  const levelGame = football({ regulationHome: 1, regulationAway: 1, winner: "draw", winnerBasis: "regulation" });

  it("pushes a whole line that lands exactly", () => {
    expect(outcome(levelGame, "football.asian_handicap.regulation.home.0")).toBe("push");
    expect(outcome(homeByOne, "football.asian_handicap.regulation.away.1")).toBe("push");
  });

  it("half-wins a quarter line where one half wins and one pushes", () => {
    // Home -0.25 with a one-goal win: -0 pushes... no, -0 wins and -0.5 wins.
    // Home +0.25 on a draw: 0 pushes, +0.5 wins -> half win.
    expect(outcome(levelGame, "football.asian_handicap.regulation.home.0_25")).toBe("half_won");
  });

  it("half-loses a quarter line where one half loses and one pushes", () => {
    // Home -0.25 on a draw: 0 pushes, -0.5 loses -> half loss.
    expect(outcome(levelGame, "football.asian_handicap.regulation.home.-0_25")).toBe("half_lost");
  });

  it("fully wins a quarter line when both halves win", () => {
    expect(outcome(homeByOne, "football.asian_handicap.regulation.home.-0_25")).toBe("won");
  });

  it("fully loses a quarter line when both halves lose", () => {
    expect(outcome(homeByOne, "football.asian_handicap.regulation.away.0_25")).toBe("lost");
  });

  it("pays a half win at half the profit and a half loss at half the stake", () => {
    const halfWin = settle(levelGame, { selectionKey: "football.asian_handicap.regulation.home.0_25" });
    const halfLoss = settle(levelGame, { selectionKey: "football.asian_handicap.regulation.home.-0_25" });
    expect(halfWin.returnMultiple(3)).toBe(1);
    expect(halfLoss.returnMultiple(3)).toBe(-0.5);
  });
});

describe("totals", () => {
  it("pushes a total landing exactly on a whole line", () => {
    const twoOne = football({ regulationHome: 2, regulationAway: 1, winner: "home" });
    expect(outcome(twoOne, "football.total_goals.regulation.over.3")).toBe("push");
    expect(outcome(twoOne, "football.total_goals.regulation.over.2_5")).toBe("won");
    expect(outcome(twoOne, "football.total_goals.regulation.under.2_5")).toBe("lost");
  });
});

describe("basketball overtime", () => {
  const overtimeGame = basketball({
    regulationHome: 100,
    regulationAway: 100,
    extraTimeHome: 110,
    extraTimeAway: 105,
    winner: "home",
    winnerBasis: "extra_time",
    periodScores: [
      { period: "q4", home: 100, away: 100 },
      { period: "ot1", home: 10, away: 5 }
    ] satisfies PeriodScore[]
  });

  /**
   * The case worth naming. If these two ever agree, the basis wiring is broken
   * and every other test in this file still passes.
   */
  it("grades the same overtime game differently by period", () => {
    expect(outcome(overtimeGame, "basketball.moneyline.full_game_incl_ot.home")).toBe("won");
    expect(outcome(overtimeGame, "basketball.moneyline.regulation.home")).toBe("lost");
    expect(outcome(overtimeGame, "basketball.moneyline.regulation.draw")).toBe("won");
  });

  it("settles spread and total on the overtime score", () => {
    expect(outcome(overtimeGame, "basketball.spread.full_game_incl_ot.home.-4_5")).toBe("won");
    expect(outcome(overtimeGame, "basketball.spread.full_game_incl_ot.home.-5_5")).toBe("lost");
    expect(outcome(overtimeGame, "basketball.total_points.full_game_incl_ot.over.214_5")).toBe("won");
  });

  it("pushes a spread landing exactly", () => {
    expect(outcome(overtimeGame, "basketball.spread.full_game_incl_ot.home.-5")).toBe("push");
    expect(outcome(overtimeGame, "basketball.total_points.full_game_incl_ot.over.215")).toBe("push");
  });
});

describe("tennis retirement and walkover", () => {
  const retirement = tennis({
    resultStatus: "retired",
    setsHome: 2,
    setsAway: 0,
    gamesHome: 12,
    gamesAway: 6,
    winner: "home",
    winnerBasis: "retirement"
  });

  it("settles the match winner on the awarded winner", () => {
    expect(outcome(retirement, "tennis.match_winner.full_match.player_a")).toBe("won");
    expect(outcome(retirement, "tennis.match_winner.full_match.player_b")).toBe("lost");
  });

  it("voids set and games markets, because the count never finished", () => {
    expect(outcome(retirement, "tennis.set_handicap.full_match.player_a.-1_5")).toBe("void");
    expect(outcome(retirement, "tennis.total_games.full_match.over.20_5")).toBe("void");
  });

  it("voids everything on a walkover, including the match winner", () => {
    const walkover = tennis({ resultStatus: "walkover", winner: "home", winnerBasis: "walkover" });
    expect(outcome(walkover, "tennis.match_winner.full_match.player_a")).toBe("void");
    expect(outcome(walkover, "tennis.total_games.full_match.over.20_5")).toBe("void");
  });

  it("settles a completed match normally", () => {
    const completed = tennis({
      setsHome: 2,
      setsAway: 1,
      gamesHome: 20,
      gamesAway: 18,
      winner: "home",
      winnerBasis: "regulation"
    });
    expect(outcome(completed, "tennis.match_winner.full_match.player_a")).toBe("won");
    expect(outcome(completed, "tennis.set_handicap.full_match.player_a.-0_5")).toBe("won");
    expect(outcome(completed, "tennis.total_games.full_match.over.37_5")).toBe("won");
  });
});

describe("non-results", () => {
  it("voids a postponed fixture", () => {
    const postponed = football({ resultStatus: "postponed" });
    expect(outcome(postponed, "football.1x2.regulation.home")).toBe("void");
  });

  it("voids an abandoned fixture", () => {
    const abandoned = football({ resultStatus: "abandoned", regulationHome: 1, regulationAway: 0 });
    expect(outcome(abandoned, "football.1x2.regulation.home")).toBe("void");
  });

  it("voids a cancelled fixture", () => {
    expect(outcome(football({ resultStatus: "cancelled" }), "football.btts.regulation.yes")).toBe("void");
  });
});

describe("what settlement refuses to do", () => {
  it("never settles an unverified result, whatever the score says", () => {
    for (const state of ["provisional", "conflicted", "manual_review"] as const) {
      const unverified = football({
        verificationState: state,
        regulationHome: 2,
        regulationAway: 0,
        winner: "home"
      });
      expect(outcome(unverified, "football.1x2.regulation.home")).toBe("needs_review");
    }
  });

  it("refuses an unmapped selection rather than voiding it", () => {
    const played = football({ regulationHome: 1, regulationAway: 0, winner: "home" });
    // A void says the market never resolved. An unmapped market resolved fine;
    // we just cannot read it. Those are different claims about the world.
    expect(outcome(played, "football.corners.regulation.over.9_5")).toBe("needs_review");
  });

  it("refuses a handicap claim carrying no line", () => {
    const played = football({ regulationHome: 1, regulationAway: 0, winner: "home" });
    expect(outcome(played, "football.asian_handicap.regulation.home")).toBe("needs_review");
  });

  it("refuses to grade a market whose score the result never carried", () => {
    const noSets = tennis({ winner: "home", winnerBasis: "regulation" });
    expect(outcome(noSets, "tennis.set_handicap.full_match.player_a.-1_5")).toBe("needs_review");
  });

  it("refuses a tie on a two-way market rather than picking a side", () => {
    const tied = basketball({ regulationHome: 100, regulationAway: 100, winner: "draw" });
    expect(outcome(tied, "basketball.moneyline.full_game_incl_ot.home")).toBe("needs_review");
  });
});

describe("determinism and replay", () => {
  it("returns the same verdict for the same inputs", () => {
    const result = football({ regulationHome: 2, regulationAway: 1, winner: "home", winnerBasis: "regulation" });
    const key = "football.asian_handicap.regulation.home.-0_25";
    const first = settle(result, { selectionKey: key });
    const second = settle(result, { selectionKey: key });
    expect(second.outcome).toBe(first.outcome);
    expect(second.reason).toBe(first.reason);
    expect(second.ruleVersion).toBe(first.ruleVersion);
  });

  it("stamps every graded settlement with its market key, rule version and basis", () => {
    const result = football({ regulationHome: 2, regulationAway: 1, winner: "home" });
    const settled = settle(result, { selectionKey: "football.1x2.regulation.home" });
    expect(settled.marketKey).toBe("football.1x2.regulation");
    expect(settled.ruleVersion).toBe("2026-08-07.1");
    expect(settled.basis).toBe("regulation");
  });
});
