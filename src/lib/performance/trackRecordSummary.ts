import type { OfficialPublicationDetail } from "@/lib/domain/canonicalReads";
import { countsTowardRecord, type DataAvailability } from "@/lib/domain/states";
import {
  SMALL_SAMPLE_WARNING_THRESHOLD,
  computeForecastMetrics,
  computeSelectionMetrics,
  insufficientSampleMetric,
  measuredMetric,
  notApplicableMetric,
  unavailableMetric,
  wilsonInterval,
  type ConfidenceInterval,
  type ForecastMetrics,
  type MetricValue,
  type SelectionMetrics
} from "@/lib/performance/ledgerMetrics";

/**
 * The headline block of the public track record.
 *
 * This composes `ledgerMetrics` rather than re-deriving anything: hit rate,
 * yield, drawdown, average price and every forecast score come back from
 * `computeSelectionMetrics`/`computeForecastMetrics` unchanged, so the track
 * record cannot arrive at a different hit rate from the homepage card or the
 * weekly recap. What is added here is the set of figures a *record* page needs
 * and a single tile does not: cumulative profit in units, the current streak,
 * the drawdown a follower is sitting in right now, closing-line coverage, and
 * the time the last verdict landed.
 *
 * The rules from `ledgerMetrics` carry through unchanged, and one is worth
 * restating because it is the whole reason this module is careful:
 *
 * **Null is not zero, and coverage is not performance.** Closing odds are
 * missing for most publications. The honest report of that is a coverage
 * *count* — "0 of 106 settled picks carry a closing price" — which is a
 * measurement we did make, next to an average CLV of "Not available", which is
 * the measurement we did not. Printing 0.0% CLV would assert that the model
 * beats the close by nothing, which is a claim about the model rather than
 * about our data.
 */

export type StreakSummary = {
  /** The verdict being repeated, or null when nothing is decided. */
  kind: "won" | "lost" | null;
  length: number;
  /** ISO instant of the most recent decided settlement in the streak. */
  since: string | null;
};

export type TrackRecordSummary = {
  availability: DataAvailability;
  unavailableReason: string | null;
  /** True when the underlying sweep stopped at its row cap. */
  truncated: boolean;

  published: number;
  settled: number;
  pending: number;
  won: number;
  lost: number;
  push: number;
  voided: number;
  cancelled: number;
  /** Decided outcomes: the hit-rate and yield denominator. */
  decided: number;

  /** Cumulative one-unit profit and loss, in units staked. */
  profitUnits: MetricValue;
  /** Profit per unit staked. The same number `yieldPerUnit` reports. */
  roi: MetricValue;
  hitRate: MetricValue;
  hitRateInterval: ConfidenceInterval;
  averagePublishedOdds: MetricValue;
  averageClosingOdds: MetricValue;
  /** Share of decided picks that carry a closing price at all. */
  closingCoverage: MetricValue;
  closingCoverageCount: number;
  averageClosingLineValue: MetricValue;

  currentStreak: StreakSummary;
  currentDrawdownUnits: MetricValue;
  maxDrawdownUnits: MetricValue;
  lastSettlementAt: string | null;

  /** The shared calculators' own output, passed through untouched. */
  selection: SelectionMetrics;
  forecast: ForecastMetrics;
  smallSampleWarning: string | null;

  /**
   * Seam for the advanced-analytics module.
   *
   * Deeper statistics — significance against the market, segment-level skill
   * decomposition, calibration-adjusted expected value — are owned elsewhere
   * and are not computed here. A consumer attaches them to this field; every
   * renderer treats it as optional and shows nothing when it is absent, so the
   * page is correct with or without them. See `docs/track-record.md`.
   */
  advanced?: unknown;
};

const CHRONOLOGICAL = (left: OfficialPublicationDetail, right: OfficialPublicationDetail) =>
  Date.parse(left.publishedAt) - Date.parse(right.publishedAt);

/** Rows that were ever a live claim. Retracted means withdrawn, in both directions. */
function scorable(publications: OfficialPublicationDetail[]): OfficialPublicationDetail[] {
  return publications.filter((publication) => publication.publicationStatus !== "retracted");
}

/**
 * One-unit profit on a decided selection.
 *
 * A win returns the stake plus `odds - 1`; a loss costs the one unit. Pushes,
 * voids and cancellations return the stake and so contribute nothing — they
 * are not in `countsTowardRecord` and never reach this function.
 */
function unitReturn(publication: OfficialPublicationDetail): number {
  return publication.settlementStatus === "won" ? publication.oddsAtPublication - 1 : -1;
}

