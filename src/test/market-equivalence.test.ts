import { describe, expect, it } from "vitest";
import {
  applyOrientation,
  checkMarketCompleteness,
  checkOverround,
  isComparable,
  resolveAlias,
  settlementRulesDiffer,
  validateAlias,
  type MarketAlias
} from "@/lib/markets/alias";
import { canonicalMarket } from "@/lib/markets/canonicalMarkets";
import { convertSelection, ODDSPADI_TEXT_TARGET, platformTarget } from "@/lib/markets/conversion";

function alias(overrides: Partial<MarketAlias> = {}): MarketAlias {
  return {
    id: "alias-1",
    provider: "the-odds-api",
    sourceSport: "soccer_epl",
    rawMarket: "h2h",
    rawSelection: "Home",
    rawLine: null,
    participantOrder: "as_listed",
    canonicalMarketKey: "football.1x2.regulation",
    canonicalSelectionKey: "football.1x2.regulation.home",
    mappingState: "exact_equivalent",
    confidence: 0.95,
    conditions: [],
    evidence: {},
    effectiveFrom: "2026-06-01T00:00:00.000Z",
    effectiveTo: null,
    version: 1,
    supersedesAliasId: null,
    status: "active",
    createdBy: "analyst-a",
    reviewer: "analyst-b",
    reviewedAt: "2026-06-01T00:00:00.000Z",
    ...overrides
  };
}

function query(asOf: string, overrides: Record<string, unknown> = {}) {
  return { provider: "the-odds-api", sourceSport: "soccer_epl", rawMarket: "h2h", rawSelection: "Home", rawLine: null, asOf, ...overrides } as Parameters<typeof resolveAlias>[1];
}

describe("temporal resolution", () => {
  it("resolves through the alias effective at the time, not the current one", () => {
    const june = alias({
      id: "june",
      canonicalSelectionKey: "football.1x2.regulation.home",
      effectiveFrom: "2026-06-01T00:00:00.000Z",
      effectiveTo: "2026-07-01T00:00:00.000Z"
    });
    const july = alias({
      id: "july",
      // A correction: the provider's "Home" was actually the away side.
      canonicalSelectionKey: "football.1x2.regulation.away",
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      effectiveTo: null,
      version: 2,
      supersedesAliasId: "june"
    });

    const inJune = resolveAlias([june, july], query("2026-06-15T00:00:00.000Z"));
    const inAugust = resolveAlias([june, july], query("2026-08-07T00:00:00.000Z"));

    expect(inJune.status).toBe("resolved");
    expect(inJune.status === "resolved" && inJune.selectionKey).toBe("football.1x2.regulation.home");
    // The July correction did not rewrite what June meant.
    expect(inAugust.status === "resolved" && inAugust.selectionKey).toBe("football.1x2.regulation.away");
  });

  it("is unmapped before the alias existed", () => {
    expect(resolveAlias([alias()], query("2026-05-01T00:00:00.000Z")).status).toBe("unmapped");
  });

  it("ignores drafts and retired aliases", () => {
    expect(resolveAlias([alias({ status: "draft" })], query("2026-07-01T00:00:00.000Z")).status).toBe("unmapped");
    expect(resolveAlias([alias({ status: "retired" })], query("2026-07-01T00:00:00.000Z")).status).toBe("unmapped");
  });

  it("blocks rather than guessing when two active aliases overlap", () => {
    const resolution = resolveAlias([alias({ id: "a" }), alias({ id: "b" })], query("2026-07-01T00:00:00.000Z"));
    expect(resolution.status).toBe("blocked");
    expect(resolution.status === "blocked" && resolution.reason).toContain("ambiguous");
  });

  it("blocks an alias pointing at a market that is not in the registry", () => {
    const broken = alias({ canonicalSelectionKey: "football.corners.regulation.over.9_5" });
    const resolution = resolveAlias([broken], query("2026-07-01T00:00:00.000Z"));
    expect(resolution.status).toBe("blocked");
  });
});

