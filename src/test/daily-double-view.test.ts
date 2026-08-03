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
    const view = buildDailyDoubleView({ rows: null, bandsBySport: { tennis: bandsFromBuckets(GOOD_BUCKETS) } });
    expect(view.state).toBe("unavailable");
    if (view.state !== "unavailable") return;
    expect(view.note).toContain("not the same as there being nothing");
  });

  it("says the capability is missing when no profile exists", () => {
    const view = buildDailyDoubleView({ rows: [], bandsBySport: null });
    expect(view.state).toBe("no-bands");
    if (view.state !== "no-bands") return;
    expect(view.note).toContain("no measured accuracy");
  });

  it("reports a genuine nothing-qualified as a built result, not an error", () => {
    const view = buildDailyDoubleView({ rows: [], bandsBySport: { tennis: bandsFromBuckets(GOOD_BUCKETS) } });
    expect(view.state).toBe("ready");
    if (view.state !== "ready") return;
    expect(view.slip.status).toBe("insufficient-candidates");
  });

  it("builds a slip when the slate supports one", () => {
    const rows = [slateRow("a", 0.72, 1.5, 0.64), slateRow("b", 0.68, 1.55, 0.6)];
    const view = buildDailyDoubleView({ rows, bandsBySport: { tennis: bandsFromBuckets(GOOD_BUCKETS) } });
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

describe("bands are matched to the candidate's own sport", () => {
  it("excludes a sport with no profile rather than borrowing another's", () => {
    // The bug this catches: reading football's profile and applying it to a
    // slate that is mostly tennis. Two models, two error profiles, one set of
    // bands — and the tennis selections were being scored against the wrong one.
    const rows = [slateRow("t1", 0.72, 1.5, 0.64), slateRow("t2", 0.68, 1.55, 0.6)];
    const footballOnly = buildDailyDoubleView({ rows, bandsBySport: { football: bandsFromBuckets(GOOD_BUCKETS) } });
    expect(footballOnly.state).toBe("ready");
    if (footballOnly.state !== "ready") return;
    // These rows are tennis; football bands must not qualify them.
    expect(footballOnly.slip.status).toBe("insufficient-candidates");

    const tennisBands = buildDailyDoubleView({ rows, bandsBySport: { tennis: bandsFromBuckets(GOOD_BUCKETS) } });
    expect(tennisBands.state).toBe("ready");
    if (tennisBands.state !== "ready") return;
    expect(tennisBands.slip.status).toBe("built");
  });
});

describe("profile provenance travels with the bands", () => {
  it("marks a shadow-review profile as not approved", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/lib/accumulator/dailyDoubleReads.ts", "utf8");
    // Read from the profile rather than hardcoded: if a profile is ever
    // promoted, the page must start saying so without another edit.
    expect(source).toContain("approvedForLiveInfluence: profile.promotionReadiness.canInfluenceLive");
    expect(source).toContain("readiness: profile.promotionReadiness.status");
  });
});

describe("the daily double page discloses and is observable", () => {
  it("says the profile is unapproved and keeps the slip out of the record", async () => {
    const { readFile } = await import("node:fs/promises");
    const page = await readFile("src/app/daily-double/page.tsx", "utf8");
    // Presenting a probability from an unpromoted profile without saying so is
    // a claim with invisible provenance — the defect the ledger exists to stop.
    expect(page).toContain("has not been approved for live influence");
    expect(page).toContain("Not an official pick");
    expect(page).toContain("/track-record");
  });

  it("stamps surface claims so the consistency suite can see it", async () => {
    const { readFile } = await import("node:fs/promises");
    const page = await readFile("src/app/daily-double/page.tsx", "utf8");
    // A surface that renders a fixture without a claim is invisible to the
    // cross-surface check and free to drift away from every other page.
    expect(page).toContain("SurfaceClaimMarker");
    expect(page).toContain('surface: "daily-double"');
  });
});
