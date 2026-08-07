import { describe, expect, it } from "vitest";
import { parseBasketballResult, parseFootballResult, parseTennisResult } from "@/lib/results/providerResults";
import { settle } from "@/lib/settlement/grade";
import type { CanonicalResult } from "@/lib/results/canonicalResult";

function verified(result: CanonicalResult | null): CanonicalResult {
  expect(result).not.toBeNull();
  return { ...result!, verificationState: "verified" };
}

describe("API-Football", () => {
  it("keeps regulation, extra time and the shootout apart", () => {
    // The payload shape that has been arriving all along and being collapsed
    // into a single home_score/away_score pair.
    const result = verified(
      parseFootballResult("fx", {
        fixture: { status: { short: "PEN" } },
        goals: { home: 2, away: 2 },
        score: {
          halftime: { home: 0, away: 1 },
          fulltime: { home: 1, away: 1 },
          extratime: { home: 2, away: 2 },
          penalty: { home: 4, away: 3 }
        }
      })
    );

    expect(result.regulationHome).toBe(1);
    expect(result.regulationAway).toBe(1);
    expect(result.extraTimeHome).toBe(2);
    expect(result.shootoutHome).toBe(4);
    expect(result.winner).toBe("home");
    expect(result.winnerBasis).toBe("shootout");

    // And the settlement that used to be wrong.
    expect(settle(result, { selectionKey: "football.1x2.regulation.draw" }).outcome).toBe("won");
    expect(settle(result, { selectionKey: "football.to_qualify.including_shootout.home" }).outcome).toBe("won");
  });

  it("reads an extra-time winner with no shootout", () => {
    const result = verified(
      parseFootballResult("fx", {
        fixture: { status: { short: "AET" } },
        goals: { home: 1, away: 0 },
        score: { fulltime: { home: 0, away: 0 }, extratime: { home: 1, away: 0 }, penalty: { home: null, away: null } }
      })
    );
    expect(result.winnerBasis).toBe("extra_time");
    expect(settle(result, { selectionKey: "football.1x2.regulation.draw" }).outcome).toBe("won");
  });

  it("treats a regulation finish as regulation", () => {
    const result = verified(
      parseFootballResult("fx", {
        fixture: { status: { short: "FT" } },
        goals: { home: 2, away: 1 },
        score: { fulltime: { home: 2, away: 1 }, extratime: { home: null, away: null }, penalty: { home: null, away: null } }
      })
    );
    expect(result.regulationHome).toBe(2);
    expect(result.extraTimeHome).toBeNull();
    expect(result.winnerBasis).toBe("regulation");
  });

  it("falls back to goals when fulltime is absent and no extra time was played", () => {
    const result = verified(
      parseFootballResult("fx", { fixture: { status: { short: "FT" } }, goals: { home: 3, away: 0 }, score: {} })
    );
    expect(result.regulationHome).toBe(3);
  });

  it("does not read goals as regulation when extra time was played", () => {
    // `goals` equals the post-extra-time score, so using it as regulation is
    // exactly the bug this store exists to fix.
    const result = verified(
      parseFootballResult("fx", {
        fixture: { status: { short: "AET" } },
        goals: { home: 2, away: 1 },
        score: { extratime: { home: 2, away: 1 } }
      })
    );
    expect(result.regulationHome).toBeNull();
    expect(settle(result, { selectionKey: "football.1x2.regulation.home" }).outcome).toBe("needs_review");
  });

  it("distinguishes walkover, awarded and abandoned", () => {
    expect(parseFootballResult("fx", { fixture: { status: { short: "WO" } } })?.resultStatus).toBe("walkover");
    expect(parseFootballResult("fx", { fixture: { status: { short: "AWD" } } })?.resultStatus).toBe("awarded");
    expect(parseFootballResult("fx", { fixture: { status: { short: "ABD" } } })?.resultStatus).toBe("abandoned");
    expect(parseFootballResult("fx", { fixture: { status: { short: "PST" } } })?.resultStatus).toBe("postponed");
  });

  it("returns null for a fixture that has not finished", () => {
    expect(parseFootballResult("fx", { fixture: { status: { short: "1H" } } })).toBeNull();
    expect(parseFootballResult("fx", { fixture: { status: { short: "NS" } } })).toBeNull();
  });
});

