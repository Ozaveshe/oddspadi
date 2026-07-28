import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * The live board and ticker poll every 45–60 seconds and re-render their whole
 * subtree each time. Marking those containers `aria-live` therefore re-read the
 * entire board — and the ticking "Updated HH:MM:SS" clock — aloud on every poll,
 * which makes the page unusable with a screen reader rather than accessible.
 *
 * Announcements belong in one small, targeted region that fires only on an
 * actual scoreline change. These tests pin that arrangement down.
 */
describe("live surfaces", () => {
  it("does not mark the bulk match list or ticker as live regions", async () => {
    const [board, ticker] = await Promise.all([
      readFile("src/components/live/LiveScoreBoard.tsx", "utf8"),
      readFile("src/components/live/LiveTicker.tsx", "utf8")
    ]);

    expect(board).not.toMatch(/className="match-list"[^>]*aria-live/);
    expect(ticker).not.toMatch(/className="ticker"[^>]*aria-live/);
    // The ticker still needs an exposed name, which requires a role.
    expect(ticker).toMatch(/className="ticker" role="group" aria-label=/);
  });

  it("does not announce the auto-refresh clock", async () => {
    const board = await readFile("src/components/live/LiveScoreBoard.tsx", "utf8");
    const clockLine = board
      .split("\n")
      .find((line) => line.includes("suppressHydrationWarning") && line.includes("<span"));

    expect(clockLine).toBeDefined();
    expect(clockLine).not.toContain("aria-live");
  });

  it("routes score updates through a single dedicated announcer", async () => {
    const [board, announcer] = await Promise.all([
      readFile("src/components/live/LiveScoreBoard.tsx", "utf8"),
      readFile("src/components/live/ScoreAnnouncer.tsx", "utf8")
    ]);

    expect(board).toContain("<ScoreAnnouncer fixtures={filtered} />");
    expect(announcer).toContain('className="sr-only"');
    expect(announcer).toContain('aria-live="polite"');
  });
});

describe("labelled control clusters", () => {
  it("gives every aria-labelled container a role to attach the label to", async () => {
    const files = [
      "src/components/share/ShareBar.tsx",
      "src/components/live/LiveTicker.tsx",
      "src/components/live/LiveScoreBoard.tsx"
    ];

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const [index, line] of source.split("\n").entries()) {
        // A <div> carrying aria-label but no role has nothing to name.
        if (!/<div[^>]*aria-label=/.test(line)) continue;
        if (!/role=/.test(line)) offenders.push(`${file}:${index + 1}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
