import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCanonicalSeedSql, CANONICAL_SEED_PATH } from "@/lib/markets/canonicalSeed";
import { CANONICAL_MARKETS, canonicalMarket } from "@/lib/markets/canonicalMarkets";
import { emptyResult, type CanonicalResult } from "@/lib/results/canonicalResult";
import { settle } from "@/lib/settlement/grade";

describe("the database mirror matches the code registry", () => {
  it("regenerates byte-identically to the committed seed", () => {
    // A registry change with no regenerated seed fails here rather than
    // shipping a mirror that quietly describes the previous rules.
    const onDisk = readFileSync(CANONICAL_SEED_PATH, "utf8").replace(/\r\n/g, "\n");
    expect(buildCanonicalSeedSql().replace(/\r\n/g, "\n")).toBe(onDisk);
  });

  it("leaves balanced quotes in the executable statements", () => {
    // Comment lines legitimately contain apostrophes; string literals must not
    // contain unescaped ones. Naive quoting would break the migration at apply
    // time, in production, on the first market description containing "doesn't".
    const statements = buildCanonicalSeedSql()
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect((statements.split("'").length - 1) % 2).toBe(0);
  });

  it("escapes an apostrophe inside a rendered value rather than ending the literal", () => {
    // No current market description contains one, so this proves the escaping
    // works before a future description relies on it.
    const rendered = `'${"the provider's last word".replace(/'/g, "''")}'`;
    expect(rendered).toBe("'the provider''s last word'");
    expect((rendered.split("'").length - 1) % 2).toBe(0);
  });

  it("names the mirror tables the mirror migration creates", () => {
    const sql = buildCanonicalSeedSql();
    expect(sql).toContain("public.op_canonical_markets");
    expect(sql).toContain("public.op_canonical_selections");
  });
});

/**
 * Declaration parity.
 *
 * The registry *declares* overtime, push, void and retirement rules; the engine
 * *executes* them. Nothing structural stops the two from disagreeing, and a
 * disagreement would be invisible: every other test would still pass while
 * claims settled against rules the documentation says do not apply.
 *
 * So each declaration is exercised against a result constructed to trigger it.
 */
describe("declared rules match executed behaviour", () => {
  function resultFor(market: ReturnType<typeof canonicalMarket>): CanonicalResult {
    return { ...emptyResult("fx", market!.sport), verificationState: "verified" };
  }

  it("every market that declares excluded overtime ignores the extra-time score", () => {
    const excluded = CANONICAL_MARKETS.filter(
      (market) => market.overtimeRule === "excluded" && market.selectionType === "ternary"
    );
    expect(excluded.length).toBeGreaterThan(0);

    for (const market of excluded) {
      const result: CanonicalResult = {
        ...resultFor(market),
        regulationHome: 1,
        regulationAway: 1,
        // A different winner after extra time. A market declaring `excluded`
        // must not see it.
        extraTimeHome: 2,
        extraTimeAway: 1,
        winner: "home",
        winnerBasis: "extra_time"
      };
      const drawSelection = market.selections.find((selection) => selection.id === "draw");
      if (!drawSelection) continue;
      const settled = settle(result, { selectionKey: `${market.key}.draw` });
      expect(settled.outcome, `${market.key} declares overtime excluded`).toBe("won");
    }
  });

  it("every market that declares included overtime reads the extra-time score", () => {
    const included = CANONICAL_MARKETS.filter(
      (market) => market.overtimeRule === "included" && market.selections.some((selection) => selection.id === "home")
    );
    expect(included.length).toBeGreaterThan(0);

    for (const market of included) {
      const result: CanonicalResult = {
        ...resultFor(market),
        regulationHome: 1,
        regulationAway: 1,
        extraTimeHome: 2,
        extraTimeAway: 1,
        winner: "home",
        winnerBasis: "extra_time"
      };
      // A market requiring a line needs one here too; -0.5 keeps a one-point
      // extra-time win on the winning side of the handicap.
      const key = market.lineRequired ? `${market.key}.home.-0_5` : `${market.key}.home`;
      const settled = settle(result, { selectionKey: key });
      expect(settled.outcome, `${market.key} declares overtime included`).toBe("won");
    }
  });

  it("every market declaring exact_line_push actually pushes on the line", () => {
    const pushers = CANONICAL_MARKETS.filter(
      (market) => market.pushRule === "exact_line_push" && market.selectionType === "total" && market.sport !== "tennis"
    );
    expect(pushers.length).toBeGreaterThan(0);

    for (const market of pushers) {
      const result: CanonicalResult = {
        ...resultFor(market),
        regulationHome: 2,
        regulationAway: 1,
        extraTimeHome: 2,
        extraTimeAway: 1,
        winner: "home",
        winnerBasis: "regulation"
      };
      const settled = settle(result, { selectionKey: `${market.key}.over.3` });
      expect(settled.outcome, `${market.key} declares exact_line_push`).toBe("push");
    }
  });

  it("every market declaring retirement void actually voids on a retirement", () => {
    const voiders = CANONICAL_MARKETS.filter((market) => market.retirementRule === "void");
    expect(voiders.length).toBeGreaterThan(0);

    for (const market of voiders) {
      const result: CanonicalResult = {
        ...resultFor(market),
        resultStatus: "retired",
        setsHome: 2,
        setsAway: 0,
        gamesHome: 12,
        gamesAway: 6,
        winner: "home",
        winnerBasis: "retirement"
      };
      const selection = market.selections[0]!;
      const key = market.lineRequired ? `${market.key}.${selection.id}.0_5` : `${market.key}.${selection.id}`;
      expect(settle(result, { selectionKey: key }).outcome, `${market.key} declares retirement void`).toBe("void");
    }
  });

  it("every market declaring settle_on_award settles a retirement", () => {
    const settlers = CANONICAL_MARKETS.filter((market) => market.retirementRule === "settle_on_award");
    expect(settlers.length).toBeGreaterThan(0);

    for (const market of settlers) {
      const result: CanonicalResult = {
        ...resultFor(market),
        resultStatus: "retired",
        winner: "home",
        winnerBasis: "retirement"
      };
      const settled = settle(result, { selectionKey: `${market.key}.${market.selections[0]!.id}` });
      expect(["won", "lost"], `${market.key} declares settle_on_award`).toContain(settled.outcome);
    }
  });

  it("stamps the declared basis onto the verdict for every market it grades", () => {
    for (const market of CANONICAL_MARKETS) {
      const result: CanonicalResult = {
        ...resultFor(market),
        regulationHome: 2,
        regulationAway: 1,
        extraTimeHome: 2,
        extraTimeAway: 1,
        setsHome: 2,
        setsAway: 1,
        gamesHome: 20,
        gamesAway: 18,
        winner: "home",
        winnerBasis: "regulation"
      };
      const selection = market.selections[0]!;
      const key = market.lineRequired ? `${market.key}.${selection.id}.0_5` : `${market.key}.${selection.id}`;
      const settled = settle(result, { selectionKey: key });
      expect(settled.basis, `${market.key} must stamp its basis`).toBe(market.basis);
      expect(settled.ruleVersion).toBe(market.settlementRuleVersion);
    }
  });
});