export function publicationUnitReturn(publication: OfficialPublicationDetail): number | null {
  return countsTowardRecord(publication.settlementStatus) ? unitReturn(publication) : null;
}

/** Closing-line value for one row: how much better the published price was. */
export function publicationClosingLineValue(publication: OfficialPublicationDetail): number | null {
  if (!publication.closingOdds || publication.closingOdds <= 1) return null;
  if (!publication.oddsAtPublication || publication.oddsAtPublication <= 1) return null;
  return publication.oddsAtPublication / publication.closingOdds - 1;
}

function averageOf(values: number[]): MetricValue {
  if (!values.length) return notApplicableMetric(0);
  return measuredMetric(values.reduce((sum, value) => sum + value, 0) / values.length, values.length);
}

/**
 * The trailing run of identical verdicts.
 *
 * Ordered by settlement time, not publication time: a streak is what a
 * follower has just watched happen, and two picks published together can
 * settle hours apart.
 */
function computeStreak(decidedRows: OfficialPublicationDetail[]): StreakSummary {
  const ordered = [...decidedRows].sort(
    (left, right) => Date.parse(left.settledAt ?? left.publishedAt) - Date.parse(right.settledAt ?? right.publishedAt)
  );
  const last = ordered[ordered.length - 1];
  if (!last) return { kind: null, length: 0, since: null };

  const kind = last.settlementStatus === "won" ? "won" : "lost";
  let length = 0;
  let since: string | null = null;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const row = ordered[index];
    if ((row.settlementStatus === "won" ? "won" : "lost") !== kind) break;
    length += 1;
    since = row.settledAt ?? row.publishedAt;
  }
  return { kind, length, since };
}

function computeDrawdowns(decidedRows: OfficialPublicationDetail[]): { current: number; max: number } {
  const ordered = [...decidedRows].sort(CHRONOLOGICAL);
  let running = 0;
  let peak = 0;
  let max = 0;
  for (const row of ordered) {
    running += unitReturn(row);
    peak = Math.max(peak, running);
    max = Math.max(max, peak - running);
  }
  return { current: peak - running, max };
}

/**
 * An unreadable ledger produces a summary of nulls, not of zeroes.
 *
 * Counts included: `published: 0` on an unavailable read would be a claim that
 * nothing was published, so the counts are reported as zero only alongside
 * `availability: "unavailable"`, and every renderer is required to branch on
 * availability before printing a count.
 */
export function unavailableTrackRecordSummary(unavailableReason: string | null): TrackRecordSummary {
  const selection = computeSelectionMetrics([], {});
  return {
    availability: "unavailable",
    unavailableReason,
    truncated: false,
    published: 0,
    settled: 0,
    pending: 0,
    won: 0,
    lost: 0,
    push: 0,
    voided: 0,
    cancelled: 0,
    decided: 0,
    profitUnits: unavailableMetric(),
    roi: unavailableMetric(),
    hitRate: unavailableMetric(),
    hitRateInterval: null,
    averagePublishedOdds: unavailableMetric(),
    averageClosingOdds: unavailableMetric(),
    closingCoverage: unavailableMetric(),
    closingCoverageCount: 0,
    averageClosingLineValue: unavailableMetric(),
    currentStreak: { kind: null, length: 0, since: null },
    currentDrawdownUnits: unavailableMetric(),
    maxDrawdownUnits: unavailableMetric(),
    lastSettlementAt: null,
    selection: {
      ...selection,
      hitRate: unavailableMetric(),
      yieldPerUnit: unavailableMetric(),
      averagePublishedOdds: unavailableMetric(),
      maxDrawdownUnits: unavailableMetric()
    },
    forecast: {
      sampleSize: 0,
      brierScore: unavailableMetric(),
      logLoss: unavailableMetric(),
      expectedCalibrationError: unavailableMetric(),
      brierSkill: unavailableMetric(),
      calibrationCurve: []
    },
    smallSampleWarning: null
  };
}

export type TrackRecordSummaryInput = {
  publications: OfficialPublicationDetail[];
  availability: DataAvailability;
  unavailableReason?: string | null;
  truncated?: boolean;
  /** Below this many decided picks a rate is reported as insufficient-sample. */
  minSample?: number;
};

