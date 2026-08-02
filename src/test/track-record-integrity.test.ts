import { describe, expect, it } from "vitest";
import type { OfficialPublicationSummary } from "@/lib/domain/canonicalReads";
import { summarisePublications } from "@/lib/domain/canonicalReads";
import {
  MIN_SEGMENT_SAMPLE,
  computeForecastMetrics,
  computeLedgerPerformance,
  computeSelectionMetrics,
  computeSegments,
  formatMetric,
  wilsonInterval
} from "@/lib/performance/ledgerMetrics";
import { validateArticle, type ValidationContext } from "@/lib/editorial/articleValidation";
import { classifyIndexability, uniqueWordCount } from "@/lib/editorial/indexability";
import { isOfficialLedgerClass } from "@/lib/domain/states";

/**
 * One verifiable track record.
 *
 * These tests encode the promise: every published number is reproducible from
 * the ledger, nothing else may enter it, and an article that cannot prove its
 * claims does not get published.
 */
function publication(overrides: Partial<OfficialPublicationSummary> = {}): OfficialPublicationSummary {
  return {
    publicationId: overrides.publicationId ?? "pub-1",
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
    publishedAt: "2026-08-01T12:00:00.000Z",
    kickoffAt: "2026-08-01T15:00:00.000Z",
    publicationStatus: "published",
    settlementStatus: "unsettled",
    settledAt: null,
    correctionReason: null,
    revision: 1,
    ...overrides
  };
}

function settledSet(wins: number, losses: number, odds = 2): OfficialPublicationSummary[] {
  return [
    ...Array.from({ length: wins }, (_, index) =>
      publication({ publicationId: `w${index}`, settlementStatus: "won", oddsAtPublication: odds, settledAt: "2026-08-01T17:00:00.000Z" })
    ),
    ...Array.from({ length: losses }, (_, index) =>
      publication({ publicationId: `l${index}`, settlementStatus: "lost", oddsAtPublication: odds, settledAt: "2026-08-01T17:00:00.000Z" })
    )
  ];
}

describe("counts agree with the ledger", () => {
  it("reports the same settled count as the canonical summary", () => {
    const rows = settledSet(6, 4);
    const summary = summarisePublications(rows, "complete");
    const selection = computeSelectionMetrics(rows);
    expect(selection.won).toBe(summary.won);
    expect(selection.lost).toBe(summary.lost);
    expect(selection.settled).toBe(summary.settled);
    expect(selection.sampleSize).toBe(summary.won + summary.lost);
  });

  it("excludes retracted publications from every number", () => {
    const rows = [...settledSet(2, 1), publication({ publicationId: "r", settlementStatus: "won", publicationStatus: "retracted" })];
    const selection = computeSelectionMetrics(rows);
    expect(selection.won).toBe(2);
    expect(selection.published).toBe(3);
  });
});

describe("a failed read is never a zero result", () => {
  it("returns unavailable metrics, not zeroes, when the ledger cannot be read", () => {
    const performance = computeLedgerPerformance([], "unavailable");
    expect(performance.selection.hitRate.state).toBe("unavailable");
    expect(performance.selection.hitRate.value).toBeNull();
    expect(performance.selection.yieldPerUnit.value).toBeNull();
    expect(performance.forecast.brierScore.state).toBe("unavailable");
    expect(formatMetric(performance.selection.hitRate, "percent")).toBe("Not available");
  });

  it("distinguishes a genuinely empty ledger from an unreadable one", () => {
    const empty = computeLedgerPerformance([], "confirmed_empty");
    expect(empty.selection.hitRate.state).toBe("not-applicable");
    expect(formatMetric(empty.selection.hitRate, "percent")).toBe("Not applicable");
  });
});

