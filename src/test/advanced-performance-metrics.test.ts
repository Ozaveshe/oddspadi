import { describe, expect, it } from "vitest";
import { MIN_SEGMENT_SAMPLE, MIN_CALIBRATION_SAMPLE } from "@/lib/performance/ledgerMetrics";
import {
  MIN_OPERATIONAL_SAMPLE,
  UNVERSIONED_LABEL,
  abstentionRate,
  brierScore,
  brierSkillScore,
  clvDistribution,
  closingLineValue,
  compareModelVersions,
  computeAdvancedPerformance,
  decisionCoverage,
  expectedCalibrationError,
  expectedVersusActualWins,
  hitRate,
  logLoss,
  longestStreaks,
  mean,
  meanConfidenceInterval,
  priceDecayRate,
  proportionDifferenceInterval,
  publicationLeadTime,
  quantile,
  reliabilityCurve,
  returnDistribution,
  returnOnInvestment,
  returnVolatility,
  rollingBrier,
  rollingRoi,
  sampleStandardDeviation,
  sampledMetric,
  settlementLatency,
  type AdvancedPerformanceRecord,
  type DecisionObservation
} from "@/lib/performance/advancedMetrics";

/**
 * Known-answer tests for the advanced performance maths.
 *
 * Every expected value here is hand-computed from the formula documented in
 * `docs/performance-metrics.md`, never captured from a previous run. A
 * snapshot test would happily lock in a wrong number forever; the point of
 * this suite is that someone can check the arithmetic with a calculator.
 */

const NOW = new Date("2026-08-07T12:00:00.000Z");

function record(overrides: Partial<AdvancedPerformanceRecord> = {}): AdvancedPerformanceRecord {
  return {
    publicationId: "pub-1",
    fixtureId: "fixture-1",
    fixtureExternalId: "api-football:1",
    sport: "football",
    competition: "Premier League",
    market: "match_winner",
    selection: "home",
    selectionLabel: "Home win",
    modelProbability: 0.55,
    oddsAtPublication: 2,
    impliedProbability: 0.5,
    publishedAt: "2026-08-03T09:00:00.000Z",
    kickoffAt: "2026-08-03T15:00:00.000Z",
    publicationStatus: "published",
    settlementStatus: "unsettled",
    settledAt: null,
    correctionReason: null,
    revision: 1,
    ...overrides
  };
}

/** `count` settled rows, the first `wins` of them won. */
function settled(count: number, wins: number, overrides: Partial<AdvancedPerformanceRecord> = {}) {
  return Array.from({ length: count }, (_, index) =>
    record({
      publicationId: `pub-${index}`,
      settlementStatus: index < wins ? "won" : "lost",
      settledAt: "2026-08-03T17:00:00.000Z",
      ...overrides
    })
  );
}

describe("small statistics helpers", () => {
  it("returns null, not zero, for the mean of nothing", () => {
    expect(mean([])).toBeNull();
    expect(mean([2, 4])).toBe(3);
  });

  it("interpolates quantiles the way a spreadsheet does", () => {
    // n = 4, q = 0.5 -> index 1.5 -> 2 + 0.5 * (3 - 2) = 2.5
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    // n = 10 ascending by ten: index 0.9 -> 10 + 0.9 * 10 = 19
    const tens = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(quantile(tens, 0.1)).toBeCloseTo(19, 10);
    expect(quantile(tens, 0.5)).toBeCloseTo(55, 10);
    expect(quantile(tens, 0.9)).toBeCloseTo(91, 10);
  });

  it("refuses a standard deviation from a single observation", () => {
    expect(sampleStandardDeviation([1])).toBeNull();
    // Bessel: sum of squared deviations 2, divided by n-1 = 2, sqrt = 1
    expect(sampleStandardDeviation([1, 3])).toBeCloseTo(1.4142135624, 9);
    expect(sampleStandardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.1380899353, 9);
  });

  it("builds a mean interval only once a deviation exists", () => {
    expect(meanConfidenceInterval([1])).toBeNull();
    const interval = meanConfidenceInterval([1, 3]);
    // mean 2, s = 1.41421356, half width = 1.96 * 1.41421356 / sqrt(2) = 1.96
    expect(interval?.low).toBeCloseTo(0.04, 6);
    expect(interval?.high).toBeCloseTo(3.96, 6);
  });
});

describe("the metric envelope never substitutes zero for unknown", () => {
  it("reports not-applicable on an empty set", () => {
    const metric = sampledMetric(() => 1, 0, 30);
    expect(metric.value).toBeNull();
    expect(metric.state).toBe("not-applicable");
    expect(metric.requiredSample).toBe(30);
  });

  it("carries both the actual and the required sample when short", () => {
    const metric = sampledMetric(() => 1, 12, 30);
    expect(metric.value).toBeNull();
    expect(metric.state).toBe("insufficient-sample");
    expect(metric.sampleSize).toBe(12);
    expect(metric.requiredSample).toBe(30);
  });

  it("does not run the arithmetic below threshold", () => {
    let ran = false;
    sampledMetric(
      () => {
        ran = true;
        return 1;
      },
      5,
      30
    );
    expect(ran).toBe(false);
  });

  it("treats a non-finite result as not-applicable rather than a number", () => {
    expect(sampledMetric(() => Number.POSITIVE_INFINITY, 40, 30).value).toBeNull();
    expect(sampledMetric(() => Number.NaN, 40, 30).state).toBe("not-applicable");
  });
});

