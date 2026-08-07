import { describe, expect, it } from "vitest";
import { compareSettlement, suggestCandidates } from "@/lib/markets/candidates";
import type { MarketAlias } from "@/lib/markets/alias";

function query(overrides: Partial<Parameters<typeof suggestCandidates>[0]> = {}) {
  return { sport: "football", rawMarket: "h2h", rawSelection: "Home", ...overrides };
}

describe("candidate suggestion", () => {
  it("maps a provider's h2h/Home onto the regulation 1X2 market", () => {
    const [top] = suggestCandidates(query());
    expect(top?.canonicalSelectionKey).toBe("football.1x2.regulation.home");
    expect(top?.reasons.join(" ")).toContain("match-winner synonym");
  });

  it("carries the settlement facts a reviewer needs, not just a score", () => {
    const [top] = suggestCandidates(query());
    expect(top?.basis).toBe("regulation");
    expect(top?.overtimeRule).toBe("excluded");
    expect(top?.retirementRule).toBe("not_applicable");
  });

  it("reads 1, X and 2 as home, draw and away", () => {
    expect(suggestCandidates(query({ rawSelection: "1" }))[0]?.canonicalSelectionKey).toBe("football.1x2.regulation.home");
    expect(suggestCandidates(query({ rawSelection: "X" }))[0]?.canonicalSelectionKey).toBe("football.1x2.regulation.draw");
    expect(suggestCandidates(query({ rawSelection: "2" }))[0]?.canonicalSelectionKey).toBe("football.1x2.regulation.away");
  });

  it("requires a line for a market that needs one rather than offering a lower-confidence guess", () => {
    // A mapping that cannot be completed is not a weak candidate.
    expect(suggestCandidates(query({ rawMarket: "Asian Handicap", rawSelection: "Home" }))).toEqual([]);
    const withLine = suggestCandidates(query({ rawMarket: "Asian Handicap", rawSelection: "Home", rawLine: "-0.25" }));
    expect(withLine[0]?.canonicalSelectionKey).toBe("football.asian_handicap.regulation.home.-0_25");
  });

  it("refuses a line the market's granularity does not carry", () => {
    // Basketball spread is half-line only.
    expect(
      suggestCandidates({ sport: "basketball", rawMarket: "Spread", rawSelection: "Home", rawLine: "-4.25" })
    ).toEqual([]);
    expect(
      suggestCandidates({ sport: "basketball", rawMarket: "Spread", rawSelection: "Home", rawLine: "-4.5" })[0]
        ?.canonicalSelectionKey
    ).toBe("basketball.spread.full_game_incl_ot.home.-4_5");
  });

  it("refuses a line on a market that carries none", () => {
    expect(suggestCandidates(query({ rawLine: "2.5" }))).toEqual([]);
  });

  it("raises confidence when other providers already map there, and says so", () => {
    const existing = [
      {
        id: "a",
        canonicalSelectionKey: "football.1x2.regulation.home",
        status: "active",
        provider: "other"
      } as unknown as MarketAlias
    ];
    const without = suggestCandidates(query())[0]!;
    const with_ = suggestCandidates(query({ existingAliases: existing }))[0]!;
    expect(with_.confidence).toBeGreaterThan(without.confidence);
    expect(with_.reasons.join(" ")).toContain("already point here");
  });

  it("never reaches certainty", () => {
    // A high score is an argument, not a decision. The failure mode of a good
    // matcher is being right often enough that somebody stops reading.
    const existing = Array.from({ length: 20 }, (_, index) => ({
      id: `a${index}`,
      canonicalSelectionKey: "football.1x2.regulation.home",
      status: "active",
      provider: `p${index}`
    })) as unknown as MarketAlias[];
    expect(suggestCandidates(query({ existingAliases: existing }))[0]!.confidence).toBeLessThan(1);
  });

  it("suggests nothing for a market family it does not recognise", () => {
    expect(suggestCandidates(query({ rawMarket: "Corners", rawSelection: "Over" }))).toEqual([]);
  });

  it("does not cross sports", () => {
    expect(suggestCandidates(query({ sport: "tennis", rawMarket: "h2h", rawSelection: "Home" }))).toEqual([]);
  });
});

describe("settlement comparison", () => {
  it("names the field that differs rather than leaving it to be spotted", () => {
    const comparison = compareSettlement("football.draw_no_bet.regulation", "football.asian_handicap.regulation");
    expect(comparison.differences.map((difference) => difference.field)).toContain("pushRule");
    expect(comparison.differences.length).toBeGreaterThan(0);
  });

  it("finds the overtime difference between the two basketball moneylines", () => {
    const comparison = compareSettlement("basketball.moneyline.full_game_incl_ot", "basketball.moneyline.regulation");
    const fields = comparison.differences.map((difference) => difference.field);
    expect(fields).toContain("overtimeRule");
    expect(fields).toContain("basis");
  });

  it("reports no differences for a market against itself", () => {
    expect(compareSettlement("football.1x2.regulation", "football.1x2.regulation").differences).toEqual([]);
  });

  it("returns nulls for a key that is not canonical", () => {
    const comparison = compareSettlement("football.corners.regulation", "football.1x2.regulation");
    expect(comparison.left).toBeNull();
    expect(comparison.differences).toEqual([]);
  });
});