describe("API-Basketball", () => {
  it("derives regulation by subtracting overtime from the total", () => {
    const result = verified(
      parseBasketballResult("fx", {
        status: { short: "AOT", long: "After Over Time" },
        scores: {
          home: { quarter_1: 25, quarter_2: 25, quarter_3: 25, quarter_4: 25, over_time: 10, total: 110 },
          away: { quarter_1: 25, quarter_2: 25, quarter_3: 25, quarter_4: 25, over_time: 5, total: 105 }
        }
      })
    );
    expect(result.regulationHome).toBe(100);
    expect(result.regulationAway).toBe(100);
    expect(result.extraTimeHome).toBe(110);

    // The divergence that proves the basis wiring works end to end.
    expect(settle(result, { selectionKey: "basketball.moneyline.full_game_incl_ot.home" }).outcome).toBe("won");
    expect(settle(result, { selectionKey: "basketball.moneyline.regulation.draw" }).outcome).toBe("won");
  });

  it("leaves extra time null when no overtime was played", () => {
    const result = verified(
      parseBasketballResult("fx", {
        status: { short: "FT", long: "Game Finished" },
        scores: {
          home: { quarter_1: 25, quarter_2: 25, quarter_3: 25, quarter_4: 30, over_time: 0, total: 105 },
          away: { quarter_1: 25, quarter_2: 25, quarter_3: 25, quarter_4: 20, over_time: 0, total: 95 }
        }
      })
    );
    expect(result.extraTimeHome).toBeNull();
    expect(result.regulationHome).toBe(105);
    // A full-game market falls back to regulation rather than reading a null.
    expect(settle(result, { selectionKey: "basketball.moneyline.full_game_incl_ot.home" }).outcome).toBe("won");
  });

  it("records the quarter and overtime lines as period scores", () => {
    const result = verified(
      parseBasketballResult("fx", {
        status: "FT Game Finished",
        scores: {
          home: { quarter_1: 25, quarter_2: 25, quarter_3: 25, quarter_4: 25, over_time: 10, total: 110 },
          away: { quarter_1: 25, quarter_2: 25, quarter_3: 25, quarter_4: 25, over_time: 5, total: 105 }
        }
      })
    );
    expect(result.periodScores.map((period) => period.period)).toEqual(["q1", "q2", "q3", "q4", "ot1"]);
  });
});

describe("API-Tennis", () => {
  it("counts sets and sums games from the per-set list", () => {
    const result = verified(
      parseTennisResult("fx", {
        event_status: "Finished",
        event_final_result: "2 - 1",
        event_game_result: "6-4 3-6 7-5",
        event_winner: "First Player"
      })
    );
    expect(result.setsHome).toBe(2);
    expect(result.setsAway).toBe(1);
    expect(result.gamesHome).toBe(16);
    expect(result.gamesAway).toBe(15);
    expect(settle(result, { selectionKey: "tennis.total_games.full_match.over.30_5" }).outcome).toBe("won");
  });

  it("reads a lone aggregate as the set count, not as one set", () => {
    // "2 - 1" fed to a per-set accumulator would score as 1-0.
    const result = verified(parseTennisResult("fx", { event_status: "Finished", event_final_result: "2 - 1" }));
    expect(result.setsHome).toBe(2);
    expect(result.setsAway).toBe(1);
    expect(result.gamesHome).toBeNull();
  });

  it("settles the match winner on a retirement but voids the set markets", () => {
    const result = verified(
      parseTennisResult("fx", {
        event_status: "Retired",
        event_game_result: "6-2 3-1",
        event_winner: "First Player"
      })
    );
    expect(result.resultStatus).toBe("retired");
    expect(result.winnerBasis).toBe("retirement");
    expect(settle(result, { selectionKey: "tennis.match_winner.full_match.player_a" }).outcome).toBe("won");
    expect(settle(result, { selectionKey: "tennis.set_handicap.full_match.player_a.-1_5" }).outcome).toBe("void");
  });

  it("voids everything on a walkover and names no winner", () => {
    const result = verified(parseTennisResult("fx", { event_status: "Walkover", event_winner: "First Player" }));
    expect(result.winner).toBe("none");
    expect(result.winnerBasis).toBe("walkover");
    expect(settle(result, { selectionKey: "tennis.match_winner.full_match.player_a" }).outcome).toBe("void");
  });

  it("returns null for a match still in progress", () => {
    expect(parseTennisResult("fx", { event_status: "Set 2" })).toBeNull();
  });
});
