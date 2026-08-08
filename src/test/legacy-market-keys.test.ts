import { describe, expect, it } from "vitest";
import { decodeLegacyLine, legacySelectionKey } from "@/lib/markets/legacyKeys";
import { emptyResult } from "@/lib/results/canonicalResult";
import { settle } from "@/lib/settlement/grade";

describe("legacy line decoding", () => {
  it("reads the implied decimal in the trailing digits", () => {
    expect(decodeLegacyLine("25")).toBe(2.5);
    expect(decodeLegacyLine("45")).toBe(4.5);
    expect(decodeLegacyLine("505")).toBe(50.5);
    expect(decodeLegacyLine("545")).toBe(54.5);
    expect(decodeLegacyLine("3")).toBe(3);
  });

  it("refuses anything that is not digits", () => {
    expect(decodeLegacyLine("")).toBeNull();
    expect(decodeLegacyLine("2.5")).toBeNull();
    expect(decodeLegacyLine("-25")).toBeNull();
  });
});

describe("legacy claim resolution", () => {
  it("maps football match_winner onto the regulation market", () => {
    expect(legacySelectionKey({ sport: "football", market: "match_winner", selection: "home" })).toBe(
      "football.1x2.regulation.home"
    );
    expect(legacySelectionKey({ sport: "football", market: "match_winner", selection: "draw" })).toBe(
      "football.1x2.regulation.draw"
    );
  });

  it("maps basketball moneyline onto the full-game market, not the regulation one", () => {
    // No stored decision ever distinguished the regulation variant. Assuming it
    // did would silently re-grade every historical basketball claim.
    expect(legacySelectionKey({ sport: "basketball", market: "match_winner", selection: "home" })).toBe(
      "basketball.moneyline.full_game_incl_ot.home"
    );
  });

  it("maps tennis home and away onto player_a and player_b", () => {
    expect(legacySelectionKey({ sport: "tennis", market: "match_winner", selection: "home" })).toBe(
      "tennis.match_winner.full_match.player_a"
    );
    expect(legacySelectionKey({ sport: "tennis", market: "match_winner", selection: "away" })).toBe(
      "tennis.match_winner.full_match.player_b"
    );
  });

  it("recovers the line from every legacy totals spelling", () => {
    const expected = "football.total_goals.regulation.over.2_5";
    expect(legacySelectionKey({ sport: "football", market: "over_under_25", selection: "over_25" })).toBe(expected);
    expect(legacySelectionKey({ sport: "football", market: "total_goals", selection: "over_25" })).toBe(expected);
    expect(legacySelectionKey({ sport: "football", market: "totals", selection: "over", marketLine: 2.5 })).toBe(expected);
    expect(legacySelectionKey({ sport: "football", market: "over_under", selection: "over", marketLine: 2.5 })).toBe(expected);
  });

  it("prefers the stored line over the one encoded in the name", () => {
    // If the row carries market_line, that is the number the claim was made
    // against; the name is a label.
    expect(
      legacySelectionKey({ sport: "football", market: "over_under_25", selection: "over_25", marketLine: 3.5 })
    ).toBe("football.total_goals.regulation.over.3_5");
  });

  it("routes totals to the right market per sport", () => {
    expect(legacySelectionKey({ sport: "basketball", market: "total_points", selection: "over", marketLine: 214.5 })).toBe(
      "basketball.total_points.full_game_incl_ot.over.214_5"
    );
    expect(legacySelectionKey({ sport: "tennis", market: "total_games", selection: "over", marketLine: 22.5 })).toBe(
      "tennis.total_games.full_match.over.22_5"
    );
  });

  it("maps BTTS, double chance and draw no bet", () => {
    expect(legacySelectionKey({ sport: "football", market: "both_teams_to_score", selection: "yes" })).toBe(
      "football.btts.regulation.yes"
    );
    expect(legacySelectionKey({ sport: "football", market: "double_chance", selection: "1x" })).toBe(
      "football.double_chance.regulation.1x"
    );
    // The spelling production actually stores, measured: 1,692 rows.
    expect(legacySelectionKey({ sport: "football", market: "double_chance", selection: "home_or_draw" })).toBe(
      "football.double_chance.regulation.1x"
    );
    expect(legacySelectionKey({ sport: "football", market: "double_chance", selection: "home_or_away" })).toBe(
      "football.double_chance.regulation.12"
    );
    expect(legacySelectionKey({ sport: "football", market: "double_chance", selection: "draw_or_away" })).toBe(
      "football.double_chance.regulation.x2"
    );
    // A spelling neither vocabulary uses stays unmapped rather than guessed.
    expect(legacySelectionKey({ sport: "football", market: "double_chance", selection: "home_or_nothing" })).toBeNull();
    expect(legacySelectionKey({ sport: "football", market: "draw_no_bet", selection: "home" })).toBe(
      "football.draw_no_bet.regulation.home"
    );
  });

  it("resolves a spread only when the row carries a line", () => {
    expect(
      legacySelectionKey({ sport: "basketball", market: "spread", selection: "home_cover", marketLine: -4.5 })
    ).toBe("basketball.spread.full_game_incl_ot.home.-4_5");
    // The case that made these ungradeable. Inventing a line now would turn an
    // honest gap into a wrong verdict.
    expect(legacySelectionKey({ sport: "basketball", market: "spread", selection: "home_cover" })).toBeNull();
  });

  it("resolves an asian handicap including quarter lines", () => {
    expect(
      legacySelectionKey({ sport: "football", market: "asian_handicap", selection: "home", marketLine: -0.25 })
    ).toBe("football.asian_handicap.regulation.home.-0_25");
  });

  it("refuses a line the market's granularity does not carry", () => {
    // Spread is half-line only; a quarter line there is not rounded, it fails.
    expect(
      legacySelectionKey({ sport: "basketball", market: "spread", selection: "home_cover", marketLine: -4.25 })
    ).toBeNull();
  });

  it("returns null for anything it does not recognise", () => {
    expect(legacySelectionKey({ sport: "football", market: "corners", selection: "over_95" })).toBeNull();
    expect(legacySelectionKey({ sport: "football", market: "correct_score", selection: "2_1" })).toBeNull();
    expect(legacySelectionKey({ sport: "football", market: "match_winner", selection: "nobody" })).toBeNull();
  });
});

describe("legacy claims settle end to end", () => {
  it("grades a stored over_under_25 claim against a canonical result", () => {
    const key = legacySelectionKey({ sport: "football", market: "over_under_25", selection: "over_25" })!;
    const result = {
      ...emptyResult("fx", "football"),
      verificationState: "verified" as const,
      regulationHome: 2,
      regulationAway: 1,
      winner: "home" as const,
      winnerBasis: "regulation" as const
    };
    const settled = settle(result, { selectionKey: key });
    expect(settled.outcome).toBe("won");
    expect(settled.marketKey).toBe("football.total_goals.regulation");
    expect(settled.basis).toBe("regulation");
  });

  it("grades a stored basketball spread claim that was previously ungradeable", () => {
    const key = legacySelectionKey({
      sport: "basketball",
      market: "spread",
      selection: "home_cover",
      marketLine: -4.5
    })!;
    const result = {
      ...emptyResult("fx", "basketball"),
      verificationState: "verified" as const,
      regulationHome: 100,
      regulationAway: 100,
      extraTimeHome: 110,
      extraTimeAway: 105,
      winner: "home" as const,
      winnerBasis: "extra_time" as const
    };
    expect(settle(result, { selectionKey: key }).outcome).toBe("won");
  });
});
