import type { OfficialPublicationSummary } from "@/lib/domain/canonicalReads";
import { countsTowardRecord, type DataAvailability, type RecordClass } from "@/lib/domain/states";

/**
 * Every performance number OddsPadi publishes, derived from the publication
 * ledger and nothing else.
 *
 * Two rules run through this module.
 *
 * **Forecast metrics and selection metrics are different things.** Brier
 * score, log loss and calibration error judge a *probability* — they apply to
 * every settled publication regardless of whether backing it would have made
 * money. Hit rate, ROI, closing-line value and drawdown judge a *selection* —
 * they only make sense for a bet at a price. Mixing them lets a well-calibrated
 * model look profitable, or a lucky one look skilful, and the two are
 * routinely conflated in this industry.
 *
 * **A missing number is null, never zero.** An unmeasurable metric returns
 * null with an availability state; a segment below its sample threshold
 * returns `insufficient-sample` rather than a percentage computed from four
 * events. Zero is a measurement, and claiming one we did not make is the
 * specific dishonesty this module exists to prevent.
 */

/** Below this, a segment reports insufficient-sample instead of a rate. */
export const MIN_SEGMENT_SAMPLE = 30;
/** Below this, a headline rate is shown with an explicit small-sample warning. */
export const SMALL_SAMPLE_WARNING_THRESHOLD = 100;
/** Calibration needs enough events per bucket to mean anything. */
export const MIN_CALIBRATION_SAMPLE = 50;

export type MetricValue = {
  value: number | null;
  /** Why the value is null, when it is. */
  state: "measured" | "insufficient-sample" | "not-applicable" | "unavailable";
  sampleSize: number;
};

function measured(value: number, sampleSize: number): MetricValue {
  return { value, state: "measured", sampleSize };
}
function insufficient(sampleSize: number): MetricValue {
  return { value: null, state: "insufficient-sample", sampleSize };
}
function notApplicable(sampleSize = 0): MetricValue {
  return { value: null, state: "not-applicable", sampleSize };
}
export function unavailableMetric(): MetricValue {
  return { value: null, state: "unavailable", sampleSize: 0 };
}

// Exported under explicit names so other surfaces that report a rate — the
// internal model record on the homepage and /track-record — reach the same
// verdict from the same helpers instead of inventing a second convention.
export const measuredMetric = measured;
export const insufficientSampleMetric = insufficient;
export const notApplicableMetric = notApplicable;

/**
 * A rate that refuses to be printed below its sample threshold.
 *
 * `won / decided` is arithmetic; whether that arithmetic means anything is a
 * separate question, and it is the one that matters on a credibility page.
 * Three graded decisions produce a real 100%, and a bare "100%" in a metric
 * tile reads as a performance claim no caption can undo.
 */
export function rateWithMinimumSample(successes: number, decided: number, minSample = MIN_SEGMENT_SAMPLE): MetricValue {
  if (decided <= 0) return notApplicable(0);
  if (decided < minSample) return insufficient(decided);
  return measured(successes / decided, decided);
}

export type ConfidenceInterval = { low: number; high: number; level: number } | null;

/**
 * Wilson score interval.
 *
 * Chosen over the normal approximation deliberately: at the sample sizes a new
 * track record actually has, the normal interval misbehaves badly — it can
 * extend below 0 or above 1, and it collapses to zero width at 0% or 100%,
 * which would let "3 from 3" read as a certainty.
 */
export function wilsonInterval(successes: number, trials: number, z = 1.96): ConfidenceInterval {
  if (trials <= 0) return null;
  const proportion = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const centre = proportion + (z * z) / (2 * trials);
  const spread = z * Math.sqrt((proportion * (1 - proportion)) / trials + (z * z) / (4 * trials * trials));
  return {
    low: Math.max(0, (centre - spread) / denominator),
    high: Math.min(1, (centre + spread) / denominator),
    level: 0.95
  };
}

