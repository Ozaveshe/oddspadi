import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { TrackRecordTable } from "@/components/performance/TrackRecordTable";
import { TrackRecordSummaryPanel } from "@/components/performance/TrackRecordSummaryPanel";
import type { OfficialPublicationDetail } from "@/lib/domain/canonicalReads";
import { EVIDENCE_CLASSES } from "@/lib/performance/trackRecordEvidence";
import {
  formatTrackRecordCsv,
  formatTrackRecordJson,
  TRACK_RECORD_CSV_HEADERS,
  TRACK_RECORD_METRIC_DEFINITIONS
} from "@/lib/performance/trackRecordExport";
import {
  ANY,
  applyTrackRecordFilters,
  emptyTrackRecordFilters,
  encodeTrackRecordQuery,
  marketFamilyOf,
  parsePeriodRequest,
  parseTrackRecordFilters,
  probabilityBandOf,
  trackRecordBandDefinitions
} from "@/lib/performance/trackRecordFilters";
import {
  describePeriodCoverage,
  resolveTrackRecordPeriod,
  type LedgerSpan
} from "@/lib/performance/trackRecordPeriods";
import { computeTrackRecordSummary, unavailableTrackRecordSummary } from "@/lib/performance/trackRecordSummary";
import {
  buildTrackRecordExportView,
  buildTrackRecordView,
  clearTrackRecordLastKnownGood,
  toTrackRecordRow,
  type TrackRecordView
} from "@/lib/performance/trackRecordView";
import { fakeLedgerClient, type FakeRow } from "@/test/support/fakeLedgerClient";

/**
 * The public track record, held to its promises.
 *
 * Each block below corresponds to a way this page could quietly become a lie:
 * a headline that does not equal its rows, a filter that applies to the table
 * but not the export, a failed read that renders as a zero, a corrected claim
 * that keeps scoring, a closing-line value invented out of missing data, or a
 * period tab that reports "0%" for a month the ledger has never reached.
 */

const NOW = new Date("2026-08-07T10:00:00.000Z");
const LAGOS = "Africa/Lagos";

function publication(overrides: Partial<OfficialPublicationDetail> = {}): OfficialPublicationDetail {
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
    publishedAt: "2026-08-03T12:00:00.000Z",
    kickoffAt: "2026-08-03T15:00:00.000Z",
    publicationStatus: "published",
    settlementStatus: "unsettled",
    settledAt: null,
    correctionReason: null,
    revision: 1,
    marketLine: null,
    modelVersion: "football-v4",
    featureSetVersion: "features-v3",
    calibrationVersion: "cal-2026-08",
    decisionPolicyVersion: "policy-v2",
    decisionStatus: "pick",
    dataQuality: "complete",
    evidenceCutoffAt: "2026-08-03T11:00:00.000Z",
    oddsSnapshotAt: "2026-08-03T11:55:00.000Z",
    publicCopyRef: null,
    supersedesPublicationId: null,
    closingOdds: null,
    ...overrides
  };
}

function settledSet(wins: number, losses: number, overrides: Partial<OfficialPublicationDetail> = {}) {
  return [
    ...Array.from({ length: wins }, (_, index) =>
      publication({
        publicationId: `won-${index}`,
        settlementStatus: "won",
        settledAt: "2026-08-03T17:00:00.000Z",
        ...overrides
      })
    ),
    ...Array.from({ length: losses }, (_, index) =>
      publication({
        publicationId: `lost-${index}`,
        settlementStatus: "lost",
        settledAt: "2026-08-03T17:30:00.000Z",
        ...overrides
      })
    )
  ];
}

/** A publication as PostgREST would return it. */
function row(detail: OfficialPublicationDetail): FakeRow {
  return {
    id: detail.publicationId,
    fixture_id: detail.fixtureId,
    fixture_external_id: detail.fixtureExternalId,
    sport: detail.sport,
    competition: detail.competition,
    market: detail.market,
    selection: detail.selection,
    selection_label: detail.selectionLabel,
    model_probability: detail.modelProbability,
    odds_at_publication: detail.oddsAtPublication,
    implied_probability: detail.impliedProbability,
    published_at: detail.publishedAt,
    kickoff_at: detail.kickoffAt,
    publication_status: detail.publicationStatus,
    settlement_status: detail.settlementStatus,
    settled_at: detail.settledAt,
    correction_reason: detail.correctionReason,
    revision: detail.revision,
    market_line: detail.marketLine,
    model_version: detail.modelVersion,
    feature_set_version: detail.featureSetVersion,
    calibration_version: detail.calibrationVersion,
    decision_policy_version: detail.decisionPolicyVersion,
    decision_status: detail.decisionStatus,
    data_quality: detail.dataQuality,
    evidence_cutoff_at: detail.evidenceCutoffAt,
    odds_snapshot_at: detail.oddsSnapshotAt,
    public_copy_ref: detail.publicCopyRef,
    supersedes_publication_id: detail.supersedesPublicationId,
    metadata: detail.closingOdds === null ? {} : { closingOdds: detail.closingOdds }
  };
}