describe("Brier score", () => {
  it("matches the hand-computed mean squared error", () => {
    // (0.6-1)^2 + (0.6-0)^2 + (0.3-1)^2 + (0.3-0)^2 = 0.16 + 0.36 + 0.49 + 0.09 = 1.10
    const rows = [
      record({ publicationId: "a", modelProbability: 0.6, settlementStatus: "won" }),
      record({ publicationId: "b", modelProbability: 0.6, settlementStatus: "lost" }),
      record({ publicationId: "c", modelProbability: 0.3, settlementStatus: "won" }),
      record({ publicationId: "d", modelProbability: 0.3, settlementStatus: "lost" })
    ];
    expect(brierScore(rows, 1).value).toBeCloseTo(0.275, 12);
  });

  it("scores a perfect forecaster at exactly zero and an unknown one at null", () => {
    const perfect = [
      record({ publicationId: "a", modelProbability: 0.999999, settlementStatus: "won" }),
      record({ publicationId: "b", modelProbability: 0.000001, settlementStatus: "lost" })
    ];
    expect(brierScore(perfect, 1).value).toBeCloseTo(0, 10);
    // The distinction the whole module exists for: a perfect 0 and an unknown
    // must not render as the same number.
    const unknown = brierScore([], 1);
    expect(unknown.value).toBeNull();
    expect(unknown.value).not.toBe(0);
  });

  it("holds the threshold at n-1, n and n+1", () => {
    expect(brierScore(settled(MIN_SEGMENT_SAMPLE - 1, 10)).state).toBe("insufficient-sample");
    expect(brierScore(settled(MIN_SEGMENT_SAMPLE - 1, 10)).sampleSize).toBe(MIN_SEGMENT_SAMPLE - 1);
    expect(brierScore(settled(MIN_SEGMENT_SAMPLE, 10)).state).toBe("measured");
    expect(brierScore(settled(MIN_SEGMENT_SAMPLE + 1, 10)).state).toBe("measured");
  });
});

describe("log loss", () => {
  it("scores a coin flip at ln 2", () => {
    const rows = [
      record({ publicationId: "a", modelProbability: 0.5, settlementStatus: "won" }),
      record({ publicationId: "b", modelProbability: 0.5, settlementStatus: "lost" })
    ];
    expect(logLoss(rows, 1).value).toBeCloseTo(Math.LN2, 12);
  });

  it("scores a confident, correct forecaster at -ln(0.8)", () => {
    const rows = [
      record({ publicationId: "a", modelProbability: 0.8, settlementStatus: "won" }),
      record({ publicationId: "b", modelProbability: 0.2, settlementStatus: "lost" })
    ];
    expect(logLoss(rows, 1).value).toBeCloseTo(0.2231435513, 9);
  });

  it("punishes a confident error far harder than Brier does", () => {
    const rows = [record({ modelProbability: 0.99, settlementStatus: "lost" })];
    expect(brierScore(rows, 1).value).toBeCloseTo(0.9801, 10);
    expect(logLoss(rows, 1).value).toBeCloseTo(4.605170186, 8);
  });
});

describe("Brier skill score", () => {
  it("is zero when the model exactly reproduces the base rate", () => {
    // 40 picks at p = 0.5, 20 wins: base rate is 0.5, so model and reference agree.
    const rows = settled(40, 20, { modelProbability: 0.5 });
    expect(brierSkillScore(rows).value).toBeCloseTo(0, 12);
  });

  it("is null, not zero, when every decided pick went the same way", () => {
    // Base rate 1 -> reference Brier 0 -> the ratio is undefined, not a skill of 0.
    const metric = brierSkillScore(settled(40, 40, { modelProbability: 0.7 }));
    expect(metric.value).toBeNull();
    expect(metric.state).toBe("not-applicable");
  });
});