export type ForecastMetrics = {
  /** Settled publications carrying a usable probability. */
  sampleSize: number;
  brierScore: MetricValue;
  logLoss: MetricValue;
  expectedCalibrationError: MetricValue;
  /** Brier skill against the base rate: positive means better than guessing. */
  brierSkill: MetricValue;
  calibrationCurve: Array<{ bucket: string; predicted: number; actual: number; count: number }>;
};

export type SelectionMetrics = {
  sampleSize: number;
  published: number;
  settled: number;
  won: number;
  lost: number;
  push: number;
  voided: number;
  hitRate: MetricValue;
  hitRateInterval: ConfidenceInterval;
  averagePublishedOdds: MetricValue;
  /**
   * Flat one-unit stake per decided selection, priced at publication.
   * Stated explicitly because "ROI" means three different things in betting.
   */
  yieldPerUnit: MetricValue;
  closingLineValue: MetricValue;
  closingCoverage: MetricValue;
  maxDrawdownUnits: MetricValue;
};

export type SegmentKey = "sport" | "market" | "competition" | "oddsBand" | "modelVersion" | "period";

export type PerformanceSegment = {
  key: SegmentKey;
  label: string;
  selection: SelectionMetrics;
  forecast: ForecastMetrics;
  /** True when the segment is too small to publish rates for. */
  belowThreshold: boolean;
};

export type LedgerPerformance = {
  availability: DataAvailability;
  /** Only ever official_public_pick; kept explicit so a reader can verify. */
  recordClass: RecordClass;
  forecast: ForecastMetrics;
  selection: SelectionMetrics;
  smallSampleWarning: string | null;
  segments: PerformanceSegment[];
};

/** Settled rows a probability can be scored against. */
function scorableForecasts(publications: OfficialPublicationSummary[]) {
  return publications.filter(
    (publication) =>
      publication.publicationStatus !== "retracted" &&
      countsTowardRecord(publication.settlementStatus) &&
      Number.isFinite(publication.modelProbability) &&
      publication.modelProbability > 0 &&
      publication.modelProbability < 1
  );
}

export function computeForecastMetrics(publications: OfficialPublicationSummary[]): ForecastMetrics {
  const rows = scorableForecasts(publications);
  const n = rows.length;
  if (n === 0) {
    return {
      sampleSize: 0,
      brierScore: notApplicable(),
      logLoss: notApplicable(),
      expectedCalibrationError: notApplicable(),
      brierSkill: notApplicable(),
      calibrationCurve: []
    };
  }

  const outcome = (row: OfficialPublicationSummary) => (row.settlementStatus === "won" ? 1 : 0);
  const brier = rows.reduce((sum, row) => sum + (row.modelProbability - outcome(row)) ** 2, 0) / n;

  // Clamped so a confident miss costs a large but finite amount rather than
  // returning Infinity and destroying the whole average.
  const clamp = (value: number) => Math.min(1 - 1e-9, Math.max(1e-9, value));
  const logLoss =
    rows.reduce((sum, row) => sum - Math.log(clamp(outcome(row) === 1 ? row.modelProbability : 1 - row.modelProbability)), 0) / n;

  const baseRate = rows.filter((row) => outcome(row) === 1).length / n;
  const referenceBrier = rows.reduce((sum, row) => sum + (baseRate - outcome(row)) ** 2, 0) / n;
  const skill = referenceBrier > 0 ? 1 - brier / referenceBrier : null;

  const buckets = Array.from({ length: 10 }, (_, index) => {
    const low = index / 10;
    const high = (index + 1) / 10;
    const inBucket = rows.filter((row) => row.modelProbability >= low && (index === 9 ? row.modelProbability <= 1 : row.modelProbability < high));
    if (!inBucket.length) return null;
    return {
      bucket: `${Math.round(low * 100)}–${Math.round(high * 100)}%`,
      predicted: inBucket.reduce((sum, row) => sum + row.modelProbability, 0) / inBucket.length,
      actual: inBucket.filter((row) => outcome(row) === 1).length / inBucket.length,
      count: inBucket.length
    };
  }).filter((bucket): bucket is NonNullable<typeof bucket> => bucket !== null);

  const ece = buckets.reduce((sum, bucket) => sum + (bucket.count / n) * Math.abs(bucket.predicted - bucket.actual), 0);

  return {
    sampleSize: n,
    brierScore: measured(brier, n),
    logLoss: measured(logLoss, n),
    // Calibration error over a handful of events is noise, not a measurement.
    expectedCalibrationError: n >= MIN_CALIBRATION_SAMPLE ? measured(ece, n) : insufficient(n),
    brierSkill: skill === null ? notApplicable(n) : measured(skill, n),
    calibrationCurve: n >= MIN_CALIBRATION_SAMPLE ? buckets : []
  };
}