function ledger(details: OfficialPublicationDetail[], failing?: Record<string, string>) {
  return fakeLedgerClient(
    {
      op_publications: details.map(row),
      op_fixtures: [{ id: "fixture-1", home_team_name: "Arsenal", away_team_name: "Chelsea" }]
    },
    failing ? { failing } : {}
  );
}

async function view(details: OfficialPublicationDetail[], searchParams: Record<string, string> = {}, failing?: Record<string, string>) {
  return buildTrackRecordView({
    searchParams,
    timeZone: LAGOS,
    now: NOW,
    client: ledger(details, failing)
  });
}

beforeEach(() => {
  clearTrackRecordLastKnownGood();
});

/* ------------------------------------------------------------------ periods */

describe("period boundaries come from the shared day-window helpers", () => {
  it("resolves today in the visitor's zone, not in UTC", () => {
    const lagos = resolveTrackRecordPeriod({ id: "today", now: NOW, timeZone: LAGOS });
    const utc = resolveTrackRecordPeriod({ id: "today", now: NOW, timeZone: "UTC" });
    // Lagos is UTC+1 all year, so its day starts an hour earlier in UTC terms.
    expect(lagos.startUtc?.toISOString()).toBe("2026-08-06T23:00:00.000Z");
    expect(utc.startUtc?.toISOString()).toBe("2026-08-07T00:00:00.000Z");
    expect(lagos.endUtc?.toISOString()).toBe("2026-08-07T23:00:00.000Z");
  });

  it("starts the week on Monday and leaves it open at today", () => {
    // 2026-08-07 is a Friday.
    const week = resolveTrackRecordPeriod({ id: "this-week", now: NOW, timeZone: LAGOS });
    expect(week.startDay).toBe("2026-08-03");
    expect(week.endDay).toBe("2026-08-07");
  });

  it("gives last week the complete Monday-to-Sunday before it", () => {
    const week = resolveTrackRecordPeriod({ id: "last-week", now: NOW, timeZone: LAGOS });
    expect(week.startDay).toBe("2026-07-27");
    expect(week.endDay).toBe("2026-08-02");
  });

  it("anchors month and year periods to the calendar", () => {
    expect(resolveTrackRecordPeriod({ id: "this-month", now: NOW, timeZone: LAGOS }).startDay).toBe("2026-08-01");
    const previous = resolveTrackRecordPeriod({ id: "previous-month", now: NOW, timeZone: LAGOS });
    expect(previous.startDay).toBe("2026-07-01");
    expect(previous.endDay).toBe("2026-07-31");
    expect(resolveTrackRecordPeriod({ id: "year-to-date", now: NOW, timeZone: LAGOS }).startDay).toBe("2026-01-01");
  });

  it("leaves all time unbounded rather than inventing a start", () => {
    const all = resolveTrackRecordPeriod({ id: "all-time", now: NOW, timeZone: LAGOS });
    expect(all.startUtc).toBeNull();
    expect(all.endUtc).toBeNull();
  });

  it("refuses a malformed or backwards custom range and says why", () => {
    const backwards = resolveTrackRecordPeriod({ id: "custom", from: "2026-08-07", to: "2026-08-01", now: NOW });
    expect(backwards.startUtc).toBeNull();
    expect(backwards.invalidReason).toContain("ended before it started");

    const malformed = resolveTrackRecordPeriod({ id: "custom", from: "not-a-date", to: "2026-08-01", now: NOW });
    expect(malformed.invalidReason).toContain("YYYY-MM-DD");
  });

  it("accepts a well-formed custom range", () => {
    const range = resolveTrackRecordPeriod({ id: "custom", from: "2026-08-01", to: "2026-08-03", now: NOW, timeZone: LAGOS });
    expect(range.invalidReason).toBeNull();
    expect(range.startUtc?.toISOString()).toBe("2026-07-31T23:00:00.000Z");
    expect(range.endUtc?.toISOString()).toBe("2026-08-03T23:00:00.000Z");
  });
});