describe("expected calibration error", () => {
  it("matches a hand-computed two-band example", () => {
    // Band [0, 0.5): 5 rows at p = 0.2, 1 win -> observed 0.2, |diff| 0
    // Band [0.5, 1]: 5 rows at p = 0.8, 3 wins -> observed 0.6, |diff| 0.2
    // ECE = 0.5 * 0 + 0.5 * 0.2 = 0.1
    const low = Array.from({ length: 5 }, (_, index) =>
      record({ publicationId: `l${index}`, modelProbability: 0.2, settlementStatus: index < 1 ? "won" : "lost" })
    );
    const high = Array.from({ length: 5 }, (_, index) =>
      record({ publicationId: `h${index}`, modelProbability: 0.8, settlementStatus: index < 3 ? "won" : "lost" })
    );
    expect(expectedCalibrationError([...low, ...high], { buckets: 2, minSample: 1 }).value).toBeCloseTo(0.1, 12);
  });

  it("withholds below the calibration threshold rather than reporting a small number", () => {
    const metric = expectedCalibrationError(settled(MIN_CALIBRATION_SAMPLE - 1, 20));
    expect(metric.value).toBeNull();
    expect(metric.state).toBe("insufficient-sample");
    expect(metric.requiredSample).toBe(MIN_CALIBRATION_SAMPLE);
    expect(expectedCalibrationError(settled(MIN_CALIBRATION_SAMPLE, 20)).state).toBe("measured");
  });
});

describe("reliability curve", () => {
  /** 40 picks at `probability`, winning at exactly `winRate`. */
  function band(probability: number, winRate: number, tag: string) {
    const wins = Math.round(40 * winRate);
    return Array.from({ length: 40 }, (_, index) =>
      record({
        publicationId: `${tag}-${index}`,
        modelProbability: probability,
        settlementStatus: index < wins ? "won" : "lost"
      })
    );
  }

  it("puts a perfectly calibrated set on the diagonal", () => {
    const rows = [...band(0.25, 0.25, "low"), ...band(0.75, 0.75, "high")];
    const curve = reliabilityCurve(rows);
    expect(curve.state).toBe("measured");
    const populated = curve.buckets.filter((bucket) => bucket.count > 0);
    expect(populated).toHaveLength(2);
    for (const bucket of populated) {
      expect(bucket.reliable).toBe(true);
      expect(bucket.observed).toBeCloseTo(bucket.predicted as number, 12);
    }
    expect(expectedCalibrationError(rows).value).toBeCloseTo(0, 12);
  });

  it("puts a badly calibrated set far off the diagonal", () => {
    // Forecast 95% and win 25%; forecast 5% and win 75%. Both bands are inverted.
    const rows = [...band(0.95, 0.25, "over"), ...band(0.05, 0.75, "under")];
    const curve = reliabilityCurve(rows);
    const populated = curve.buckets.filter((bucket) => bucket.count > 0);
    expect(populated).toHaveLength(2);
    for (const bucket of populated) {
      expect(Math.abs((bucket.observed as number) - (bucket.predicted as number))).toBeCloseTo(0.7, 12);
    }
    // ECE = 0.5 * 0.7 + 0.5 * 0.7
    expect(expectedCalibrationError(rows).value).toBeCloseTo(0.7, 12);
  });

  it("withholds a band below the per-bucket bar while still reporting what we forecast", () => {
    const rows = [...band(0.25, 0.25, "low"), ...band(0.75, 0.75, "high")];
    const thin = [
      ...rows,
      record({ publicationId: "thin-1", modelProbability: 0.45, settlementStatus: "won" }),
      record({ publicationId: "thin-2", modelProbability: 0.45, settlementStatus: "lost" })
    ];
    const curve = reliabilityCurve(thin);
    const bucket = curve.buckets.find((entry) => entry.index === 4);
    expect(bucket?.count).toBe(2);
    expect(bucket?.reliable).toBe(false);
    // The mean of our own forecasts is a fact about our output; the win rate is not.
    expect(bucket?.predicted).toBeCloseTo(0.45, 12);
    expect(bucket?.observed).toBeNull();
    expect(bucket?.observedInterval).toBeNull();
  });

  it("returns no curve at all below the calibration threshold", () => {
    const curve = reliabilityCurve(settled(MIN_CALIBRATION_SAMPLE - 1, 20));
    expect(curve.state).toBe("insufficient-sample");
    expect(curve.buckets).toHaveLength(0);
    expect(curve.series).toHaveLength(0);
  });

  it("shapes series that are legible without colour", () => {
    const curve = reliabilityCurve([...band(0.25, 0.25, "low"), ...band(0.75, 0.75, "high")]);
    const patterns = curve.series.map((series) => series.pattern);
    const markers = curve.series.map((series) => series.marker);
    expect(new Set(patterns).size).toBe(curve.series.length);
    expect(new Set(markers).size).toBe(curve.series.length);
    for (const series of curve.series) {
      expect(series.label.length).toBeGreaterThan(0);
      expect(series.summary.length).toBeGreaterThan(0);
      for (const point of series.points) expect(point.label.length).toBeGreaterThan(0);
    }
  });
});