export function computeSelectionMetrics(
  publications: OfficialPublicationSummary[],
  { minSample = 0 }: { minSample?: number } = {}
): SelectionMetrics {
  const scorable = publications.filter((publication) => publication.publicationStatus !== "retracted");
  const tally = (status: string) => scorable.filter((publication) => publication.settlementStatus === status).length;
  const won = tally("won");
  const lost = tally("lost");
  const decided = won + lost;
  const settled = scorable.filter(
    (publication) => publication.settlementStatus !== "unsettled" && publication.settlementStatus !== "pending_verification"
  ).length;

  const decidedRows = scorable.filter((publication) => countsTowardRecord(publication.settlementStatus));
  const returns = decidedRows.reduce(
    (sum, row) => sum + (row.settlementStatus === "won" ? row.oddsAtPublication : 0),
    0
  );

  // Running one-unit-per-selection bankroll, in publication order, so the
  // drawdown is the worst peak-to-trough a follower would actually have felt.
  const ordered = [...decidedRows].sort((left, right) => Date.parse(left.publishedAt) - Date.parse(right.publishedAt));
  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const row of ordered) {
    running += row.settlementStatus === "won" ? row.oddsAtPublication - 1 : -1;
    peak = Math.max(peak, running);
    maxDrawdown = Math.max(maxDrawdown, peak - running);
  }

  const enough = decided >= minSample;
  const oddsRows = scorable.filter((publication) => publication.oddsAtPublication > 1);

  return {
    sampleSize: decided,
    published: scorable.length,
    settled,
    won,
    lost,
    push: tally("push"),
    voided: tally("void") + tally("cancelled"),
    hitRate: decided === 0 ? notApplicable(0) : enough ? measured(won / decided, decided) : insufficient(decided),
    hitRateInterval: decided > 0 && enough ? wilsonInterval(won, decided) : null,
    averagePublishedOdds: oddsRows.length
      ? measured(oddsRows.reduce((sum, row) => sum + row.oddsAtPublication, 0) / oddsRows.length, oddsRows.length)
      : notApplicable(0),
    yieldPerUnit: decided === 0 ? notApplicable(0) : enough ? measured((returns - decided) / decided, decided) : insufficient(decided),
    // Closing-line value needs closing prices, which the ledger summary does
    // not carry; reported unavailable rather than silently omitted.
    closingLineValue: unavailableMetric(),
    closingCoverage: unavailableMetric(),
    maxDrawdownUnits: ordered.length ? measured(maxDrawdown, ordered.length) : notApplicable(0)
  };
}

/**
 * Price buckets, defined once.
 *
 * The segment table and the track-record filter both bucket by price, and if
 * they used different edges a reader could filter to "2.00–2.99" and get a
 * different sample from the segment row of the same name. Both now read this
 * list; the `id` is what a URL carries, the `label` is what a page prints.
 */
export const ODDS_BANDS = [
  { id: "under-1-50", label: "Under 1.50", min: 0, max: 1.5 },
  { id: "1-50-1-99", label: "1.50–1.99", min: 1.5, max: 2 },
  { id: "2-00-2-99", label: "2.00–2.99", min: 2, max: 3 },
  { id: "3-00-4-99", label: "3.00–4.99", min: 3, max: 5 },
  { id: "5-00-plus", label: "5.00+", min: 5, max: Number.POSITIVE_INFINITY }
] as const;

export type OddsBand = (typeof ODDS_BANDS)[number];

export function oddsBandFor(odds: number): OddsBand {
  return ODDS_BANDS.find((band) => odds < band.max) ?? ODDS_BANDS[ODDS_BANDS.length - 1];
}