describe("a period the ledger cannot reach reports coverage, not a zero", () => {
  const span: LedgerSpan = {
    firstPublishedAt: "2026-08-03T09:00:00.000Z",
    lastPublishedAt: "2026-08-03T18:00:00.000Z",
    totalPublished: 230,
    spanDays: 1,
    availability: "measured"
  };

  it("says a period is outside the record rather than reporting nothing won", () => {
    const previousMonth = resolveTrackRecordPeriod({ id: "previous-month", now: NOW, timeZone: LAGOS });
    const coverage = describePeriodCoverage(previousMonth, span);
    expect(coverage.kind).toBe("entirely-before-ledger");
    expect(coverage.sentence).toContain("outside the record");
    expect(coverage.sentence).not.toMatch(/\b0%/);
  });

  it("flags a period that only partly overlaps the ledger", () => {
    const month = resolveTrackRecordPeriod({ id: "this-month", now: NOW, timeZone: LAGOS });
    expect(describePeriodCoverage(month, span).kind).toBe("partially-covered");
  });

  it("never claims coverage when the extent could not be read", () => {
    const unknown = describePeriodCoverage(resolveTrackRecordPeriod({ id: "today", now: NOW }), {
      firstPublishedAt: null,
      lastPublishedAt: null,
      totalPublished: null,
      spanDays: null,
      availability: "unavailable"
    });
    expect(unknown.kind).toBe("unknown");
    expect(unknown.sentence).toContain("not a claim that it covers none");
  });

  it("distinguishes an empty ledger from an unreadable one", () => {
    const empty = describePeriodCoverage(resolveTrackRecordPeriod({ id: "today", now: NOW }), {
      firstPublishedAt: null,
      lastPublishedAt: null,
      totalPublished: 0,
      spanDays: null,
      availability: "measured"
    });
    expect(empty.kind).toBe("empty-ledger");
    expect(empty.sentence).toContain("not a zero result");
  });
});

/* ------------------------------------------------------------------ filters */

describe("filters are a URL, and the URL round-trips", () => {
  it("encodes only what differs from the default", () => {
    const filters = { ...emptyTrackRecordFilters(), sport: "tennis", oddsBand: "2-00-2-99" };
    const query = encodeTrackRecordQuery({ period: "this-week", filters, pageSize: 50 });
    expect(query).toBe("?period=this-week&sport=tennis&odds=2-00-2-99");
  });

  it("omits every default so a plain link stays plain", () => {
    expect(encodeTrackRecordQuery({ period: "all-time", filters: emptyTrackRecordFilters() })).toBe("");
  });

  it("parses back exactly what it encoded", () => {
    const filters = { ...emptyTrackRecordFilters(), competition: "Premier League", result: "won", leadTimeBand: "6-24h" };
    const query = new URLSearchParams(encodeTrackRecordQuery({ period: "today", filters }).slice(1));
    const params = Object.fromEntries(query.entries());
    expect(parseTrackRecordFilters(params)).toEqual(filters);
    expect(parsePeriodRequest(params).id).toBe("today");
  });

  it("drops an unknown value for a closed dimension instead of returning nothing", () => {
    // Returning zero rows for a typo reads as "the model never won in that
    // band", which is a claim nobody made.
    expect(parseTrackRecordFilters({ odds: "made-up" }).oddsBand).toBe(ANY);
    expect(parseTrackRecordFilters({ result: "probably" }).result).toBe(ANY);
  });

  it("keeps a custom range only when the period is custom", () => {
    const filters = emptyTrackRecordFilters();
    expect(encodeTrackRecordQuery({ period: "custom", from: "2026-08-01", to: "2026-08-03", filters })).toBe(
      "?period=custom&from=2026-08-01&to=2026-08-03"
    );
    expect(encodeTrackRecordQuery({ period: "today", from: "2026-08-01", to: "2026-08-03", filters })).toBe("?period=today");
  });
});

describe("every filter dimension selects what it says it does", () => {
  const rows = [
    publication({ publicationId: "a", sport: "football", market: "match_winner", selection: "home", oddsAtPublication: 1.8, modelProbability: 0.62, modelVersion: "football-v4", settlementStatus: "won", settledAt: "2026-08-03T17:00:00.000Z" }),
    publication({ publicationId: "b", sport: "tennis", competition: "WTA Toronto", market: "over_under_2_5", selection: "over", oddsAtPublication: 3.4, modelProbability: 0.35, modelVersion: "tennis-v2", decisionStatus: "lean", dataQuality: "partial", settlementStatus: "lost", settledAt: "2026-08-03T18:00:00.000Z" }),
    publication({ publicationId: "c", sport: "football", market: "btts", selection: "yes", oddsAtPublication: 6, modelProbability: 0.48, calibrationVersion: "cal-2026-07", publishedAt: "2026-08-03T06:00:00.000Z", kickoffAt: "2026-08-05T15:00:00.000Z" })
  ];
  const only = (key: string, value: string) =>
    applyTrackRecordFilters(rows, { ...emptyTrackRecordFilters(), [key]: value }).map((entry) => entry.publicationId);

  it("filters on sport, competition and market family", () => {
    expect(only("sport", "tennis")).toEqual(["b"]);
    expect(only("competition", "WTA Toronto")).toEqual(["b"]);
    expect(only("marketFamily", "totals")).toEqual(["b"]);
    expect(only("marketFamily", "both-teams-to-score")).toEqual(["c"]);
  });

  it("filters on selection type, odds band and probability band", () => {
    expect(only("selectionType", "over")).toEqual(["b"]);
    expect(only("oddsBand", "1-50-1-99")).toEqual(["a"]);
    expect(only("oddsBand", "5-00-plus")).toEqual(["c"]);
    expect(only("probabilityBand", "60-69")).toEqual(["a"]);
    expect(only("probabilityBand", "under-40")).toEqual(["b"]);
  });

  it("filters on model version, calibration version, decision tier and readiness", () => {
    expect(only("modelVersion", "tennis-v2")).toEqual(["b"]);
    expect(only("calibrationVersion", "cal-2026-07")).toEqual(["c"]);
    expect(only("decisionTier", "lean")).toEqual(["b"]);
    expect(only("readinessBand", "partial")).toEqual(["b"]);
  });

  it("filters on publication lead time and result state", () => {
    expect(only("leadTimeBand", "2-6h")).toEqual(["a", "b"]);
    expect(only("leadTimeBand", "over-24h")).toEqual(["c"]);
    expect(only("result", "won")).toEqual(["a"]);
    expect(only("result", "pending")).toEqual(["c"]);
    expect(only("result", "settled")).toEqual(["a", "b"]);
  });

  it("publishes a definition for every band it can filter on", () => {
    const definitions = trackRecordBandDefinitions();
    expect(definitions.length).toBeGreaterThan(20);
    for (const entry of definitions) {
      expect(entry.definition.length, `${entry.dimension}/${entry.band} has no definition`).toBeGreaterThan(10);
    }
    expect(marketFamilyOf("asian_handicap_-1").label).toBe("Handicap");
    expect(probabilityBandOf(0.95).label).toBe("70% and above");
  });
});