describe("expected versus actual wins", () => {
  it("matches the hand-computed Poisson-binomial figures", () => {
    // 40 picks at p = 0.5 with 25 wins.
    // expected 20, actual 25, variance 40 * 0.25 = 10, sd = 3.16227766
    // z = 5 / 3.16227766 = 1.58113883
    // interval = 20 +/- 1.96 * 3.16227766 = [13.80193, 26.19807]
    const result = expectedVersusActualWins(settled(40, 25, { modelProbability: 0.5 }));
    expect(result.expectedWins).toBeCloseTo(20, 10);
    expect(result.actualWins).toBe(25);
    expect(result.difference).toBeCloseTo(5, 10);
    expect(result.zScore).toBeCloseTo(1.5811388301, 8);
    expect(result.expectedInterval?.low).toBeCloseTo(13.8019357, 6);
    expect(result.expectedInterval?.high).toBeCloseTo(26.1980643, 6);
    expect(result.outsideExpectation).toBe(false);
  });

  it("flags a gap variance struggles to explain", () => {
    // 40 picks at p = 0.5 with 35 wins: 15 above expectation, z = 4.74
    const result = expectedVersusActualWins(settled(40, 35, { modelProbability: 0.5 }));
    expect(result.zScore).toBeCloseTo(4.7434164903, 8);
    expect(result.outsideExpectation).toBe(true);
  });

  it("withholds everything below threshold", () => {
    const result = expectedVersusActualWins(settled(MIN_SEGMENT_SAMPLE - 1, 10));
    expect(result.expectedWins).toBeNull();
    expect(result.actualWins).toBeNull();
    expect(result.state).toBe("insufficient-sample");
    expect(result.sampleSize).toBe(MIN_SEGMENT_SAMPLE - 1);
  });
});

describe("void and push never enter the record", () => {
  const rows = [
    record({ publicationId: "w", settlementStatus: "won", settledAt: "2026-08-03T17:00:00.000Z" }),
    record({ publicationId: "l", settlementStatus: "lost", settledAt: "2026-08-03T17:00:00.000Z" }),
    ...Array.from({ length: 5 }, (_, index) =>
      record({ publicationId: `p${index}`, settlementStatus: "push", settledAt: "2026-08-03T17:00:00.000Z" })
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      record({ publicationId: `v${index}`, settlementStatus: "void", settledAt: "2026-08-03T17:00:00.000Z" })
    ),
    record({ publicationId: "c", settlementStatus: "cancelled", settledAt: "2026-08-03T17:00:00.000Z" })
  ];

  it("counts only won and lost in the accuracy denominator", () => {
    const metric = hitRate(rows, 2);
    expect(metric.sampleSize).toBe(2);
    expect(metric.value).toBeCloseTo(0.5, 12);
  });

  it("keeps them out of Brier, ROI and volatility too", () => {
    expect(brierScore(rows, 1).sampleSize).toBe(2);
    expect(returnOnInvestment(rows, 1).sampleSize).toBe(2);
    // 13 rows in, 2 decided: a push is not a played selection in either direction.
    expect(returnDistribution(rows, 1).sampleSize).toBe(2);
  });

  it("still reports them separately so the ledger reconciles", () => {
    const report = computeAdvancedPerformance(rows, { now: NOW });
    expect(report.published).toBe(13);
    expect(report.decided).toBe(2);
    expect(report.excludedFromRecord).toEqual({ push: 5, void: 5, cancelled: 1, pendingVerification: 0 });
  });

  it("excludes retracted publications entirely", () => {
    const withRetraction = [...rows, record({ publicationId: "r", settlementStatus: "won", publicationStatus: "retracted" })];
    expect(hitRate(withRetraction, 2).sampleSize).toBe(2);
  });
});

describe("selection economics", () => {
  // 30 picks at odds 3.00, 12 won: profit 12 * 2 - 18 * 1 = 6 units over 30 stakes.
  const rows = settled(30, 12, { oddsAtPublication: 3 });

  it("computes flat-stake ROI by hand", () => {
    expect(returnOnInvestment(rows).value).toBeCloseTo(0.2, 12);
  });

  it("computes volatility with Bessel's correction", () => {
    // returns: twelve at +2, eighteen at -1; mean 0.2
    // SS = 12 * 1.8^2 + 18 * 1.2^2 = 38.88 + 25.92 = 64.8; variance = 64.8 / 29
    expect(returnVolatility(rows).value).toBeCloseTo(Math.sqrt(64.8 / 29), 12);
  });

  it("shapes the return distribution into fixed, comparable bands", () => {
    const distribution = returnDistribution(rows);
    expect(distribution.bands.find((band) => band.id === "lost")?.count).toBe(18);
    // odds 3.00 wins return exactly +2.00u, which is the [2, 5) band
    expect(distribution.bands.find((band) => band.id === "large-win")?.count).toBe(12);
    expect(distribution.bands.find((band) => band.id === "mid-win")?.count).toBe(0);
    expect(distribution.medianReturn.value).toBeCloseTo(-1, 12);
    expect(distribution.minReturn).toBeCloseTo(-1, 12);
    expect(distribution.maxReturn).toBeCloseTo(2, 12);
    // mean / sd
    expect(distribution.returnPerUnitOfRisk.value).toBeCloseTo(0.2 / Math.sqrt(64.8 / 29), 12);
    expect(distribution.bands.reduce((sum, band) => sum + band.count, 0)).toBe(30);
  });

  it("keeps band counts while withholding summary statistics below threshold", () => {
    const thin = returnDistribution(settled(4, 2, { oddsAtPublication: 3 }));
    expect(thin.state).toBe("insufficient-sample");
    expect(thin.meanReturn.value).toBeNull();
    expect(thin.volatility.value).toBeNull();
    // A count of observed events is a fact, not an estimate.
    expect(thin.bands.find((band) => band.id === "lost")?.count).toBe(2);
  });

  it("returns null rather than zero for ROI over nothing", () => {
    const metric = returnOnInvestment([]);
    expect(metric.value).toBeNull();
    expect(metric.state).toBe("not-applicable");
  });
});