describe("mapping states", () => {
  it("permits comparison only where settlement agrees", () => {
    expect(isComparable("exact_equivalent")).toBe(true);
    expect(isComparable("conditionally_equivalent")).toBe(true);
    expect(isComparable("different_settlement")).toBe(false);
    expect(isComparable("ambiguous")).toBe(false);
    expect(isComparable("unsupported")).toBe(false);
    expect(isComparable("rejected")).toBe(false);
  });

  it("blocks resolution for states that name no usable selection", () => {
    for (const state of ["ambiguous", "unsupported", "rejected"] as const) {
      const resolution = resolveAlias([alias({ mappingState: state })], query("2026-07-01T00:00:00.000Z"));
      expect(resolution.status).toBe("blocked");
    }
  });
});

describe("the named hard cases", () => {
  it("finds a real difference between draw no bet and asian handicap 0", () => {
    // Identical single-bet payout, different push/void mechanics. A name
    // comparison would call these equivalent.
    const differences = settlementRulesDiffer("football.draw_no_bet.regulation", "football.asian_handicap.regulation");
    expect(differences.length).toBeGreaterThan(0);
    expect(differences.join(" ")).toContain("push");
  });

  it("separates 1X2 regulation from a market that reads past normal time", () => {
    const differences = settlementRulesDiffer("football.1x2.regulation", "football.to_qualify.including_shootout");
    expect(differences.join(" ")).toContain("overtime");
    expect(differences.join(" ")).toContain("basis");
  });

  it("separates basketball moneyline by overtime treatment", () => {
    const differences = settlementRulesDiffer("basketball.moneyline.full_game_incl_ot", "basketball.moneyline.regulation");
    expect(differences.join(" ")).toContain("overtime included vs excluded");
  });

  it("separates tennis markets that survive a retirement from those that do not", () => {
    const differences = settlementRulesDiffer("tennis.match_winner.full_match", "tennis.set_handicap.full_match");
    expect(differences.join(" ")).toContain("retirement");
  });

  it("finds no difference between a market and itself", () => {
    expect(settlementRulesDiffer("football.1x2.regulation", "football.1x2.regulation")).toEqual([]);
  });

  it("reverses participants without rewriting the raw evidence", () => {
    expect(applyOrientation("home", "reversed")).toBe("away");
    expect(applyOrientation("away", "reversed")).toBe("home");
    expect(applyOrientation("player_a", "reversed")).toBe("player_b");
    expect(applyOrientation("1x", "reversed")).toBe("x2");
    expect(applyOrientation("draw", "reversed")).toBe("draw");
    expect(applyOrientation("home", "as_listed")).toBe("home");
  });
});

describe("quality controls", () => {
  it("detects a duplicate alias with an overlapping window", () => {
    const defects = validateAlias(alias({ id: "new" }), [alias({ id: "existing" })]);
    expect(defects.map((defect) => defect.check)).toContain("duplicate_alias");
  });

  it("detects a version conflict on the same source key", () => {
    const defects = validateAlias(alias({ id: "new", version: 1 }), [alias({ id: "existing", version: 1 })]);
    expect(defects.map((defect) => defect.check)).toContain("version_conflict");
  });

  it("accepts an alias whose window does not overlap the existing one", () => {
    const existing = alias({ id: "existing", effectiveTo: "2026-07-01T00:00:00.000Z" });
    const next = alias({ id: "next", effectiveFrom: "2026-07-01T00:00:00.000Z", version: 2 });
    expect(validateAlias(next, [existing])).toEqual([]);
  });

  it("detects an impossible line", () => {
    // A quarter line on a market that only carries halves.
    const defects = validateAlias(
      alias({
        canonicalMarketKey: "basketball.spread.full_game_incl_ot",
        canonicalSelectionKey: "basketball.spread.full_game_incl_ot.home.-4_25"
      }),
      []
    );
    expect(defects.map((defect) => defect.check)).toContain("impossible_line");
  });

  it("detects a line on a market that carries none", () => {
    const defects = validateAlias(alias({ canonicalSelectionKey: "football.1x2.regulation.home.0" }), []);
    expect(defects.map((defect) => defect.check)).toContain("impossible_line");
  });

  it("refuses a mapping whose participant orientation is unknown", () => {
    const defects = validateAlias(alias({ participantOrder: "unknown" }), []);
    expect(defects.map((defect) => defect.check)).toContain("participant_orientation");
  });

  it("rejects exact_equivalent carrying conditions at write time", () => {
    const defects = validateAlias(alias({ mappingState: "exact_equivalent", conditions: ["accumulator_treatment_differs"] }), []);
    const defect = defects.find((entry) => entry.check === "incompatible_settlement");
    expect(defect?.severity).toBe("critical");
  });

  it("flags an overround outside the band", () => {
    expect(checkOverround([0.5, 0.5])).toBeNull();
    expect(checkOverround([0.55, 0.55])).toBeNull();
    expect(checkOverround([0.8, 0.8])?.check).toBe("overround_sanity");
    expect(checkOverround([0.4, 0.4])?.check).toBe("overround_sanity");
  });

  it("flags a market that cannot be de-vigged", () => {
    expect(checkOverround([0.5])?.check).toBe("market_set_completeness");
  });

  it("flags an incomplete market", () => {
    const market = canonicalMarket("football.1x2.regulation")!;
    expect(checkMarketCompleteness(market, ["home", "away"])?.check).toBe("market_completeness");
    expect(checkMarketCompleteness(market, ["home", "draw", "away"])).toBeNull();
    // Duplicates do not count toward completeness.
    expect(checkMarketCompleteness(market, ["home", "home", "home"])?.check).toBe("market_completeness");
  });
});

