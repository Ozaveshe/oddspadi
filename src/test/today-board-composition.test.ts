import { describe, expect, it } from "vitest";
import { boardDisclosure, buildTodayBoard } from "@/lib/discovery/todayBoard";
import type { CuratedBoard, RankedFixture } from "@/lib/discovery/fixtureRanking";

function entry(overrides: Partial<RankedFixture["fixture"]> = {}, score = 50): RankedFixture {
  return {
    score,
    contributions: [],
    reason: "because",
    fixture: {
      fixtureId: `fx-${score}-${overrides.status ?? "scheduled"}`,
      sport: "football",
      competition: "Premier League",
      competitionSlug: "epl",
      country: "England",
      homeTeam: "A",
      awayTeam: "B",
      kickoffAt: "2026-08-07T18:00:00.000Z",
      status: "scheduled",
      competitionTier: "top-five",
      hasModelCoverage: true,
      hasOfficialDecision: false,
      evidenceScore: 0.8,
      lastUpdatedAt: "2026-08-07T17:00:00.000Z",
      settledRecently: false,
      ...overrides
    }
  };
}

function board(items: RankedFixture[], overrides: Partial<CuratedBoard> = {}): CuratedBoard {
  return {
    items,
    // Classification reads the uncapped set; the capped `items` is only what
    // the first screen would have room for.
    ranked: items,
    heldBack: { competition: {}, sport: {}, total: 0 },
    catalogueSize: items.length,
    ...overrides
  };
}

describe("the primary board", () => {
  it("carries only what is happening now or next", () => {
    const result = buildTodayBoard(
      board([entry({ status: "scheduled" }), entry({ status: "live" }, 60), entry({ status: "finished" }, 40)])
    );
    expect(result.primary).toHaveLength(2);
    expect(result.primary.every((item) => item.fixture.status !== "finished")).toBe(true);
  });

  it("keeps finished no-pick evidence out of it entirely", () => {
    // On a normal day these outnumber everything a reader came for.
    const items = Array.from({ length: 50 }, (_, index) => entry({ status: "finished" }, index));
    const result = buildTodayBoard(board([entry({ status: "scheduled" }, 99), ...items]));
    expect(result.primary).toHaveLength(1);
    expect(result.counts.evidenceArchive).toBe(50);
  });

  it("files a finished fixture with a published claim as a result, not as archive", () => {
    // A reader who followed the pick is owed its result on the same screen.
    const result = buildTodayBoard(
      board([entry({ status: "finished", hasOfficialDecision: true }), entry({ status: "finished" }, 10)])
    );
    expect(result.counts.recentResults).toBe(1);
    expect(result.counts.evidenceArchive).toBe(1);
  });

  it("puts every fixture in exactly one section", () => {
    const items = [
      entry({ status: "scheduled" }, 90),
      entry({ status: "live" }, 80),
      entry({ status: "finished", hasOfficialDecision: true }, 70),
      entry({ status: "finished" }, 60),
      entry({ status: "postponed" }, 50)
    ];
    const result = buildTodayBoard(board(items));
    const total = result.counts.primary + result.counts.recentResults + result.counts.evidenceArchive;
    expect(total).toBe(items.length);
  });
});

describe("capping without hiding", () => {
  it("caps the visible board but keeps the true count", () => {
    const items = Array.from({ length: 100 }, (_, index) => entry({ status: "scheduled" }, index));
    const result = buildTodayBoard(board(items), { primaryLimit: 10 });
    expect(result.primary).toHaveLength(10);
    // Overflow is still current, just below the fold — not archived.
    expect(result.counts.primary).toBe(100);
  });

  it("discloses what is not shown", () => {
    const items = Array.from({ length: 100 }, (_, index) => entry({ status: "scheduled" }, index));
    const result = buildTodayBoard(
      board(items, { catalogueSize: 300, heldBack: { competition: {}, sport: {}, total: 25 } }),
      { primaryLimit: 10 }
    );
    const disclosure = boardDisclosure(result)!;
    expect(disclosure).toContain("90 more");
    expect(disclosure).toContain("25 held back");
    expect(disclosure).toContain("View all");
  });

  it("says nothing when nothing is hidden", () => {
    const result = buildTodayBoard(board([entry({ status: "scheduled" })]));
    expect(boardDisclosure(result)).toBeNull();
  });

  it("counts the archive from the uncapped set, not the capped one", () => {
    // The caps protect the first screen. Applying them to the archive count
    // under-reports how much the engine analysed, and a wrong count reads as a
    // fact.
    const archived = Array.from({ length: 40 }, (_, index) => entry({ status: "finished" }, index));
    const result = buildTodayBoard({
      items: archived.slice(0, 3),
      ranked: archived,
      heldBack: { competition: { epl: 37 }, sport: {}, total: 37 },
      catalogueSize: 40
    });
    expect(result.counts.evidenceArchive).toBe(40);
  });

  it("still discloses diversity holdbacks on an uncapped board", () => {
    const result = buildTodayBoard(
      board([entry({ status: "scheduled" })], { heldBack: { competition: { epl: 12 }, sport: {}, total: 12 } })
    );
    expect(boardDisclosure(result)).toContain("12 held back");
  });
});

describe("empty states", () => {
  it("distinguishes nothing today from nothing at all", () => {
    // Only the first is normal, and a reader deserves to know which they hit.
    const quietDay = buildTodayBoard(board([entry({ status: "finished" })], { catalogueSize: 1 }));
    expect(quietDay.primary).toHaveLength(0);
    expect(quietDay.primaryEmptyWithCoverage).toBe(true);

    const nothingAtAll = buildTodayBoard(board([], { catalogueSize: 0 }));
    expect(nothingAtAll.primaryEmptyWithCoverage).toBe(false);
  });

  it("reports zero counts rather than throwing on an empty catalogue", () => {
    const result = buildTodayBoard(board([], { catalogueSize: 0 }));
    expect(result.counts).toMatchObject({ primary: 0, recentResults: 0, evidenceArchive: 0, catalogue: 0 });
    expect(boardDisclosure(result)).toBeNull();
  });
});