describe("streaks", () => {
  function sequence(pattern: Array<"won" | "lost" | "void">) {
    return pattern.map((status, index) =>
      record({
        publicationId: `s${String(index).padStart(2, "0")}`,
        settlementStatus: status,
        publishedAt: new Date(Date.parse("2026-08-01T00:00:00.000Z") + index * 3_600_000).toISOString(),
        kickoffAt: new Date(Date.parse("2026-08-01T12:00:00.000Z") + index * 3_600_000).toISOString(),
        settledAt: new Date(Date.parse("2026-08-01T14:00:00.000Z") + index * 3_600_000).toISOString()
      })
    );
  }

  it("finds the longest run of each kind", () => {
    const streaks = longestStreaks(sequence(["won", "won", "lost", "won", "won", "won", "lost", "lost"]));
    expect(streaks.longestWinning).toBe(3);
    expect(streaks.longestLosing).toBe(2);
    expect(streaks.current).toEqual({ type: "lost", length: 2 });
    expect(streaks.sampleSize).toBe(8);
  });

  it("does not let a void interrupt a run", () => {
    // A void never ran; it can no more break a winning run than a day off can.
    const streaks = longestStreaks(sequence(["won", "won", "void", "won"]));
    expect(streaks.longestWinning).toBe(3);
    expect(streaks.longestLosing).toBeNull();
    expect(streaks.sampleSize).toBe(3);
  });

  it("returns null, not zero, when nothing is decided", () => {
    const streaks = longestStreaks([record({ settlementStatus: "unsettled" })]);
    expect(streaks.longestWinning).toBeNull();
    expect(streaks.longestLosing).toBeNull();
    expect(streaks.current).toBeNull();
  });
});

describe("closing-line value", () => {
  it("computes the ratio by hand", () => {
    // 2.00 published against a 1.80 close: 2 / 1.8 - 1
    expect(closingLineValue(2, 1.8)).toBeCloseTo(0.1111111111, 9);
    expect(closingLineValue(1.8, 2)).toBeCloseTo(-0.1, 12);
    expect(closingLineValue(2, 1)).toBeNull();
    expect(closingLineValue(2, Number.NaN)).toBeNull();
  });

  it("reports coverage beside every figure and withholds the figure when thin", () => {
    // 40 closed markets, 4 with a captured closing price.
    const rows = settled(40, 20).map((row, index) =>
      index < 4 ? { ...row, closingOdds: 1.8, oddsAtPublication: 2 } : row
    );
    const distribution = clvDistribution(rows, { now: NOW });
    expect(distribution.eligible).toBe(40);
    expect(distribution.covered).toBe(4);
    expect(distribution.coverage.value).toBeCloseTo(0.1, 12);
    expect(distribution.meanClv.value).toBeNull();
    expect(distribution.meanClv.state).toBe("insufficient-sample");
    expect(distribution.meanClv.requiredSample).toBe(MIN_SEGMENT_SAMPLE);
    expect(distribution.coverageNote).toContain("4 of 40");
  });

  it("measures CLV once enough closing prices exist", () => {
    const rows = settled(30, 15).map((row) => ({ ...row, oddsAtPublication: 2, closingOdds: 1.8 }));
    const distribution = clvDistribution(rows, { now: NOW });
    expect(distribution.covered).toBe(30);
    expect(distribution.meanClv.value).toBeCloseTo(0.1111111111, 9);
    expect(distribution.medianClv.value).toBeCloseTo(0.1111111111, 9);
    expect(distribution.beatCloseRate.value).toBeCloseTo(1, 12);
    expect(distribution.bands.find((band) => band.id === "better-5")?.count).toBe(30);
    expect(distribution.bands.reduce((sum, band) => sum + band.count, 0)).toBe(30);
  });

  it("is unavailable, not zero, when no closing price was ever captured", () => {
    const distribution = clvDistribution(settled(40, 20), { now: NOW });
    expect(distribution.state).toBe("unavailable");
    expect(distribution.meanClv.value).toBeNull();
    expect(distribution.coverage.value).toBeCloseTo(0, 12);
    expect(distribution.coverageNote).toContain("No closing price");
  });

  it("does not count a market that has not closed as missing coverage", () => {
    const rows = settled(10, 5, { kickoffAt: "2026-09-01T15:00:00.000Z", publishedAt: "2026-08-03T09:00:00.000Z" });
    const distribution = clvDistribution(rows, { now: NOW });
    expect(distribution.eligible).toBe(0);
    expect(distribution.coverage.value).toBeNull();
    expect(distribution.coverageNote).toContain("No market has closed yet");
  });
});

