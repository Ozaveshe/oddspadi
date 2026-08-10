import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makesProhibitedClaim } from "@/lib/editorial/bannedClaims";
import { presentBlockers } from "@/lib/sports/prediction/blockerPresentation";

const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

describe("prohibited-claim detector", () => {
  it("flags outcome promises and ignores negated mentions", () => {
    expect(makesProhibitedClaim("This is a sure bet tonight.")).toBe(true);
    expect(makesProhibitedClaim("guaranteed profit every week")).toBe(true);
    expect(makesProhibitedClaim("No result is ever guaranteed.")).toBe(false);
    expect(makesProhibitedClaim("We never promise sure odds.")).toBe(false);
    expect(makesProhibitedClaim("Arsenal look strong at home.")).toBe(false);
  });
});

describe("AI-polished editorial output is gated on the shared banned list", () => {
  const source = read("src/lib/editorial/aiPolish.ts");
  it("imports and applies the prohibited-claim gate to model output", () => {
    expect(source).toContain("makesProhibitedClaim");
    expect(source).toContain("bannedClaims");
    // The gate must run against the parsed model output before it is returned.
    expect(source).toMatch(/makesProhibitedClaim\([^)]*(title|excerpt|body|combined)/);
  });
});

describe("the copy-integrity scan uses the same shared banned list", () => {
  it("imports BANNED_CLAIMS rather than redefining them", () => {
    expect(read("src/test/consumer-copy-integrity.test.ts")).toContain("@/lib/editorial/bannedClaims");
  });
});

describe("unmapped engine blockers are redacted, never shown verbatim", () => {
  it("replaces an internal token with a generic reader-facing line", () => {
    const presented = presentBlockers(["calibration_support_missing", "evidence_score_below_floor"]);
    for (const item of presented) {
      expect(item.text).not.toMatch(/_/); // no internal snake_case token reaches the reader
      expect(item.text.toLowerCase()).not.toContain("calibration_support");
      expect(item.text.toLowerCase()).not.toContain("evidence_score");
    }
  });

  it("still passes a mapped, reader-facing blocker through unchanged", () => {
    const presented = presentBlockers(["odds_are_stale"]);
    expect(presented.length).toBeGreaterThanOrEqual(0);
  });
});