describe("small samples do not become confident claims", () => {
  it("warns when the settled sample is small", () => {
    const performance = computeLedgerPerformance(settledSet(3, 1), "complete");
    expect(performance.smallSampleWarning).toContain("4 settled pick");
    expect(performance.smallSampleWarning).toContain("variance");
  });

  it("refuses a rate for a segment below the threshold", () => {
    const segments = computeSegments(settledSet(3, 1), ["sport"]);
    const football = segments.find((segment) => segment.label === "football")!;
    expect(football.belowThreshold).toBe(true);
    expect(football.selection.hitRate.state).toBe("insufficient-sample");
    expect(formatMetric(football.selection.hitRate, "percent")).toBe("Insufficient sample (4)");
  });

  it("publishes a segment rate once the threshold is met", () => {
    const segments = computeSegments(settledSet(MIN_SEGMENT_SAMPLE, 0), ["sport"]);
    const football = segments.find((segment) => segment.label === "football")!;
    expect(football.belowThreshold).toBe(false);
    expect(football.selection.hitRate.state).toBe("measured");
  });

  it("gives a Wilson interval that never claims certainty from three wins", () => {
    const interval = wilsonInterval(3, 3)!;
    expect(interval.high).toBeLessThanOrEqual(1);
    // The lower bound must be well under 100% — the point of using Wilson.
    expect(interval.low).toBeLessThan(0.6);
  });

  it("withholds calibration error until there are enough events", () => {
    expect(computeForecastMetrics(settledSet(5, 5)).expectedCalibrationError.state).toBe("insufficient-sample");
    expect(computeForecastMetrics(settledSet(30, 30)).expectedCalibrationError.state).toBe("measured");
  });
});

describe("forecast metrics and selection metrics stay separate", () => {
  it("scores probabilities independently of price", () => {
    const forecast = computeForecastMetrics(settledSet(5, 5));
    // Brier for p=0.55 on a 50% outcome set is a property of the probability,
    // and must not move when the price does.
    const atLongerOdds = computeForecastMetrics(settledSet(5, 5, 10));
    expect(forecast.brierScore.value).toBeCloseTo(atLongerOdds.brierScore.value!, 10);
  });

  it("scores selections on price, independently of the probability", () => {
    const evens = computeSelectionMetrics(settledSet(5, 5, 2), {});
    const longer = computeSelectionMetrics(settledSet(5, 5, 10), {});
    expect(evens.yieldPerUnit.value).not.toBeCloseTo(longer.yieldPerUnit.value!, 5);
    expect(evens.hitRate.value).toBeCloseTo(longer.hitRate.value!, 10);
  });

  it("reports closing-line value as unavailable rather than zero when not captured", () => {
    const selection = computeSelectionMetrics(settledSet(10, 10), {});
    expect(selection.closingLineValue.state).toBe("unavailable");
    expect(selection.closingLineValue.value).toBeNull();
  });

  it("measures drawdown in staked units along publication order", () => {
    const rows = [
      publication({ publicationId: "a", settlementStatus: "lost", publishedAt: "2026-08-01T10:00:00.000Z" }),
      publication({ publicationId: "b", settlementStatus: "lost", publishedAt: "2026-08-01T11:00:00.000Z" }),
      publication({ publicationId: "c", settlementStatus: "won", publishedAt: "2026-08-01T12:00:00.000Z" })
    ];
    // Two consecutive losses at one unit each: the trough is two units below
    // the starting peak.
    expect(computeSelectionMetrics(rows, {}).maxDrawdownUnits.value).toBeCloseTo(2, 10);
  });
});

describe("evidence classes never merge", () => {
  it("admits only official public picks to the official record", () => {
    for (const recordClass of ["shadow_decision", "backtest_record", "simulation", "community_selection", "editorial_observation"]) {
      expect(isOfficialLedgerClass(recordClass)).toBe(false);
    }
    expect(isOfficialLedgerClass("official_public_pick")).toBe(true);
    expect(computeLedgerPerformance(settledSet(1, 1), "complete").recordClass).toBe("official_public_pick");
  });
});