describe("price decay rate", () => {
  it("computes log drift per hour by hand", () => {
    // 2.00 -> 1.80 over a six-hour lead: ln(0.9) / 6 = -0.10536052 / 6
    const rows = settled(30, 15).map((row) => ({ ...row, oddsAtPublication: 2, closingOdds: 1.8 }));
    const decay = priceDecayRate(rows, { now: NOW });
    expect(decay.covered).toBe(30);
    expect(decay.meanDecayPerHour.value).toBeCloseTo(Math.log(0.9) / 6, 12);
    expect(decay.shortenedShare.value).toBeCloseTo(1, 12);
  });

  it("is unavailable when no closing price exists", () => {
    const decay = priceDecayRate(settled(30, 15), { now: NOW });
    expect(decay.state).toBe("unavailable");
    expect(decay.meanDecayPerHour.value).toBeNull();
  });
});

describe("rolling series", () => {
  it("plots a thin window as null rather than as a crash to zero", () => {
    const rows = settled(4, 2, { oddsAtPublication: 3 });
    const series = rollingRoi(rows, { now: NOW });
    expect(series.allWithheld).toBe(true);
    for (const point of series.points) {
      expect(point.value).toBeNull();
      expect(point.state).toBe("insufficient-sample");
      expect(point.requiredSample).toBe(MIN_SEGMENT_SAMPLE);
    }
    expect(series.series.points.every((point) => point.label.includes("needed"))).toBe(true);
  });

  it("measures a window that clears the bar", () => {
    const rows = settled(30, 12, { oddsAtPublication: 3 });
    const series = rollingRoi(rows, { now: NOW });
    const last = series.points[series.points.length - 1];
    expect(last.sampleSize).toBe(30);
    expect(last.value).toBeCloseTo(0.2, 12);
    expect(series.allWithheld).toBe(false);
  });

  it("rolls the Brier score over the same window", () => {
    const rows = settled(30, 15, { modelProbability: 0.5 });
    const series = rollingBrier(rows, { now: NOW });
    const last = series.points[series.points.length - 1];
    expect(last.value).toBeCloseTo(0.25, 12);
  });

  it("drops out of the window once the trailing period passes", () => {
    const rows = settled(30, 12, { oddsAtPublication: 3 });
    const later = rollingRoi(rows, { now: new Date("2026-10-01T12:00:00.000Z"), windowDays: 7, maxPoints: 1 });
    expect(later.points).toHaveLength(1);
    expect(later.points[0].sampleSize).toBe(0);
    expect(later.points[0].value).toBeNull();
    expect(later.points[0].state).toBe("not-applicable");
  });

  it("depends on the injected clock and nothing else", () => {
    const rows = settled(30, 12, { oddsAtPublication: 3 });
    const first = rollingRoi(rows, { now: NOW, maxPoints: 1 });
    const second = rollingRoi(rows, { now: NOW, maxPoints: 1 });
    expect(second.points).toEqual(first.points);
    const shifted = rollingRoi(rows, { now: new Date("2026-08-09T12:00:00.000Z"), maxPoints: 1 });
    expect(shifted.points[0].asOf).not.toBe(first.points[0].asOf);
  });
});

