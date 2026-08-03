import { describe, expect, it } from "vitest";
import { edgeOf, selectForPublication, type PublicationCandidate } from "@/lib/publication/selectForPublication";
import type { BandEvidence } from "@/lib/accumulator/calibratedBands";

/** Production's measured tennis bands, 2026-08-03. */
const BANDS: BandEvidence[] = [
  { lowerBound: 0.1, upperBound: 0.2, settledSize: 7, calibrationGap: 0.259 },
  { lowerBound: 0.4, upperBound: 0.5, settledSize: 217, calibrationGap: 0.007 },
  { lowerBound: 0.5, upperBound: 0.6, settledSize: 221, calibrationGap: 0.024 },
  { lowerBound: 0.6, upperBound: 0.7, settledSize: 162, calibrationGap: 0.034 },
  { lowerBound: 0.7, upperBound: 0.8, settledSize: 77, calibrationGap: 0.024 },
  { lowerBound: 0.8, upperBound: 0.9, settledSize: 7, calibrationGap: 0.259 }
];

const NOW = new Date("2026-08-03T12:00:00.000Z");

function candidate(overrides: Partial<PublicationCandidate> = {}): PublicationCandidate {
  return {
    fixtureId: "00000000-0000-0000-0000-000000000001",
    fixtureExternalId: "ext-1",
    sport: "tennis",
    competition: "Montreal ATP",
    kickoffAt: "2026-08-03T18:00:00.000Z",
    market: "match_winner",
    selection: "home",
    selectionLabel: "Home win",
    marketLine: null,
    modelProbability: 0.72,
    impliedProbability: 0.645,
    noVigProbability: 0.62,
    decimalOdds: 1.55,
    oddsSnapshotId: null,
    oddsSnapshotAt: "2026-08-03T11:30:00.000Z",
    evidenceCutoffAt: "2026-08-03T11:30:00.000Z",
    dataQuality: "complete",
    modelVersion: "tennis-surface-elo-v5",
    featureSetVersion: "tennis-runtime-features-v5",
    calibrationVersion: "cal-v1",
    decisionPolicyVersion: "policy-v1",
    bookmakerCount: 5,
    ...overrides
  };
}

const APPROVED = new Set(["tennis"]);

function run(candidates: PublicationCandidate[], approved = APPROVED) {
  return selectForPublication({ candidates, bandsBySport: { tennis: BANDS }, approvedSports: approved, now: NOW });
}

describe("one claim per fixture-market", () => {
  it("never publishes both sides of the same market", () => {
    // The measured problem: 580 rival selections qualified inside the same
    // market on one day, each claiming positive edge. Publishing both puts two
    // contradictory claims in an immutable ledger.
    const result = run([
      candidate({ selection: "home", modelProbability: 0.72, noVigProbability: 0.62 }),
      candidate({ selection: "away", modelProbability: 0.55, noVigProbability: 0.48 })
    ]);
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].selection).toBe("home");
    expect(result.rejected.some((r) => r.reason.includes("larger edge"))).toBe(true);
  });

  it("keeps the larger edge regardless of input order", () => {
    const strong = candidate({ selection: "home", modelProbability: 0.72, noVigProbability: 0.62 });
    const weak = candidate({ selection: "away", modelProbability: 0.55, noVigProbability: 0.53 });
    expect(run([weak, strong]).selected[0].selection).toBe("home");
    expect(run([strong, weak]).selected[0].selection).toBe("home");
  });

  it("still publishes different markets on the same fixture", () => {
    // One claim per market, not one per fixture: these are different bets.
    const result = run([
      candidate({ market: "match_winner", selection: "home" }),
      candidate({ market: "total_games", selection: "over" })
    ]);
    expect(result.selected).toHaveLength(2);
    expect(result.fixtures).toBe(1);
  });

  it("applies no daily cap", () => {
    const many = Array.from({ length: 500 }, (_, index) =>
      candidate({ fixtureId: `f-${index}`, fixtureExternalId: `ext-${index}` })
    );
    expect(run(many).selected).toHaveLength(500);
  });
});

describe("gates that must hold at the point of publication", () => {
  it("refuses a sport with no approved promotion", () => {
    const result = run([candidate({ sport: "football" })], new Set(["tennis"]));
    expect(result.selected).toEqual([]);
    expect(result.rejected[0].reason).toContain("no approved calibration promotion");
  });

  it("refuses after kickoff", () => {
    const result = run([candidate({ kickoffAt: "2026-08-03T11:00:00.000Z" })]);
    expect(result.selected).toEqual([]);
    expect(result.rejected[0].reason).toBe("kickoff has passed");
  });

  it("refuses an unmeasured probability band", () => {
    // 0.86 sits in p80-90: seven settled outcomes behind it.
    const result = run([candidate({ modelProbability: 0.86, noVigProbability: 0.75, decimalOdds: 1.2 })]);
    expect(result.selected).toEqual([]);
    expect(result.rejected[0].reason).toContain("7 settled outcomes");
  });

  it("refuses when edge does not clear the band's premium", () => {
    // p60-70 carries a 3.4% gap, so a 1% edge is inside the noise.
    const result = run([candidate({ modelProbability: 0.65, noVigProbability: 0.64 })]);
    expect(result.selected).toEqual([]);
    expect(result.rejected[0].reason).toContain("does not clear");
  });

  it("refuses without a margin-free price", () => {
    const result = run([candidate({ noVigProbability: null })]);
    expect(result.selected).toEqual([]);
    expect(result.rejected[0].reason).toContain("margin-free");
  });

  it("measures edge against the fair price, not the quoted one", () => {
    // Quoted 1.55 implies 0.645; fair is 0.62. Edge is 0.72-0.62, not 0.72-0.645.
    const value = edgeOf(candidate());
    expect(value).toBeCloseTo(0.1, 5);
  });
});

describe("the report explains every exclusion", () => {
  it("records a reason for each rejected candidate", () => {
    const result = run([
      candidate({ sport: "football" }),
      candidate({ fixtureId: "f2", fixtureExternalId: "e2", kickoffAt: "2026-08-03T11:00:00.000Z" }),
      candidate({ fixtureId: "f3", fixtureExternalId: "e3", noVigProbability: null })
    ]);
    expect(result.selected).toEqual([]);
    expect(result.rejected).toHaveLength(3);
    for (const entry of result.rejected) expect(entry.reason.length).toBeGreaterThan(0);
  });

  it("counts distinct fixtures rather than rows", () => {
    const result = run([
      candidate({ market: "match_winner" }),
      candidate({ market: "total_games", selection: "over" }),
      candidate({ fixtureId: "f2", fixtureExternalId: "e2" })
    ]);
    expect(result.selected).toHaveLength(3);
    expect(result.fixtures).toBe(2);
  });
});