/* ------------------------------------------------------------------ summary */

describe("the summary reconciles with the rows it summarises", () => {
  it("accounts for every publication exactly once", () => {
    const rows = [
      ...settledSet(4, 3),
      publication({ publicationId: "p", settlementStatus: "push", settledAt: "2026-08-03T18:00:00.000Z" }),
      publication({ publicationId: "v", settlementStatus: "void", settledAt: "2026-08-03T18:00:00.000Z" }),
      publication({ publicationId: "c", settlementStatus: "cancelled", settledAt: "2026-08-03T18:00:00.000Z" }),
      publication({ publicationId: "u", settlementStatus: "unsettled" }),
      publication({ publicationId: "r", settlementStatus: "pending_verification" })
    ];
    const summary = computeTrackRecordSummary({ publications: rows, availability: "complete" });
    expect(summary.published).toBe(12);
    expect(summary.won + summary.lost + summary.push + summary.voided + summary.cancelled + summary.pending).toBe(
      summary.published
    );
    expect(summary.decided).toBe(7);
    expect(summary.settled).toBe(10);
  });

  it("keeps push, void and cancelled out of the hit-rate denominator", () => {
    const rows = [
      ...settledSet(3, 1),
      publication({ publicationId: "p", settlementStatus: "push", settledAt: "2026-08-03T18:00:00.000Z" }),
      publication({ publicationId: "v", settlementStatus: "void", settledAt: "2026-08-03T18:00:00.000Z" })
    ];
    const summary = computeTrackRecordSummary({ publications: rows, availability: "complete" });
    expect(summary.decided).toBe(4);
    expect(summary.hitRate.value).toBeCloseTo(0.75, 10);
    // Four decided at evens: three wins (+1 each) and one loss (−1).
    expect(summary.profitUnits.value).toBeCloseTo(2, 10);
  });

  it("computes profit as the sum of the rows' unit returns", () => {
    const rows = settledSet(2, 2, { oddsAtPublication: 3 });
    const summary = computeTrackRecordSummary({ publications: rows, availability: "complete" });
    const fromRows = rows
      .map((entry) => toTrackRecordRow(entry, new Map()).unitReturn ?? 0)
      .reduce((sum, value) => sum + value, 0);
    expect(summary.profitUnits.value).toBeCloseTo(fromRows, 10);
    expect(summary.roi.value).toBeCloseTo(fromRows / 4, 10);
  });

  it("excludes a retracted claim from the score while still counting it as published", () => {
    const rows = [
      ...settledSet(2, 1),
      publication({ publicationId: "gone", settlementStatus: "won", publicationStatus: "retracted", settledAt: "2026-08-03T18:00:00.000Z" })
    ];
    const summary = computeTrackRecordSummary({ publications: rows, availability: "complete" });
    expect(summary.won).toBe(2);
    expect(summary.decided).toBe(3);
    // The retracted row is withdrawn from the record in both directions, so it
    // is not in `published` either — `published` is the scorable set.
    expect(summary.published).toBe(3);
  });

  it("reports a streak and both drawdowns", () => {
    const rows = [
      publication({ publicationId: "1", settlementStatus: "won", publishedAt: "2026-08-03T09:00:00.000Z", settledAt: "2026-08-03T12:00:00.000Z" }),
      publication({ publicationId: "2", settlementStatus: "lost", publishedAt: "2026-08-03T10:00:00.000Z", settledAt: "2026-08-03T13:00:00.000Z" }),
      publication({ publicationId: "3", settlementStatus: "lost", publishedAt: "2026-08-03T11:00:00.000Z", settledAt: "2026-08-03T14:00:00.000Z" })
    ];
    const summary = computeTrackRecordSummary({ publications: rows, availability: "complete" });
    expect(summary.currentStreak).toMatchObject({ kind: "lost", length: 2 });
    expect(summary.maxDrawdownUnits.value).toBeCloseTo(2, 10);
    expect(summary.currentDrawdownUnits.value).toBeCloseTo(2, 10);
    expect(summary.lastSettlementAt).toBe("2026-08-03T14:00:00.000Z");
  });

  it("warns while the settled sample is small", () => {
    expect(computeTrackRecordSummary({ publications: settledSet(3, 1), availability: "complete" }).smallSampleWarning).toContain(
      "4 settled pick"
    );
    expect(computeTrackRecordSummary({ publications: settledSet(60, 60), availability: "complete" }).smallSampleWarning).toBeNull();
  });
});