describe("process metrics", () => {
  it("computes coverage, abstention and blocked rates separately", () => {
    const statuses: DecisionObservation["decisionStatus"][] = [
      ...Array.from({ length: 10 }, () => "pick" as const),
      ...Array.from({ length: 5 }, () => "lean" as const),
      ...Array.from({ length: 3 }, () => "watch" as const),
      ...Array.from({ length: 7 }, () => "pass" as const),
      ...Array.from({ length: 3 }, () => "withheld" as const),
      ...Array.from({ length: 2 }, () => "unavailable" as const)
    ];
    const observations: DecisionObservation[] = statuses.map((decisionStatus, index) => ({
      fixtureId: `fixture-${index}`,
      market: "match_winner",
      decisionStatus,
      published: decisionStatus === "pick"
    }));
    const coverage = decisionCoverage(observations);
    expect(coverage.evaluated).toBe(30);
    expect(coverage.published).toBe(10);
    expect(coverage.coverage.value).toBeCloseTo(1 / 3, 12);
    // pass + withheld + unavailable = 12
    expect(coverage.abstentionRate.value).toBeCloseTo(0.4, 12);
    // withheld + unavailable = 5: declined for want of data, not judgement
    expect(coverage.blockedRate.value).toBeCloseTo(1 / 6, 12);
    expect(abstentionRate(observations).value).toBeCloseTo(0.4, 12);
  });

  it("withholds coverage below threshold", () => {
    const observations: DecisionObservation[] = Array.from({ length: MIN_SEGMENT_SAMPLE - 1 }, (_, index) => ({
      fixtureId: `f${index}`,
      market: "match_winner",
      decisionStatus: "pick" as const,
      published: true
    }));
    expect(decisionCoverage(observations).coverage.state).toBe("insufficient-sample");
  });

  it("computes lead-time quantiles by hand", () => {
    // Leads of 10, 20, ... 100 minutes before kickoff.
    const rows = Array.from({ length: 10 }, (_, index) =>
      record({
        publicationId: `t${index}`,
        publishedAt: new Date(Date.parse("2026-08-03T15:00:00.000Z") - (index + 1) * 10 * 60_000).toISOString(),
        kickoffAt: "2026-08-03T15:00:00.000Z"
      })
    );
    const lead = publicationLeadTime(rows);
    expect(lead.sampleSize).toBe(10);
    expect(lead.medianMinutes.value).toBeCloseTo(55, 9);
    expect(lead.p10Minutes.value).toBeCloseTo(19, 9);
    expect(lead.p90Minutes.value).toBeCloseTo(91, 9);
    expect(lead.minMinutes).toBeCloseTo(10, 9);
    expect(lead.maxMinutes).toBeCloseTo(100, 9);
    expect(lead.invalid).toBe(0);
  });

  it("excludes and counts a publication at or after kickoff", () => {
    const rows = [
      record({ publicationId: "after", publishedAt: "2026-08-03T16:00:00.000Z", kickoffAt: "2026-08-03T15:00:00.000Z" })
    ];
    const lead = publicationLeadTime(rows, 1);
    expect(lead.invalid).toBe(1);
    expect(lead.sampleSize).toBe(0);
    expect(lead.medianMinutes.value).toBeNull();
  });

  it("holds the operational threshold at n-1, n and n+1", () => {
    const build = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        record({
          publicationId: `o${index}`,
          publishedAt: "2026-08-03T09:00:00.000Z",
          kickoffAt: "2026-08-03T15:00:00.000Z"
        })
      );
    expect(publicationLeadTime(build(MIN_OPERATIONAL_SAMPLE - 1)).medianMinutes.state).toBe("insufficient-sample");
    expect(publicationLeadTime(build(MIN_OPERATIONAL_SAMPLE)).medianMinutes.state).toBe("measured");
    expect(publicationLeadTime(build(MIN_OPERATIONAL_SAMPLE + 1)).medianMinutes.state).toBe("measured");
  });

  it("counts what is still outstanding past kickoff as a census, not a rate", () => {
    const graded = Array.from({ length: 10 }, (_, index) =>
      record({
        publicationId: `g${index}`,
        settlementStatus: "won",
        kickoffAt: "2026-08-03T15:00:00.000Z",
        settledAt: "2026-08-03T17:00:00.000Z"
      })
    );
    const stuck = Array.from({ length: 12 }, (_, index) =>
      record({ publicationId: `u${index}`, settlementStatus: "unsettled", kickoffAt: "2026-08-03T15:00:00.000Z" })
    );
    const latency = settlementLatency([...graded, ...stuck], { now: NOW });
    expect(latency.settled).toBe(10);
    expect(latency.medianMinutes.value).toBeCloseTo(120, 9);
    expect(latency.outstandingPastKickoff).toBe(12);
    // 2026-08-03T15:00Z to 2026-08-07T12:00Z is 93 hours.
    expect(latency.longestOutstandingMinutes).toBeCloseTo(93 * 60, 6);
  });
});