describe("slip conversion", () => {
  const platform = ODDSPADI_TEXT_TARGET;

  function convert(selectionKey: string, aliases: MarketAlias[], target = platform) {
    return convertSelection(selectionKey, { platform: target, aliases, asOf: "2026-08-07T00:00:00.000Z" });
  }

  function platformAlias(overrides: Partial<MarketAlias> = {}): MarketAlias {
    return alias({ provider: "oddspadi-text", rawMarket: "Match winner", rawSelection: "Home", ...overrides });
  }

  it("returns an exact match where settlement agrees", () => {
    const result = convert("football.1x2.regulation.home", [platformAlias()]);
    expect(result.status).toBe("exact");
    expect(result.status === "exact" && result.label).toBe("Home");
  });

  it("never returns exact when the mapping says settlement differs", () => {
    // The single claim a user would act on financially.
    const result = convert("football.1x2.regulation.home", [platformAlias({ mappingState: "different_settlement" })]);
    expect(result.status).toBe("settlement_warning");
    expect(result.status === "settlement_warning" && result.warning).toContain("may not");
  });

  it("carries the conditions on a conditional match", () => {
    const result = convert("football.1x2.regulation.home", [
      platformAlias({ mappingState: "conditionally_equivalent", conditions: ["accumulator_treatment_differs"] })
    ]);
    expect(result.status).toBe("conditional");
    expect(result.status === "conditional" && result.settlementWarning).toContain("accumulator_treatment_differs");
  });

  it("downgrades a mapping that claims exact while the rules actually differ", () => {
    const lying = platformAlias({
      mappingState: "exact_equivalent",
      canonicalMarketKey: "football.draw_no_bet.regulation",
      canonicalSelectionKey: "football.1x2.regulation.home"
    });
    const result = convert("football.1x2.regulation.home", [lying]);
    expect(result.status).toBe("settlement_warning");
  });

  it("reports an unsupported market rather than an unavailable one", () => {
    const result = convert("basketball.spread.full_game_incl_ot.home.-4_5", [platformAlias()]);
    expect(result.status).toBe("unsupported");
    expect(result.status === "unsupported" && result.reason).toContain("does not carry");
  });

  it("distinguishes a missing label from an unsupported market", () => {
    // The platform carries totals, but we have no label for this line.
    const missingLabel = convert("football.total_goals.regulation.over.3_5", [platformAlias()]);
    expect(missingLabel.status).toBe("unavailable");
  });

  it("is unavailable when no approved mapping links the platform to the selection", () => {
    const result = convert("football.1x2.regulation.home", []);
    expect(result.status).toBe("unavailable");
  });

  it("is unavailable while a mapping is ambiguous", () => {
    const result = convert("football.1x2.regulation.home", [platformAlias({ mappingState: "ambiguous" })]);
    expect(result.status).toBe("unavailable");
  });

  it("is unavailable for an unregistered platform", () => {
    const result = convertSelection("football.1x2.regulation.home", {
      platform: platformTarget("some-bookmaker"),
      aliases: [],
      asOf: "2026-08-07T00:00:00.000Z"
    });
    expect(result.status).toBe("unavailable");
  });

  it("rejects a selection key that is not canonical", () => {
    expect(convert("not.a.real.key", [platformAlias()]).status).toBe("unsupported");
  });
});