describe("closing-line value is reported with its coverage, never invented", () => {
  it("reports CLV as unavailable and coverage as zero when no closing price exists", () => {
    const summary = computeTrackRecordSummary({ publications: settledSet(5, 5), availability: "complete" });
    expect(summary.averageClosingLineValue.state).toBe("unavailable");
    expect(summary.averageClosingLineValue.value).toBeNull();
    expect(summary.averageClosingOdds.state).toBe("unavailable");
    // Coverage of zero is a real measurement about our data, unlike a CLV of 0.
    expect(summary.closingCoverage.state).toBe("measured");
    expect(summary.closingCoverage.value).toBe(0);
    expect(summary.closingCoverageCount).toBe(0);
  });

  it("measures CLV over only the rows that carry a close", () => {
    const rows = [
      publication({ publicationId: "with", oddsAtPublication: 2.2, closingOdds: 2, settlementStatus: "won", settledAt: "2026-08-03T17:00:00.000Z" }),
      publication({ publicationId: "without", oddsAtPublication: 3, settlementStatus: "lost", settledAt: "2026-08-03T17:00:00.000Z" })
    ];
    const summary = computeTrackRecordSummary({ publications: rows, availability: "complete" });
    expect(summary.closingCoverageCount).toBe(1);
    expect(summary.closingCoverage.value).toBeCloseTo(0.5, 10);
    expect(summary.averageClosingLineValue.value).toBeCloseTo(0.1, 10);
    expect(summary.averageClosingOdds.value).toBeCloseTo(2, 10);
  });

  it("ignores an implausible closing price rather than letting it move an average", () => {
    const rows = [publication({ closingOdds: 1, settlementStatus: "won", settledAt: "2026-08-03T17:00:00.000Z" })];
    expect(computeTrackRecordSummary({ publications: rows, availability: "complete" }).closingCoverageCount).toBe(0);
  });
});

describe("an unreadable ledger produces nulls, not zeroes", () => {
  it("returns every rate as unavailable", () => {
    const summary = unavailableTrackRecordSummary("connection reset");
    for (const metric of [
      summary.hitRate,
      summary.roi,
      summary.profitUnits,
      summary.averagePublishedOdds,
      summary.averageClosingOdds,
      summary.averageClosingLineValue,
      summary.maxDrawdownUnits,
      summary.currentDrawdownUnits,
      summary.closingCoverage
    ]) {
      expect(metric.state).toBe("unavailable");
      expect(metric.value).toBeNull();
    }
    expect(summary.forecast.brierScore.state).toBe("unavailable");
  });

  it("distinguishes a genuinely empty period from an unreadable one", () => {
    const empty = computeTrackRecordSummary({ publications: [], availability: "confirmed_empty" });
    expect(empty.hitRate.state).toBe("not-applicable");
    expect(empty.profitUnits.state).toBe("not-applicable");
  });
});

/* --------------------------------------------------------------------- view */

