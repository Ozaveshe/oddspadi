import { describe, expect, it } from "vitest";
import { buildMultiSportCorpusPlan, type TrainingCorpusSport } from "@/lib/sports/training/multiSportCorpusPlan";
import { buildMultiSportModelGovernance } from "@/lib/sports/training/multiSportModelGovernance";
import type { StoredBacktestRun, TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

const ZERO_COUNTS: TrainingDataSnapshot["counts"] = {
  fixtures: 0,
  finishedFixtures: 0,
  realFinishedFixtures: 0,
  demoFinishedFixtures: 0,
  oddsSnapshots: 0,
  realOddsSnapshots: 0,
  demoOddsSnapshots: 0,
  eventSnapshots: 0,
  realEventSnapshots: 0,
  demoEventSnapshots: 0,
  newsSnapshots: 0,
  realNewsSnapshots: 0,
  demoNewsSnapshots: 0,
  standingsSnapshots: 0,
  realStandingsSnapshots: 0,
  demoStandingsSnapshots: 0,
  availabilitySnapshots: 0,
  realAvailabilitySnapshots: 0,
  demoAvailabilitySnapshots: 0,
  lineupSnapshots: 0,
  realLineupSnapshots: 0,
  demoLineupSnapshots: 0,
  weatherSnapshots: 0,
  realWeatherSnapshots: 0,
  demoWeatherSnapshots: 0,
  featureSnapshots: 0,
  backtestRuns: 0
};

function backtest(sport: TrainingCorpusSport, overrides: Partial<StoredBacktestRun> = {}): StoredBacktestRun {
  return {
    id: `bt-${sport}`,
    sport,
    modelKey: `${sport}-model`,
    engineVersion: "test",
    status: "completed",
    dataSource: "supabase:real-only",
    sampleSize: 500,
    trainSize: 350,
    testSize: 150,
    pickCount: 24,
    brierScore: 0.18,
    logLoss: 0.56,
    roiUnits: 3.4,
    yield: 0.14,
    averageEdge: 0.04,
    closingLineValue: 0.02,
    calibrationError: 0.08,
    calibrationBuckets: [],
    learnedWeights: {},
    notes: [],
    createdAt: "2026-07-10T10:00:00.000Z",
    ...overrides
  };
}

function snapshot(
  sport: TrainingCorpusSport,
  counts: Partial<TrainingDataSnapshot["counts"]> = {},
  latestBacktest: StoredBacktestRun | null = null
): TrainingDataSnapshot {
  const mergedCounts = { ...ZERO_COUNTS, ...counts };
  return {
    generatedAt: "2026-07-10T10:00:00.000Z",
    status: "ready",
    configured: true,
    sport,
    counts: mergedCounts,
    latestBacktest,
    readiness: {
      hasHistoricalFixtures: mergedCounts.realFinishedFixtures > 0,
      hasOdds: mergedCounts.realOddsSnapshots > 0,
      hasBacktests: Boolean(latestBacktest),
      readyForTraining: mergedCounts.realFinishedFixtures > 0 && mergedCounts.realOddsSnapshots > 0 && Boolean(latestBacktest),
      minimumRecommendedFixtures: 1000,
      detail: "Test snapshot."
    },
    storage: {
      status: "ready",
      configured: true,
      detail: "Storage ready.",
      missingEnv: [],
      expectedTables: []
    }
  };
}

describe("multi-sport model governance", () => {
  it("treats missing live provider env as a warning when stored corpus and backtest evidence are already present", () => {
    const corpusPlan = buildMultiSportCorpusPlan({
      generatedAt: "2026-07-10T10:00:00.000Z",
      baseUrl: "http://127.0.0.1:3025",
      env: {
        SUPABASE_PROJECT_REF: "wncwtzqipnoqwmqlznqn",
        SUPABASE_URL: "https://wncwtzqipnoqwmqlznqn.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        ODDSPADI_ADMIN_TOKEN: "admin-token",
        API_FOOTBALL_KEY: "football-key",
        THE_ODDS_API_KEY: "odds-key"
      }
    });

    const governance = buildMultiSportModelGovernance({
      corpusPlan,
      trainingSnapshots: [
        snapshot("football"),
        snapshot(
          "basketball",
          {
            fixtures: 12479,
            finishedFixtures: 12479,
            realFinishedFixtures: 12479,
            oddsSnapshots: 2176,
            realOddsSnapshots: 2176,
            featureSnapshots: 12479,
            backtestRuns: 2
          },
          backtest("basketball", { sampleSize: 5000, calibrationError: 0.08 })
        ),
        snapshot("tennis")
      ],
      now: new Date("2026-07-10T10:01:00.000Z")
    });

    const basketball = governance.sports.find((sport) => sport.sport === "basketball");
    const providerEnvGate = basketball?.gates.find((gate) => gate.id === "provider-env");

    expect(governance.status).toBe("shadow-review-ready");
    expect(basketball?.status).toBe("shadow-eligible");
    expect(basketball?.missingEnv).toEqual(expect.arrayContaining(["API_BASKETBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]));
    expect(providerEnvGate?.status).toBe("watch");
    expect(providerEnvGate?.evidence).toContain("Stored corpus and backtest evidence are present");
    expect(governance.controls.canApplyLearnedWeights).toBe(false);
    expect(governance.controls.canPublishPicks).toBe(false);
    expect(governance.controls.canStake).toBe(false);
  });
});
