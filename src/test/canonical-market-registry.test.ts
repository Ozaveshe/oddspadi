import { describe, expect, it } from "vitest";
import { decodeLine, encodeLine, formatSelectionKey, parseSelectionKey } from "@/lib/markets/canonicalKey";
import {
  CANONICAL_MARKETS,
  canonicalMarket,
  canonicalSelection,
  lineFitsGranularity
} from "@/lib/markets/canonicalMarkets";

describe("canonical key grammar", () => {
  it("encodes and decodes lines without losing the sign or the quarter", () => {
    expect(encodeLine(-0.25)).toBe("-0_25");
    expect(encodeLine(2.5)).toBe("2_5");
    expect(encodeLine(0)).toBe("0");
    expect(encodeLine(214.5)).toBe("214_5");
    expect(decodeLine("-0_25")).toBe(-0.25);
    expect(decodeLine("2_5")).toBe(2.5);
    expect(decodeLine("0")).toBe(0);
  });

  it("normalises negative zero so home.0 has one spelling", () => {
    expect(encodeLine(-0)).toBe("0");
  });

  it("round-trips a selection key", () => {
    const key = formatSelectionKey("football.asian_handicap.regulation", "home", -0.25);
    expect(key).toBe("football.asian_handicap.regulation.home.-0_25");
    const parsed = parseSelectionKey(key);
    expect(parsed).toMatchObject({
      marketKey: "football.asian_handicap.regulation",
      sport: "football",
      family: "asian_handicap",
      period: "regulation",
      selection: "home",
      line: -0.25
    });
  });

  it("omits the line segment entirely when there is no line", () => {
    expect(formatSelectionKey("football.1x2.regulation", "home")).toBe("football.1x2.regulation.home");
    expect(parseSelectionKey("football.1x2.regulation.home")?.line).toBeNull();
  });

  it("rejects a fifth segment that is not a line rather than discarding it", () => {
    // Silently dropping the segment is how `-0.25` becomes `0`.
    expect(parseSelectionKey("football.asian_handicap.regulation.home.quarter")).toBeNull();
  });

  it("rejects malformed keys", () => {
    expect(parseSelectionKey("football.1x2.regulation")).toBeNull();
    expect(parseSelectionKey("football..regulation.home")).toBeNull();
    expect(parseSelectionKey("football.1x2.regulation.home.2_5.extra")).toBeNull();
    expect(parseSelectionKey("")).toBeNull();
  });
});

describe("line granularity", () => {
  it("accepts quarter lines only where quarter granularity is declared", () => {
    expect(lineFitsGranularity(-0.25, "quarter")).toBe(true);
    expect(lineFitsGranularity(-0.25, "half")).toBe(false);
    expect(lineFitsGranularity(-0.5, "half")).toBe(true);
    expect(lineFitsGranularity(-0.5, "integer")).toBe(false);
    expect(lineFitsGranularity(3, "integer")).toBe(true);
  });

  it("is exact at the values floating point is worst at", () => {
    expect(lineFitsGranularity(0.1, "quarter")).toBe(false);
    expect(lineFitsGranularity(2.75, "quarter")).toBe(true);
    expect(lineFitsGranularity(2.75, "half")).toBe(false);
  });

  it("never accepts a line on a market that declares none", () => {
    expect(lineFitsGranularity(0, "none")).toBe(false);
  });
});

describe("canonical registry", () => {
  it("has unique keys", () => {
    const keys = CANONICAL_MARKETS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every market a key matching its own sport, family and period", () => {
    for (const entry of CANONICAL_MARKETS) {
      expect(entry.key).toBe(`${entry.sport}.${entry.family}.${entry.period}`);
    }
  });

  it("gives every market a plain-language settlement basis statement", () => {
    for (const entry of CANONICAL_MARKETS) {
      expect(entry.settlementBasisStatement.length).toBeGreaterThan(20);
    }
  });

  it("declares line granularity consistently with lineRequired", () => {
    for (const entry of CANONICAL_MARKETS) {
      expect(entry.lineGranularity === "none").toBe(!entry.lineRequired);
    }
  });

  it("gives ternary markets three selections and binary markets two", () => {
    for (const entry of CANONICAL_MARKETS) {
      if (entry.selectionType === "ternary") expect(entry.selections).toHaveLength(3);
      if (entry.selectionType === "binary") expect(entry.selections).toHaveLength(2);
    }
  });

  it("separates basketball moneyline by period rather than by a flag", () => {
    const fullGame = canonicalMarket("basketball.moneyline.full_game_incl_ot");
    const regulation = canonicalMarket("basketball.moneyline.regulation");
    expect(fullGame?.overtimeRule).toBe("included");
    expect(regulation?.overtimeRule).toBe("excluded");
    // Regulation basketball can be tied, so the regulation market is three-way
    // where the full-game market is two-way. Modelling this as one market with
    // a flag would have made the tie unrepresentable.
    expect(fullGame?.selectionType).toBe("binary");
    expect(regulation?.selectionType).toBe("ternary");
  });

  it("settles football 1X2 on regulation, not on the eventual winner", () => {
    expect(canonicalMarket("football.1x2.regulation")?.basis).toBe("regulation");
    expect(canonicalMarket("football.1x2.regulation")?.overtimeRule).toBe("excluded");
    // The only football market that reads past normal time.
    expect(canonicalMarket("football.to_qualify.including_shootout")?.overtimeRule).toBe("included");
  });

  it("distinguishes tennis markets that survive a retirement from those that do not", () => {
    expect(canonicalMarket("tennis.match_winner.full_match")?.retirementRule).toBe("settle_on_award");
    expect(canonicalMarket("tennis.set_handicap.full_match")?.retirementRule).toBe("void");
    expect(canonicalMarket("tennis.total_games.full_match")?.retirementRule).toBe("void");
  });
});

describe("canonical selection resolution", () => {
  it("resolves a known selection with its line", () => {
    const resolved = canonicalSelection("football.asian_handicap.regulation.home.-0_25");
    expect(resolved?.market.key).toBe("football.asian_handicap.regulation");
    expect(resolved?.selection.id).toBe("home");
    expect(resolved?.line).toBe(-0.25);
  });

  it("refuses a line on a market that has none, and a missing line where one is required", () => {
    expect(canonicalSelection("football.1x2.regulation.home.0")).toBeNull();
    expect(canonicalSelection("football.asian_handicap.regulation.home")).toBeNull();
  });

  it("refuses a line the market's granularity does not support rather than rounding it", () => {
    // Rounding would settle the claim against a line nobody quoted.
    expect(canonicalSelection("basketball.spread.full_game_incl_ot.home.-4_25")).toBeNull();
    expect(canonicalSelection("basketball.spread.full_game_incl_ot.home.-4_5")).not.toBeNull();
  });

  it("refuses an unknown selection on a known market", () => {
    expect(canonicalSelection("football.1x2.regulation.nobody")).toBeNull();
    expect(canonicalSelection("football.1x2.regulation.draw")).not.toBeNull();
  });

  it("refuses an unknown market", () => {
    expect(canonicalSelection("football.corners.regulation.over.9_5")).toBeNull();
  });
});