function oddsBand(odds: number): string {
  return oddsBandFor(odds).label;
}

function segmentValue(publication: OfficialPublicationSummary, key: SegmentKey): string {
  if (key === "sport") return publication.sport;
  if (key === "market") return publication.market.replaceAll("_", " ");
  if (key === "competition") return publication.competition;
  if (key === "oddsBand") return oddsBand(publication.oddsAtPublication);
  if (key === "period") return publication.kickoffAt.slice(0, 7);
  return "current";
}

export function computeSegments(
  publications: OfficialPublicationSummary[],
  keys: SegmentKey[] = ["sport", "market", "competition", "oddsBand", "period"]
): PerformanceSegment[] {
  const segments: PerformanceSegment[] = [];
  for (const key of keys) {
    const groups = new Map<string, OfficialPublicationSummary[]>();
    for (const publication of publications) {
      const label = segmentValue(publication, key);
      groups.set(label, [...(groups.get(label) ?? []), publication]);
    }
    for (const [label, rows] of [...groups.entries()].sort()) {
      const selection = computeSelectionMetrics(rows, { minSample: MIN_SEGMENT_SAMPLE });
      segments.push({
        key,
        label,
        selection,
        forecast: computeForecastMetrics(rows),
        belowThreshold: selection.sampleSize < MIN_SEGMENT_SAMPLE
      });
    }
  }
  return segments;
}

export function computeLedgerPerformance(
  publications: OfficialPublicationSummary[],
  availability: DataAvailability
): LedgerPerformance {
  // An unreadable ledger yields no metrics at all — not zeroed ones.
  if (availability === "unavailable") {
    const empty = computeSelectionMetrics([], {});
    return {
      availability,
      recordClass: "official_public_pick",
      forecast: {
        sampleSize: 0,
        brierScore: unavailableMetric(),
        logLoss: unavailableMetric(),
        expectedCalibrationError: unavailableMetric(),
        brierSkill: unavailableMetric(),
        calibrationCurve: []
      },
      selection: {
        ...empty,
        hitRate: unavailableMetric(),
        yieldPerUnit: unavailableMetric(),
        averagePublishedOdds: unavailableMetric(),
        maxDrawdownUnits: unavailableMetric()
      },
      smallSampleWarning: null,
      segments: []
    };
  }

  const selection = computeSelectionMetrics(publications);
  const forecast = computeForecastMetrics(publications);
  const smallSampleWarning =
    selection.sampleSize > 0 && selection.sampleSize < SMALL_SAMPLE_WARNING_THRESHOLD
      ? `These figures come from ${selection.sampleSize} settled pick${selection.sampleSize === 1 ? "" : "s"}. That is too small a sample to distinguish skill from variance — treat it as an early record, not a track record.`
      : null;

  return {
    availability,
    recordClass: "official_public_pick",
    forecast,
    selection,
    smallSampleWarning,
    segments: computeSegments(publications)
  };
}

/**
 * Hit-rate label for the internal model record.
 *
 * Shared by the homepage card and /track-record so the two surfaces cannot
 * disagree, and so neither can fall back to printing a percentage the sample
 * does not support.
 */
export function formatRecordHitRate(metric: MetricValue): string {
  return metric.value === null ? "Not enough settled decisions yet" : formatMetric(metric, "percent");
}

/** Format a metric for display without ever inventing a number. */
export function formatMetric(metric: MetricValue, kind: "percent" | "decimal" | "signed-percent" | "units"): string {
  if (metric.state === "insufficient-sample") return `Insufficient sample (${metric.sampleSize})`;
  if (metric.state === "not-applicable") return "Not applicable";
  if (metric.state === "unavailable" || metric.value === null) return "Not available";
  if (kind === "percent") return `${(metric.value * 100).toFixed(1)}%`;
  if (kind === "signed-percent") return `${metric.value >= 0 ? "+" : ""}${(metric.value * 100).toFixed(1)}%`;
  if (kind === "units") return `${metric.value.toFixed(2)}u`;
  return metric.value.toFixed(4);
}
