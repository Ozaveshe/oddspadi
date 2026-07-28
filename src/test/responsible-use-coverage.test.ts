import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every surface that shows a prediction, a past result or a member tip carries
 * responsible-use framing. The terms page commits to it ("analysis only, no
 * guarantees, 18+"), and the daily tips surfaces got it via
 * `DailyTipsPageView` — but the results ledger, the season outlooks and the
 * community feed rendered none at all.
 */
const SURFACES_REQUIRING_NOTICE = [
  "src/app/page.tsx",
  "src/app/predictions/page.tsx",
  "src/app/predictions/today/page.tsx",
  "src/app/predictions/tomorrow/page.tsx",
  "src/app/predictions/week/page.tsx",
  "src/app/predictions/value-picks/page.tsx",
  "src/app/predictions/history/page.tsx",
  "src/app/predictions/bet-slip/page.tsx",
  "src/app/predictions/decision-engine/page.tsx",
  "src/app/predictions/[matchId]/page.tsx",
  "src/app/season-outlooks/page.tsx",
  "src/app/community/page.tsx"
];

const NOTICE_COMPONENTS = /ResponsibleUseNotice|PredictionDisclaimer|DailyTipsPageView/;

describe("responsible-use framing", () => {
  it("appears on every prediction, results and member-tip surface", async () => {
    const offenders: string[] = [];
    for (const page of SURFACES_REQUIRING_NOTICE) {
      const source = await readFile(page, "utf8");
      if (!NOTICE_COMPONENTS.test(source)) offenders.push(page);
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the notice copy free of outcome promises", async () => {
    const source = await readFile("src/components/odds/PredictionDisclaimer.tsx", "utf8");
    const lowered = source.toLowerCase();

    for (const phrase of ["sure odds", "guaranteed", "sure bet", "banker", "can't lose", "cannot lose"]) {
      expect(lowered).not.toContain(phrase);
    }
    // The framing the terms page commits to.
    expect(lowered).toContain("18+");
    expect(lowered).toContain("risk");
  });

  it("has not left a new prediction route without a notice", async () => {
    // Catches a route added later that shows picks but never gets added to the
    // list above.
    const offenders: string[] = [];

    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "_archived") await walk(path);
          continue;
        }
        if (entry.name !== "page.tsx") continue;
        const source = await readFile(path, "utf8");
        // A page that renders a value pick, a lean or a published pick.
        const showsPicks = /valuePicks|bestPublishedPick|publicStatus|SlateFixtureCard/.test(source);
        if (showsPicks && !NOTICE_COMPONENTS.test(source)) offenders.push(path);
      }
    }

    await walk("src/app");
    expect(offenders).toEqual([]);
  });
});