describe("the view keeps the headline and the rows in step", () => {
  it("makes the summary an exact aggregate of the rows on the page", async () => {
    const built = await view(settledSet(6, 4));
    expect(built.presentation).toBe("live");
    expect(built.page.rows.length).toBe(10);
    expect(built.summary.published).toBe(built.page.matchingRows);
    expect(built.summary.won).toBe(built.page.rows.filter((entry) => entry.settlementStatus === "won").length);
    const rowProfit = built.page.rows.reduce((sum, entry) => sum + (entry.unitReturn ?? 0), 0);
    expect(built.summary.profitUnits.value).toBeCloseTo(rowProfit, 10);
  });

  it("applies a filter to the summary and the table identically", async () => {
    const rows = [
      ...settledSet(3, 1, { sport: "football" }),
      ...settledSet(1, 2, { sport: "tennis", publicationId: "t" }).map((entry, index) => ({
        ...entry,
        publicationId: `tennis-${index}`,
        sport: "tennis"
      }))
    ];
    const built = await view(rows, { sport: "tennis" });
    expect(built.page.matchingRows).toBe(3);
    expect(built.summary.published).toBe(3);
    expect(built.page.rows.every((entry) => entry.sport === "tennis")).toBe(true);
    expect(built.activeFilters.map((entry) => entry.key)).toEqual(["sport"]);
  });

  it("splits cleanly by model version", async () => {
    const rows = [
      ...settledSet(3, 0, { modelVersion: "football-v4" }),
      ...settledSet(0, 3, { modelVersion: "football-v5" }).map((entry, index) => ({
        ...entry,
        publicationId: `v5-${index}`,
        modelVersion: "football-v5"
      }))
    ];
    const four = await view(rows, { model: "football-v4" });
    const five = await view(rows, { model: "football-v5" });
    expect(four.summary.won).toBe(3);
    expect(four.summary.lost).toBe(0);
    expect(five.summary.won).toBe(0);
    expect(five.summary.lost).toBe(3);
    // Two model versions in one period must never be pooled into one rate by
    // accident: the unfiltered view is the union, not either half.
    const both = await view(rows);
    expect(both.summary.decided).toBe(6);
  });

  it("paginates by keyset and does not repeat a row across pages", async () => {
    const rows = Array.from({ length: 7 }, (_, index) =>
      publication({
        publicationId: `pub-${index}`,
        publishedAt: `2026-08-03T${String(9 + index).padStart(2, "0")}:00:00.000Z`
      })
    );
    const first = await view(rows, { rows: "25" });
    expect(first.page.rows.length).toBe(7);

    const paged = await buildTrackRecordView({
      searchParams: {},
      timeZone: LAGOS,
      now: NOW,
      client: ledger(rows),
      pageSizeOverride: 3
    });
    expect(paged.page.rows.map((entry) => entry.publicationId)).toEqual(["pub-6", "pub-5", "pub-4"]);
    expect(paged.page.nextHref).toContain("after=");
    expect(paged.page.totalPages).toBe(3);

    const cursor = new URL(`https://example.test${paged.page.nextHref}`).searchParams.get("after");
    const second = await buildTrackRecordView({
      searchParams: { after: cursor ?? "" },
      timeZone: LAGOS,
      now: NOW,
      client: ledger(rows),
      pageSizeOverride: 3
    });
    expect(second.page.rows.map((entry) => entry.publicationId)).toEqual(["pub-3", "pub-2", "pub-1"]);
    expect(second.page.pageNumber).toBe(2);
    expect(second.page.previousHref).not.toBeNull();
  });

  it("restricts a period to publications made inside it", async () => {
    const rows = [
      publication({ publicationId: "inside", publishedAt: "2026-08-07T08:00:00.000Z", kickoffAt: "2026-08-07T18:00:00.000Z" }),
      publication({ publicationId: "outside", publishedAt: "2026-08-03T08:00:00.000Z" })
    ];
    const today = await view(rows, { period: "today" });
    expect(today.page.rows.map((entry) => entry.publicationId)).toEqual(["inside"]);
    const all = await view(rows);
    expect(all.page.matchingRows).toBe(2);
  });

  it("resolves the fixture name for display without letting it into a number", async () => {
    const built = await view([publication({ settlementStatus: "won", settledAt: "2026-08-03T17:00:00.000Z" })]);
    expect(built.page.rows[0].fixtureLabel).toBe("Arsenal v Chelsea");
    // A missing label falls back to the external id rather than blanking a row.
    const unnamed = await view([publication({ fixtureId: "fixture-unknown" })]);
    expect(unnamed.page.rows[0].fixtureLabel).toBe("api-football:1");
  });
});

describe("a failed read never renders as a zero record", () => {
  it("reports unavailable with null metrics when the ledger cannot be read", async () => {
    const built = await view(settledSet(5, 5), {}, { op_publications: "statement timeout" });
    expect(built.presentation).toBe("unavailable");
    expect(built.availability).toBe("unavailable");
    expect(built.unavailableReason).toContain("statement timeout");
    expect(built.summary.hitRate.value).toBeNull();
    expect(built.summary.hitRate.state).toBe("unavailable");
    expect(built.page.rows).toEqual([]);
  });

  it("falls back to the last known good answer before falling back to nothing", async () => {
    const rows = settledSet(4, 2);
    const healthy = await view(rows);
    expect(healthy.presentation).toBe("live");

    const degraded = await view(rows, {}, { op_publications: "connection reset" });
    expect(degraded.presentation).toBe("last-known-good");
    expect(degraded.summary.won).toBe(healthy.summary.won);
    expect(degraded.lastKnownGoodAt).not.toBeNull();
    expect(degraded.unavailableReason).toContain("connection reset");
  });

  it("has no last known good on a cold runtime, and says unavailable instead", async () => {
    clearTrackRecordLastKnownGood();
    const cold = await view(settledSet(4, 2), {}, { op_publications: "connection reset" });
    expect(cold.presentation).toBe("unavailable");
  });

  it("keeps last-known-good per query rather than serving one view's numbers for another", async () => {
    const rows = [...settledSet(3, 0, { sport: "football" }), publication({ publicationId: "t", sport: "tennis" })];
    await view(rows, { sport: "football" });
    const otherQuery = await view(rows, { sport: "tennis" }, { op_publications: "connection reset" });
    expect(otherQuery.presentation).toBe("unavailable");
  });
});

