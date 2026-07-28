import { describe, expect, it } from "vitest";
import { toSlateWirePayload } from "@/lib/sports/intelligence/slateWire";
import type { SlateFixture, SportsSlate } from "@/lib/sports/intelligence/types";

function slateFixture(fixtureId: string): SlateFixture {
  return {
    fixture: { fixtureId, kickoffAt: "2026-07-28T15:00:00.000Z" },
    odds: [],
    // Deliberately chunky: this is the part list UIs never read.
    decisions: [{ decisionId: `${fixtureId}-d1`, market: "1x2", selection: "home" }],
    decisionSummary: {
      allMarketAnalyses: [{ market: "1x2", verdict: "no_clear_value" }],
      auditSummary: { thresholds: {} }
    },
    publicStatus: "value_pick",
    bestDecision: null
  } as unknown as SlateFixture;
}

function slate(fixtures: SlateFixture[]): SportsSlate {
  const grouped = [{ date: "2026-07-28", fixtures }];
  return {
    scope: "daily",
    generatedAt: "2026-07-28T12:00:00.000Z",
    range: { from: "2026-07-28", to: "2026-07-28" },
    provider: { status: "ok", providers: [], lastRun: null, errors: [] },
    summary: {},
    fixtures,
    groupedByDate: grouped,
    // Every bucket points at the same objects — this is what quadrupled the
    // serialized response.
    groups: { valuePicks: fixtures, leans: [], watchlist: [], allAnalysed: fixtures, noPicks: [] }
  } as unknown as SportsSlate;
}

describe("slate wire payload", () => {
  it("serialises each fixture exactly once", () => {
    const fixtures = [slateFixture("f1"), slateFixture("f2")];
    const wire = toSlateWirePayload(slate(fixtures));
    const encoded = JSON.stringify(wire);

    // The full object appears only under `fixtures`; grouped views carry ids.
    expect(encoded.split('"decisionId"').length - 1).toBe(fixtures.length);
    expect(wire.groups.valuePicks).toEqual(["f1", "f2"]);
    expect(wire.groups.allAnalysed).toEqual(["f1", "f2"]);
    expect(wire.groupedByDate).toEqual([{ date: "2026-07-28", fixtureIds: ["f1", "f2"] }]);
    expect(wire.fixtures).toHaveLength(2);
  });

  it("is dramatically smaller than serialising the slate directly", () => {
    const fixtures = Array.from({ length: 40 }, (_, index) => slateFixture(`f${index}`));
    const source = slate(fixtures);
    const before = JSON.stringify(source).length;
    const after = JSON.stringify(toSlateWirePayload(source)).length;
    expect(after).toBeLessThan(before / 2);
  });

  it("drops the per-market dossier under view=summary but keeps the fixtures", () => {
    const fixtures = [slateFixture("f1")];
    const wire = toSlateWirePayload(slate(fixtures), { summaryOnly: true });

    expect(wire.fixtures).toHaveLength(1);
    expect(wire.fixtures[0].decisions).toEqual([]);
    expect(wire.fixtures[0].decisionSummary.allMarketAnalyses).toEqual([]);
    // Grouping and identity must survive the trim.
    expect(wire.groups.valuePicks).toEqual(["f1"]);
    expect(wire.fixtures[0].fixture.fixtureId).toBe("f1");
  });

  it("leaves the in-process slate untouched", () => {
    const fixtures = [slateFixture("f1")];
    const source = slate(fixtures);
    toSlateWirePayload(source, { summaryOnly: true });
    // Pages read the same object graph; trimming the wire must not mutate it.
    expect(source.fixtures[0].decisions).toHaveLength(1);
  });
});
