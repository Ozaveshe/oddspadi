import { describe, expect, it } from "vitest";
import { bandsFromBuckets, buildDailyDoubleView, candidatesFromSlate } from "@/lib/accumulator/dailyDoubleReads";
import type { ProbabilityCalibrationBucket } from "@/lib/sports/prediction/decisionCalibration";
import type { SlateFixture } from "@/lib/sports/intelligence/types";

/**
 * Three empty states that must not collapse into one.
 *
 * "The slate could not be read", "there is no calibration profile" and "nothing
 * qualified today" are an outage, a capability gap and a genuine finding. The
 * product spent a long time removing the habit of rendering all three as
 * nothing, and a new page is exactly where it creeps back in.
 */
function bucket(lower: number, settled: number, gap: number): ProbabilityCalibrationBucket {
  return {
    id: `p${lower * 100}`,
    lowerBound: lower,
    upperBound: lower + 0.1,
    sampleSize: settled,
    settledSize: settled,
    winRate: 0.5,
    brierScore: 0.2,
    logLoss: 0.6,
    averageProbability: lower + 0.05,
    calibrationGap: gap,
    winRateInterval: { lower: 0.4, upper: 0.6 },
    roiUnits: 0
  };
}

const GOOD_BUCKETS = [bucket(0.4, 217, 0.007), bucket(0.5, 221, 0.024), bucket(0.6, 162, 0.034), bucket(0.7, 77, 0.024)];

function slateRow(id: string, probability: number, odds: number, noVig: number, status = "scheduled"): SlateFixture {
  return {
    fixture: {
      fixtureId: id,
      providerFixtureId: id,
      sport: "tennis",
      league: `league-${id}`,
      leagueId: id,
      country: "Nigeria",
      season: "2026",
      kickoffAt: "2026-08-03T18:00:00.000Z",
      homeTeam: { id: `${id}-h`, name: `Home ${id}` },
      awayTeam: { id: `${id}-a`, name: `Away ${id}` },
      status,
      score: null,
      provider: "api-tennis",
      lastSyncedAt: "2026-08-03T12:00:00.000Z",
      dataQuality: 0.9
    },
    odds: [],
    decisions: [],
    decisionSummary: {
      allMarketAnalyses: [
        {
          marketId: "match_winner",
          selectionId: "home",
          label: "Home win",
          modelProbability: probability,
          noVigImpliedProbability: noVig,
          odds
        }
      ]
    },
    publicStatus: "watchlist",
    bestDecision: null
  } as unknown as SlateFixture;
}

describe("the daily double view keeps its empty states apart", () => {
  it("says the slate could not be read, not that there is nothing", () => {
    const view = buildDailyDoubleView({ rows: null, buckets: GOOD_BUCKETS });
    expect(view.state).toBe("unavailable");
    if (view.state !== "unavailable") return;
    expect(view.note).toContain("not the same as there being nothing");
  });

  it("says the capability is missing when no profile exists", () => {
    const view = buildDailyDoubleView({ rows: [], buckets: null });
    expect(view.state).toBe("no-bands");
    if (view.state !== "no-bands") return;
    expect(view.note).toContain("no measured accuracy");
  });

  it("reports a genuine nothing-qualified as a built result, not an error", () => {
    const view = buildDailyDoubleView({ rows: [], buckets: GOOD_BUCKETS });
    expect(view.state).toBe("ready");
    if (view.state !== "ready") return;
    expect(view.slip.status).toBe("insufficient-candidates");
  });

  it("builds a slip when the slate supports one", () => {
    const rows = [slateRow("a", 0.72, 1.5, 0.64), slateRow("b", 0.68, 1.55, 0.6)];
    const view = buildDailyDoubleView({ rows, buckets: GOOD_BUCKETS });
    expect(view.state).toBe("ready");
    if (view.state !== "ready") return;
    expect(view.slip.status).toBe("built");
    expect(view.slip.legs).toHaveLength(2);
    expect(view.slip.combinedOdds).toBeGreaterThanOrEqual(1.8);
  });
});

describe("candidate extraction", () => {
  it("ignores fixtures that have already started", () => {
    expect(candidatesFromSlate([slateRow("live", 0.7, 1.5, 0.62, "live")])).toEqual([]);
  });

  it("keeps a scheduled fixture with a margin-free price", () => {
    expect(candidatesFromSlate([slateRow("a", 0.7, 1.5, 0.62)])).toHaveLength(1);
  });

  it("maps calibration buckets straight onto bands", () => {
    const bands = bandsFromBuckets(GOOD_BUCKETS);
    expect(bands).toHaveLength(4);
    expect(bands[0]).toMatchObject({ lowerBound: 0.4, settledSize: 217, calibrationGap: 0.007 });
  });
});