describe("model-version comparison", () => {
  function arm(version: string, count: number, wins: number, probability: number) {
    return settled(count, wins, { modelProbability: probability }).map((row, index) => ({
      ...row,
      publicationId: `${version}-${index}`,
      modelVersion: version
    }));
  }

  it("splits by version and keeps unversioned rows in the reconciliation", () => {
    const report = compareModelVersions([...arm("v2", 30, 24, 0.7), ...settled(5, 3)]);
    // Ordered by evidence: the arm with the most settled decisions leads.
    const labels = report.versions.map((entry) => entry.modelVersion);
    expect(labels).toEqual(["v2", UNVERSIONED_LABEL]);
    expect(report.versions.reduce((sum, entry) => sum + entry.published, 0)).toBe(35);
  });

  it("computes the Newcombe difference interval by hand", () => {
    // candidate 24/30 (0.8) against baseline 6/30 (0.2): difference 0.6
    // Wilson(24,30) = [0.626941, 0.904951]; Wilson(6,30) = [0.095049, 0.373059]
    // low  = 0.6 - sqrt(0.173059^2 + 0.173059^2) = 0.355256
    // high = 0.6 + sqrt(0.104951^2 + 0.104951^2) = 0.748422
    const interval = proportionDifferenceInterval(24, 30, 6, 30);
    expect(interval?.low).toBeCloseTo(0.3552563, 5);
    expect(interval?.high).toBeCloseTo(0.7484225, 5);
  });

  it("separates two arms only when the interval excludes zero", () => {
    const report = compareModelVersions([...arm("v1", 30, 6, 0.6), ...arm("v2", 30, 24, 0.7)], {
      baselineVersion: "v1",
      candidateVersion: "v2"
    });
    expect(report.comparison.hitRateDifference).toBeCloseTo(0.6, 12);
    expect(report.comparison.separated).toBe(true);
    // v1 forecast 0.6 and won 20%: Brier (6*0.16 + 24*0.36) / 30 = 0.32
    // v2 forecast 0.7 and won 80%: Brier (24*0.09 + 6*0.49) / 30 = 0.17
    expect(report.comparison.brierImprovement).toBeCloseTo(0.15, 12);
    expect(report.comparison.blockedReason).toBeNull();
  });

  it("refuses to compare when either arm is short, and says which", () => {
    const report = compareModelVersions([...arm("v1", 30, 15, 0.5), ...arm("v2", 8, 6, 0.5)], {
      baselineVersion: "v1",
      candidateVersion: "v2"
    });
    expect(report.comparison.hitRateDifference).toBeNull();
    expect(report.comparison.hitRateDifferenceInterval).toBeNull();
    expect(report.comparison.separated).toBe(false);
    expect(report.comparison.blockedReason).toContain("v2 has 8 of the 30");
  });

  it("refuses to compare a single version with itself", () => {
    const report = compareModelVersions(arm("v1", 30, 15, 0.5));
    expect(report.comparison.blockedReason).toContain("fewer than two");
  });
});

describe("the assembled report", () => {
  it("echoes the injected clock and computes everything against it", () => {
    const report = computeAdvancedPerformance(settled(30, 12, { oddsAtPublication: 3 }), { now: NOW });
    expect(report.asOf).toBe(NOW.toISOString());
    expect(report.decided).toBe(30);
    expect(report.selection.roi.value).toBeCloseTo(0.2, 12);
    expect(report.selection.hitRate.value).toBeCloseTo(0.4, 12);
    expect(report.process.coverage).toBeNull();
  });

  it("reproduces exactly on a second call with the same inputs", () => {
    const rows = settled(30, 12, { oddsAtPublication: 3 });
    expect(computeAdvancedPerformance(rows, { now: NOW })).toEqual(computeAdvancedPerformance(rows, { now: NOW }));
  });

  it("returns nulls, not zeros, on an empty ledger", () => {
    const report = computeAdvancedPerformance([], { now: NOW });
    expect(report.published).toBe(0);
    expect(report.forecast.brierScore.value).toBeNull();
    expect(report.forecast.logLoss.value).toBeNull();
    expect(report.selection.hitRate.value).toBeNull();
    expect(report.selection.roi.value).toBeNull();
    expect(report.selection.volatility.value).toBeNull();
    expect(report.price.clv.meanClv.value).toBeNull();
    expect(report.price.decay.meanDecayPerHour.value).toBeNull();
    expect(report.models.comparison.hitRateDifference).toBeNull();
  });

  it("describes today's real ledger shape honestly", () => {
    // The shape op_publications actually holds: one publication day, 106
    // graded of 230, and no closing prices.
    const graded = [
      ...Array.from({ length: 44 }, (_, index) =>
        record({ publicationId: `w${index}`, settlementStatus: "won", settledAt: "2026-08-03T17:00:00.000Z" })
      ),
      ...Array.from({ length: 62 }, (_, index) =>
        record({ publicationId: `l${index}`, settlementStatus: "lost", settledAt: "2026-08-03T17:00:00.000Z" })
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        record({ publicationId: `v${index}`, settlementStatus: "void", settledAt: "2026-08-03T17:00:00.000Z" })
      ),
      ...Array.from({ length: 122 }, (_, index) => record({ publicationId: `u${index}` }))
    ];
    const report = computeAdvancedPerformance(graded, { now: NOW });
    expect(report.published).toBe(230);
    expect(report.decided).toBe(106);
    expect(report.excludedFromRecord.void).toBe(2);
    // 106 clears the accuracy bar: 44 / 106
    expect(report.selection.hitRate.value).toBeCloseTo(44 / 106, 12);
    // and the calibration bar
    expect(report.forecast.expectedCalibrationError.state).toBe("measured");
    // but there is one publication day, so rolling series are a single point
    expect(report.rolling.roi.points.length).toBeLessThanOrEqual(5);
    // and no closing prices exist at all
    expect(report.price.clv.state).toBe("unavailable");
    expect(report.price.decay.state).toBe("unavailable");
  });
});