describe("an empty official sample is stated, not scored", () => {
  it("reports a confirmed-empty period with no rate at all", async () => {
    const built = await view([]);
    expect(built.presentation).toBe("live");
    expect(built.availability).toBe("confirmed_empty");
    expect(built.summary.published).toBe(0);
    expect(built.summary.hitRate.state).toBe("not-applicable");
    expect(built.summary.profitUnits.state).toBe("not-applicable");
    expect(built.coverage.kind).toBe("empty-ledger");
  });
});

describe("corrections propagate into the view", () => {
  it("shows a corrected claim as corrected and a retracted one as withdrawn", async () => {
    const rows = [
      publication({
        publicationId: "corrected",
        publicationStatus: "corrected",
        revision: 2,
        correctionReason: "Price was recorded against the wrong bookmaker.",
        settlementStatus: "won",
        settledAt: "2026-08-03T17:00:00.000Z"
      }),
      publication({
        publicationId: "retracted",
        publicationStatus: "retracted",
        revision: 3,
        correctionReason: "Fixture was a duplicate row.",
        settlementStatus: "won",
        settledAt: "2026-08-03T17:00:00.000Z"
      })
    ];
    const built = await view(rows);
    // The retracted claim is visible in the table for audit but scores nothing.
    expect(built.summary.won).toBe(1);
    expect(built.summary.published).toBe(1);
    const corrected = built.page.rows.find((entry) => entry.publicationId === "corrected");
    const retracted = built.page.rows.find((entry) => entry.publicationId === "retracted");
    expect(corrected?.correctionState).toBe("Corrected (revision 2)");
    expect(corrected?.correctionReason).toContain("wrong bookmaker");
    expect(retracted?.correctionState).toBe("Retracted");
  });
});

/* ------------------------------------------------------------------ exports */

describe("CSV and JSON say the same thing", () => {
  async function exported(details: OfficialPublicationDetail[], searchParams: Record<string, string> = {}) {
    const built = await buildTrackRecordExportView({
      searchParams,
      timeZone: LAGOS,
      now: NOW,
      client: ledger(details)
    });
    return { view: built, csv: formatTrackRecordCsv(built), json: formatTrackRecordJson(built) };
  }

  it("exports the same rows in the same order", async () => {
    const { csv, json, view: built } = await exported(settledSet(3, 2));
    const dataLines = csv.split("\r\n").filter((line) => line.length && !line.startsWith("#"));
    expect(dataLines[0]).toBe(TRACK_RECORD_CSV_HEADERS.join(","));
    expect(dataLines.length - 1).toBe(json.rows.length);
    expect(json.rows.map((entry) => entry.publicationId)).toEqual(built.page.rows.map((entry) => entry.publicationId));
    for (const [index, entry] of json.rows.entries()) {
      expect(dataLines[index + 1].startsWith(entry.publicationId)).toBe(true);
    }
  });

  it("carries the same summary numbers in both formats", async () => {
    const { csv, json } = await exported(settledSet(3, 2));
    expect(json.summaryValues.won).toBe(3);
    expect(json.summaryValues.lost).toBe(2);
    expect(csv).toContain("# Won: 3");
    expect(csv).toContain("# Lost: 2");
    expect(csv).toContain(`# Hit rate: ${(0.6 * 100).toFixed(1)}%`);
  });

  it("carries the filter context and every definition into both formats", async () => {
    const { csv, json } = await exported(settledSet(2, 1, { sport: "tennis" }), { sport: "tennis", period: "all-time" });
    expect(json.context.Sport).toBe("tennis");
    expect(csv).toContain("# Sport: tennis");
    expect(json.definitions.length).toBe(TRACK_RECORD_METRIC_DEFINITIONS.length);
    for (const definition of TRACK_RECORD_METRIC_DEFINITIONS) {
      expect(csv).toContain(`# ${definition.metric}: ${definition.definition}`);
    }
    expect(json.bandDefinitions.length).toBeGreaterThan(20);
    expect(json.source.tables).toEqual(["op_publications", "op_publication_settlements", "op_publication_revisions"]);
  });

  it("writes an unknown value as empty in CSV and null in JSON, never as zero", async () => {
    const { csv, json } = await exported([publication({ publicationId: "open" })]);
    const dataLine = csv.split("\r\n").filter((line) => line.length && !line.startsWith("#"))[1];
    const cells = dataLine.split(",");
    const closingIndex = TRACK_RECORD_CSV_HEADERS.indexOf("closing_odds");
    const returnIndex = TRACK_RECORD_CSV_HEADERS.indexOf("unit_return");
    expect(cells[closingIndex]).toBe("");
    expect(cells[returnIndex]).toBe("");
    expect(json.rows[0].closingOdds).toBeNull();
    expect(json.rows[0].unitReturn).toBeNull();
    expect(json.summaryValues.hitRate).toBeNull();
  });

  it("warns in both formats when the read failed", async () => {
    const built = await buildTrackRecordExportView({
      searchParams: {},
      timeZone: LAGOS,
      now: NOW,
      client: ledger(settledSet(2, 2), { op_publications: "statement timeout" })
    });
    expect(formatTrackRecordCsv(built)).toContain("WARNING: the ledger could not be read");
    expect(formatTrackRecordJson(built).warnings[0]).toContain("not a zero record");
  });

  it("reports counts as unknown, not as zero, when the read failed", async () => {
    const built = await buildTrackRecordExportView({
      searchParams: { sport: "football" },
      timeZone: LAGOS,
      now: NOW,
      client: ledger(settledSet(4, 4), { op_publications: "statement timeout" })
    });
    const json = formatTrackRecordJson(built);
    expect(json.summaryValues.published).toBeNull();
    expect(json.summaryValues.won).toBeNull();
    expect(json.summary.Published).toBe("not available (unavailable)");
    expect(formatTrackRecordCsv(built)).toContain("# Won: not available (unavailable)");
    // The filter that was asked for still travels, so the file says which
    // slice failed rather than implying the whole record is empty.
    expect(json.context.Sport).toBe("football");
  });

  it("quotes a field containing a comma rather than splitting the row", async () => {
    const { csv } = await exported([publication({ competition: "Liga MX, Apertura" })]);
    expect(csv).toContain('"Liga MX, Apertura"');
  });
});