describe("articles fail closed", () => {
  function context(overrides: Partial<ValidationContext> = {}): ValidationContext {
    const publications = settledSet(2, 1);
    return {
      provenance: {
        sourceFixtureIds: ["api-football:1"],
        publicationIds: publications.map((entry) => entry.publicationId),
        settlementIds: [],
        dataCutoffAt: "2026-08-01T18:00:00.000Z",
        generatedAt: "2026-08-01T18:05:00.000Z",
        generatorVersion: "results-recap-v2",
        modelVersion: "football-v4"
      },
      claims: { statedPickCount: 3, statedWins: 2, statedLosses: 1, claimsFinalResults: true, disclosesIncompleteData: false },
      publications,
      knownFixtureIds: ["api-football:1"],
      sourceIncomplete: false,
      performanceSettledCount: 3,
      ...overrides
    };
  }

  it("publishes an article whose claims the ledger supports", () => {
    expect(validateArticle(context()).publishable).toBe(true);
  });

  it("blocks an article whose pick count does not match its referenced ids", () => {
    const result = validateArticle(context({ claims: { ...context().claims, statedPickCount: 5 } }));
    expect(result.publishable).toBe(false);
    expect(result.failures.map((failure) => failure.rule)).toContain("count-matches-ids");
  });

  it("blocks an article claiming a pick that is not in the ledger", () => {
    const base = context();
    const result = validateArticle({
      ...base,
      provenance: { ...base.provenance, publicationIds: [...base.provenance.publicationIds, "ghost"] },
      claims: { ...base.claims, statedPickCount: 4 }
    });
    expect(result.publishable).toBe(false);
    expect(result.failures.map((failure) => failure.rule)).toContain("picks-are-official");
  });

  it("blocks an article whose result claim no longer matches settlement", () => {
    const result = validateArticle(context({ claims: { ...context().claims, statedWins: 3, statedLosses: 0 } }));
    expect(result.publishable).toBe(false);
    expect(result.failures.map((failure) => failure.rule)).toContain("settlement-current");
  });

  it("blocks a final review that references an unsettled pick", () => {
    const publications = [...settledSet(2, 1), publication({ publicationId: "open", settlementStatus: "unsettled" })];
    const base = context();
    const result = validateArticle({
      ...base,
      publications,
      provenance: { ...base.provenance, publicationIds: publications.map((entry) => entry.publicationId) },
      claims: { ...base.claims, statedPickCount: 4 }
    });
    expect(result.publishable).toBe(false);
    expect(result.failures.map((failure) => failure.rule)).toContain("final-results-are-settled");
  });

  it("blocks an article citing a retracted publication", () => {
    const publications = [...settledSet(2, 1), publication({ publicationId: "gone", publicationStatus: "retracted", settlementStatus: "won" })];
    const base = context();
    const result = validateArticle({
      ...base,
      publications,
      provenance: { ...base.provenance, publicationIds: publications.map((entry) => entry.publicationId) },
      claims: { ...base.claims, statedPickCount: 4 }
    });
    expect(result.publishable).toBe(false);
    expect(result.failures.map((failure) => failure.rule)).toContain("no-retracted-picks");
  });

  it("blocks an article referencing a fixture that does not exist", () => {
    const result = validateArticle(context({ knownFixtureIds: [] }));
    expect(result.publishable).toBe(false);
    expect(result.failures.map((failure) => failure.rule)).toContain("fixtures-exist");
  });

  it("blocks undisclosed use of stale or partial projections", () => {
    expect(validateArticle(context({ sourceIncomplete: true })).publishable).toBe(false);
    // Disclosure makes the same article publishable.
    const disclosed = validateArticle(
      context({ sourceIncomplete: true, claims: { ...context().claims, disclosesIncompleteData: true } })
    );
    expect(disclosed.publishable).toBe(true);
  });

  it("blocks an article that contradicts the performance page", () => {
    const result = validateArticle(context({ performanceSettledCount: 1 }));
    expect(result.publishable).toBe(false);
    expect(result.failures.map((failure) => failure.rule)).toContain("agrees-with-performance");
  });

  it("blocks an article with incomplete provenance", () => {
    const base = context();
    const result = validateArticle({ ...base, provenance: { ...base.provenance, generatorVersion: "", dataCutoffAt: "" } });
    expect(result.publishable).toBe(false);
    expect(result.failures.filter((failure) => failure.rule === "provenance-complete").length).toBe(2);
  });
});

describe("thin pages stay out of the index", () => {
  const substantial = {
    subjectCount: 3,
    uniqueWordCount: 400,
    isUnavailableOrEmpty: false,
    isOperationalSummary: false,
    isRepetitiveSummary: false
  };

  it("indexes substantial analysis", () => {
    expect(classifyIndexability(substantial).index).toBe(true);
  });

  it("does not index an empty or unavailable page", () => {
    expect(classifyIndexability({ ...substantial, isUnavailableOrEmpty: true }).index).toBe(false);
  });

  it("does not index internal engine summaries", () => {
    const verdict = classifyIndexability({ ...substantial, isOperationalSummary: true });
    expect(verdict.index).toBe(false);
    expect(verdict.reason).toContain("operators");
  });

  it("does not index a stub with a headline and nothing else", () => {
    expect(classifyIndexability({ ...substantial, uniqueWordCount: 40 }).index).toBe(false);
  });

  it("does not index a page about no specific subject", () => {
    expect(classifyIndexability({ ...substantial, subjectCount: 0 }).index).toBe(false);
  });

  it("counts only the words that vary with the data", () => {
    expect(uniqueWordCount(["Arsenal beat Chelsea two nil", "The model had it at 55%"])).toBe(11);
  });
});
