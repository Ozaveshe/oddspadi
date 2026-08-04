import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { fillTeamLogosFromSiblings } from "@/lib/sports/intelligence/teamCrestFill";

/**
 * The fixture header sat crooked, and only on some cards.
 *
 * `.intelligence-matchline a` is the flex row holding [home team] vs [away
 * team]. It used `align-items: baseline`, which lines the three children up on
 * their first text baseline. A crest is `inline-grid`, so an <img> baselines on
 * its bottom edge while the initials fallback baselines on its own text — two
 * different baselines for the same 30px box.
 *
 * Measured in the browser against the real stylesheet, a card with a logo on
 * one side and initials on the other dropped the second team by 18.83px and
 * stretched the row from 30px to 48.83px. `align-items: center` returns both to
 * 0px and 30px.
 *
 * That is why it looked wrong on exactly the fixtures with a missing crest:
 * tennis, and anything sourced from the-odds-api.
 */
const CSS = "src/app/globals.css";

async function matchlineRule(): Promise<string> {
  const css = await readFile(CSS, "utf8");
  const match = /\.intelligence-matchline a \{([^}]*)\}/.exec(css);
  expect(match, "`.intelligence-matchline a` rule not found in globals.css").not.toBeNull();
  return match![1]!;
}

describe("fixture header stays level when one side has no crest", () => {
  it("centres the matchup row rather than baseline-aligning it", async () => {
    const rule = await matchlineRule();

    expect(rule).toMatch(/align-items:\s*center/);
    expect(rule, "baseline alignment reintroduces the 18.83px drop").not.toMatch(/align-items:\s*baseline/);
  });

  it("keeps the crest a fixed-size box so both variants occupy the same space", async () => {
    const css = await readFile(CSS, "utf8");
    const crest = /\.team-crest \{([^}]*)\}/.exec(css)?.[1] ?? "";

    // An image and an initials span must reserve identical space, or the row
    // reflows depending on whether a provider happened to supply a badge.
    expect(crest).toMatch(/flex-shrink:\s*0/);
    expect(crest).toMatch(/place-items:\s*center/);
  });
});

describe("borrowed crests report honestly", () => {
  it("reports storage absence rather than a clean zero", async () => {
    const result = await fillTeamLogosFromSiblings({ client: null });

    expect(result.status).toBe("unavailable");
    expect(result.filled).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it("surfaces an rpc failure instead of reporting nothing to fill", async () => {
    // A silent failure is indistinguishable from "every club already has a
    // badge", which is the reading that let this sit unnoticed.
    const client = { rpc: async () => ({ data: null, error: { message: "permission denied" } }) } as never;

    const result = await fillTeamLogosFromSiblings({ client });

    expect(result.status).toBe("unavailable");
    expect(result.errors).toEqual(["permission denied"]);
  });

  it("totals the per-sport counts", async () => {
    const client = {
      rpc: async () => ({ data: [{ sport: "football", filled: 253 }, { sport: "basketball", filled: 65 }], error: null })
    } as never;

    const result = await fillTeamLogosFromSiblings({ client });

    expect(result.status).toBe("completed");
    expect(result.filled).toBe(318);
  });
});