/* ------------------------------------------------------------ evidence + UI */

describe("evidence classes stay apart", () => {
  it("admits exactly one class to the official record", () => {
    const official = EVIDENCE_CLASSES.filter((entry) => entry.countsOfficially);
    expect(official.map((entry) => entry.id)).toEqual(["official-live"]);
    expect(official[0].recordClass).toBe("official_public_pick");
  });

  it("names every class the page has to keep separate", () => {
    const ids = EVIDENCE_CLASSES.map((entry) => entry.id);
    for (const required of [
      "official-live",
      "verified-legacy-official",
      "editorial-archive",
      "shadow-decisions",
      "backtests",
      "community"
    ]) {
      expect(ids).toContain(required);
    }
  });
});

describe("the record renders on a phone as well as a desktop", () => {
  it("emits both the wide table and the card list from the same rows", async () => {
    const built = await view(settledSet(2, 1));
    const markup = renderToStaticMarkup(<TrackRecordTable view={built} />);
    expect(markup).toContain("track-record-table-wrap");
    expect(markup).toContain("track-record-cards");
    // The same publication appears in both, so a phone visitor is not shown a
    // different record from a desktop one.
    for (const entry of built.page.rows) {
      expect(markup.split(entry.publicationId).length - 1).toBeGreaterThanOrEqual(2);
    }
    // Every row offers both doorways.
    expect(markup).toContain("/track-record/publication/");
    expect(markup).toContain("/predictions/");
  });

  it("renders an unavailable read as a sentence, never as a zero", async () => {
    const built = await view(settledSet(3, 3), {}, { op_publications: "statement timeout" });
    const markup = renderToStaticMarkup(<TrackRecordSummaryPanel view={built} />);
    expect(markup).toContain("could not be read");
    expect(markup).not.toMatch(/metric-value">0/);
    expect(markup).not.toContain("0.0%");
  });

  it("offers a compact summary for small screens without dropping the counts", async () => {
    const built = await view(settledSet(3, 1));
    const compact = renderToStaticMarkup(<TrackRecordSummaryPanel view={built} compact />);
    const full = renderToStaticMarkup(<TrackRecordSummaryPanel view={built} />);
    expect(compact).toContain("Hit rate");
    expect(compact).not.toContain("Max drawdown");
    expect(full).toContain("Max drawdown");
  });

  it("says a period is empty rather than scoring it", async () => {
    const built: TrackRecordView = await view([]);
    const markup = renderToStaticMarkup(<TrackRecordSummaryPanel view={built} />);
    expect(markup).toContain("No official picks were published in this period");
    expect(markup).not.toContain("metric-value");
  });
});