export function computeTrackRecordSummary({
  publications,
  availability,
  unavailableReason = null,
  truncated = false,
  minSample = 0
}: TrackRecordSummaryInput): TrackRecordSummary {
  if (availability === "unavailable") return unavailableTrackRecordSummary(unavailableReason);

  const rows = scorable(publications);
  const selection = computeSelectionMetrics(rows, { minSample });
  const forecast = computeForecastMetrics(rows);

  const tally = (status: string) => rows.filter((row) => row.settlementStatus === status).length;
  const decidedRows = rows.filter((row) => countsTowardRecord(row.settlementStatus));
  const decided = decidedRows.length;
  const pending = tally("unsettled") + tally("pending_verification");

  const profit = decidedRows.reduce((sum, row) => sum + unitReturn(row), 0);
  const drawdowns = computeDrawdowns(decidedRows);

  // Closing prices are read across every scorable row, not just decided ones:
  // a pick can have a closing price and still be waiting on a result, and
  // coverage is a statement about the data we hold.
  const closingRows = rows.filter((row) => row.closingOdds !== null && row.closingOdds > 1);
  const clvValues = rows
    .map((row) => publicationClosingLineValue(row))
    .filter((value): value is number => value !== null);

  const settledTimes = rows
    .map((row) => row.settledAt)
    .filter((value): value is string => Boolean(value))
    .sort();

  const enough = decided >= minSample;
  const rate = (value: number): MetricValue =>
    decided === 0 ? notApplicableMetric(0) : enough ? measuredMetric(value, decided) : insufficientSampleMetric(decided);

  return {
    availability,
    unavailableReason,
    truncated,
    published: rows.length,
    settled: selection.settled,
    pending,
    won: selection.won,
    lost: selection.lost,
    push: tally("push"),
    voided: tally("void"),
    cancelled: tally("cancelled"),
    decided,

    // A sum is a fact about the record at any sample size; a rate derived from
    // it is not. The units figure is therefore measured whenever anything has
    // been decided, and the small-sample warning does the rest of the work.
    profitUnits: decided === 0 ? notApplicableMetric(0) : measuredMetric(profit, decided),
    roi: rate(profit / Math.max(1, decided)),
    hitRate: selection.hitRate,
    hitRateInterval: decided > 0 ? wilsonInterval(selection.won, decided) : null,
    averagePublishedOdds: selection.averagePublishedOdds,
    averageClosingOdds: closingRows.length
      ? averageOf(closingRows.map((row) => row.closingOdds as number))
      : unavailableMetric(),
    // Coverage over the rows that could have carried a close. Zero coverage is
    // a real, reportable measurement — unlike a zero CLV.
    closingCoverage: rows.length ? measuredMetric(closingRows.length / rows.length, rows.length) : notApplicableMetric(0),
    closingCoverageCount: closingRows.length,
    averageClosingLineValue: clvValues.length ? averageOf(clvValues) : unavailableMetric(),

    currentStreak: computeStreak(decidedRows),
    currentDrawdownUnits: decided === 0 ? notApplicableMetric(0) : measuredMetric(drawdowns.current, decided),
    maxDrawdownUnits: selection.maxDrawdownUnits,
    lastSettlementAt: settledTimes.length ? settledTimes[settledTimes.length - 1] : null,

    selection,
    forecast,
    smallSampleWarning:
      decided > 0 && decided < SMALL_SAMPLE_WARNING_THRESHOLD
        ? `These figures come from ${decided} settled pick${decided === 1 ? "" : "s"}. That is too small a sample to distinguish skill from variance — treat it as an early record, not a track record.`
        : null
  };
}

/** Units, signed, with the sign always shown. Null renders as "Not available". */
export function formatUnits(metric: MetricValue): string {
  if (metric.state === "insufficient-sample") return `Insufficient sample (${metric.sampleSize})`;
  if (metric.state === "not-applicable") return "Not applicable";
  if (metric.state === "unavailable" || metric.value === null) return "Not available";
  return `${metric.value >= 0 ? "+" : "−"}${Math.abs(metric.value).toFixed(2)}u`;
}

/** A price. Never rounded to an integer, because 2 and 2.00 read differently. */
export function formatPrice(metric: MetricValue): string {
  if (metric.state === "insufficient-sample") return `Insufficient sample (${metric.sampleSize})`;
  if (metric.state === "not-applicable") return "Not applicable";
  if (metric.state === "unavailable" || metric.value === null) return "Not available";
  return metric.value.toFixed(2);
}

export function describeStreak(streak: StreakSummary): string {
  if (!streak.kind || streak.length === 0) return "No settled picks yet";
  const singular = streak.kind === "won" ? "win" : "loss";
  const plural = streak.kind === "won" ? "wins" : "losses";
  return `${streak.length} ${streak.length === 1 ? singular : plural}`;
}
