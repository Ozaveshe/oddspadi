import type { OfficialPublicationSummary } from "@/lib/domain/canonicalReads";
import { countsTowardRecord, type DecisionStatus } from "@/lib/domain/states";
import {
  MIN_CALIBRATION_SAMPLE,
  MIN_SEGMENT_SAMPLE,
  insufficientSampleMetric,
  measuredMetric,
  notApplicableMetric,
  unavailableMetric,
  wilsonInterval,
  type ConfidenceInterval,
  type MetricValue
} from "@/lib/performance/ledgerMetrics";

/**
 * Advanced performance analytics — the maths, and nothing else.
 *
 * This module is pure. It performs no I/O, reads no clock, touches no
 * environment and holds no state. Every function takes rows in and returns
 * numbers out, and every function that depends on the present takes `now` as
 * an argument. That is what makes these figures reproducible: given the same
 * ledger rows and the same `now`, every number here is the same number
 * forever, which is the minimum bar for a metric anyone is going to quote in
 * public.
 *
 * Three rules run through the whole file.
 *
 * **1. Null, never zero.** A Brier score of 0 is a perfect model. A Brier
 * score of unknown is unknown. Returning 0 for "we could not compute this"
 * turns an absence of evidence into the strongest possible claim, in the
 * wrong direction, silently. Every metric here returns a `MetricValue` whose
 * `value` is `null` with a `state` explaining why, or a real number. There is
 * no third option and there is no default.
 *
 * **2. Sample thresholds are enforced here, not by the caller.** A surface
 * that has to remember to check `n` before printing a percentage will one day
 * forget, and the failure mode is a "100% win rate" tile backed by three
 * decisions. Below threshold these functions return
 * `state: "insufficient-sample"` carrying both the actual `sampleSize` and the
 * `requiredSample`, so a surface can say *which* — "12 of the 30 needed" reads
 * as candour, where a bare "—" reads as a bug.
 *
 * **3. Void and push are not results.** A push returned the stake; a void
 * never ran. Counting either as a played selection misstates the record in
 * both directions at once — it dilutes a good record and flatters a bad one.
 * `countsTowardRecord` in `@/lib/domain/states` is the single definition and
 * this module never re-derives it.
 *
 * Thresholds reuse `MIN_SEGMENT_SAMPLE` and `MIN_CALIBRATION_SAMPLE` from
 * `./ledgerMetrics` rather than inventing a parallel set. Where this module
 * needs a bar that module does not define, the new constant is declared below
 * with its justification, and `docs/performance-sample-policy.md` states
 * plainly which of them are derived and which are policy.
 *
 * @see docs/performance-metrics.md — every formula, domain, range and null condition.
 * @see docs/performance-sample-policy.md — every threshold and why it is that number.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * A ledger row plus the two optional columns the summary read does not carry.
 *
 * Declared as an intersection rather than by widening
 * `OfficialPublicationSummary` so the canonical read contract stays owned by
 * one module. A caller that has closing prices or model versions to hand
 * supplies them; a caller that does not gets honest `unavailable` results
 * instead of a fabricated zero.
 */
export type AdvancedPerformanceRecord = OfficialPublicationSummary & {
  /**
   * The engine build that produced the probability. `op_publications` stores
   * this as `model_version`. Absent or null groups under `UNVERSIONED_LABEL`.
   */
  modelVersion?: string | null;
  /**
   * Decimal odds for the same selection at market close. Sparse by nature —
   * closing prices are captured by a separate job that does not always win the
   * race with kickoff — so every CLV figure in this module is reported with
   * its coverage attached.
   */
  closingOdds?: number | null;
};

/**
 * One market the engine looked at, whether or not anything was published.
 *
 * Coverage and abstention are properties of the *decision* population, not the
 * publication population: a ledger of publications cannot tell you how often
 * the engine declined, because declining leaves no publication behind. This is
 * the shape that can answer it.
 */
export type DecisionObservation = {
  fixtureId: string;
  market: string;
  decisionStatus: DecisionStatus;
  /** True when this decision reached the official ledger. */
  published: boolean;
};

/** Injected clock. Never read from `Date.now()` inside this module. */
export type ClockOptions = { now: Date };

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Operational timings — lead time, settlement latency — use a lower bar than
 * performance claims.
 *
 * The distinction is real rather than convenient. A hit rate estimates an
 * unknown parameter of the world and needs enough events to separate skill
 * from variance. Publication lead time measures a process we own and control;
 * its spread is narrow and its median is stable almost immediately. Ten is
 * still a policy number, not a derived one — it is set where a median stops
 * being decided by a single row.
 */
export const MIN_OPERATIONAL_SAMPLE = 10;

/**
 * Per-bucket bar for a reliability curve point.
 *
 * A calibration curve is a set of independent proportion estimates, one per
 * bucket, so each point needs what any published proportion needs. Reusing
 * `MIN_SEGMENT_SAMPLE` keeps one bar across the codebase; the consequence is
 * that a fully populated ten-bucket curve wants roughly 300 graded decisions,
 * and until then individual points report as unknown rather than as noise
 * drawn at full opacity.
 */
export const MIN_RELIABILITY_BUCKET_SAMPLE = MIN_SEGMENT_SAMPLE;

/** Default number of equal-width probability buckets for calibration work. */
export const DEFAULT_CALIBRATION_BUCKETS = 10;

/** Model version label for rows that carry none. */
export const UNVERSIONED_LABEL = "unversioned";

/**
 * Log-loss clamp. Matches `ledgerMetrics` so the two modules cannot disagree
 * about the same picks. `op_publications` constrains probability to the open
 * interval (0, 1), so this only ever binds on data that has bypassed the
 * database — but an `Infinity` that destroys a whole average is worth ruling
 * out structurally rather than trusting a constraint two systems away.
 */
const LOG_LOSS_EPSILON = 1e-9;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Metric envelope
// ---------------------------------------------------------------------------

/**
 * A `MetricValue` that also states the bar it was judged against.
 *
 * Structurally a `MetricValue`, so anything that already renders one renders
 * this. The extra field exists so an insufficient-sample result can say "12 of
 * 30" instead of leaving a surface to guess, or worse, to hardcode the bar a
 * second time.
 */
export type SampledMetric = MetricValue & { requiredSample: number };

/**
 * Build a `SampledMetric`, enforcing the threshold before `compute` runs.
 *
 * `compute` is a thunk on purpose: below threshold the arithmetic is not just
 * unpublishable, it is meaningless, and not running it removes any chance of a
 * refactor later reading `.value` off a result that should have been withheld.
 */
export function sampledMetric(compute: () => number | null, sampleSize: number, requiredSample: number): SampledMetric {
  if (sampleSize <= 0) return { ...notApplicableMetric(0), requiredSample };
  if (sampleSize < requiredSample) return { ...insufficientSampleMetric(sampleSize), requiredSample };
  const value = compute();
  if (value === null || !Number.isFinite(value)) return { ...notApplicableMetric(sampleSize), requiredSample };
  return { ...measuredMetric(value, sampleSize), requiredSample };
}

/** A metric we could not compute at all, e.g. no closing prices exist. */
export function unavailableSampledMetric(requiredSample = 0): SampledMetric {
  return { ...unavailableMetric(), requiredSample };
}

/**
 * Sentence a surface can print verbatim when a metric is withheld.
 *
 * Returns null for a measured metric. Naming the shortfall — rather than
 * showing an em dash — is the difference between a record that looks broken
 * and one that looks early.
 */
export function describeSampleShortfall(metric: SampledMetric): string | null {
  if (metric.state === "insufficient-sample") {
    return `Not enough settled decisions yet: ${metric.sampleSize} of the ${metric.requiredSample} needed.`;
  }
  if (metric.state === "not-applicable") return "Not applicable to this set.";
  if (metric.state === "unavailable") return "The inputs for this measurement are missing.";
  return null;
}

// ---------------------------------------------------------------------------
// Accessible chart shapes
// ---------------------------------------------------------------------------

/**
 * Non-colour encodings a renderer can use to tell series apart.
 *
 * Returned as data rather than left to the component because the data shape
 * decides whether an accessible chart is even possible. A series identified
 * only by a colour key forces every downstream renderer into a colour-only
 * legend; carrying a dash pattern, a marker and a text summary means the same
 * series is distinguishable in greyscale, at 200% zoom, and read aloud.
 */
export type SeriesPattern = "solid" | "dashed" | "dotted" | "dash-dot";
export type SeriesMarker = "circle" | "square" | "triangle" | "diamond" | "cross";

export type ChartPoint = {
  /** Machine-sortable key: ISO date, bucket index, or version name. */
  x: string;
  /** Human label for the axis tick and the table fallback. */
  xLabel: string;
  /** Null wherever the metric was withheld. Never substituted with zero. */
  y: number | null;
  /** Full sentence for a screen reader or a data-table cell. */
  label: string;
  sampleSize: number;
};

export type ChartSeries = {
  id: string;
  label: string;
  pattern: SeriesPattern;
  marker: SeriesMarker;
  /** One-sentence description of the whole series, for `aria-label`. */
  summary: string;
  points: ChartPoint[];
};

// ---------------------------------------------------------------------------
// Row selection
// ---------------------------------------------------------------------------

/**
 * Rows that may enter any public figure.
 *
 * Retracted publications are excluded and nothing else is: this matches
 * `ledgerMetrics.computeSelectionMetrics` exactly, so the advanced page and the
 * headline tiles cannot count different populations. Drafts are *not* filtered
 * here even though a draft is not public, because `op_publish_pick` only ever
 * writes `published` rows; if that ever changes, both modules must change
 * together, and this comment is the note that says so.
 */
export function eligibleRecords<T extends OfficialPublicationSummary>(records: T[]): T[] {
  return records.filter((record) => record.publicationStatus !== "retracted");
}

/** Eligible rows with a decided outcome — won or lost, never push or void. */
export function decidedRecords<T extends OfficialPublicationSummary>(records: T[]): T[] {
  return eligibleRecords(records).filter((record) => countsTowardRecord(record.settlementStatus));
}

/** Decided rows whose probability can actually be scored. */
export function scorableRecords<T extends OfficialPublicationSummary>(records: T[]): T[] {
  return decidedRecords(records).filter(
    (record) =>
      Number.isFinite(record.modelProbability) && record.modelProbability > 0 && record.modelProbability < 1
  );
}

/** 1 for a win, 0 for a loss. Only ever called on decided rows. */
function outcome(record: OfficialPublicationSummary): 0 | 1 {
  return record.settlementStatus === "won" ? 1 : 0;
}

/** Profit in units from a one-unit stake: `odds − 1` on a win, `−1` on a loss. */
export function unitReturn(record: OfficialPublicationSummary): number {
  return record.settlementStatus === "won" ? record.oddsAtPublication - 1 : -1;
}

function chronologically<T extends OfficialPublicationSummary>(records: T[]): T[] {
  return [...records].sort((left, right) => {
    const delta = Date.parse(left.publishedAt) - Date.parse(right.publishedAt);
    // Publications inside the same batch share a timestamp; the id keeps the
    // order total so a streak or a drawdown is reproducible run to run.
    return delta !== 0 ? delta : left.publicationId.localeCompare(right.publicationId);
  });
}

// ---------------------------------------------------------------------------
// Small statistics helpers
// ---------------------------------------------------------------------------

/** Arithmetic mean. Null on an empty set — a mean of nothing is not zero. */
export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Quantile by linear interpolation between closest ranks (the R type-7 /
 * Excel `PERCENTILE.INC` definition), so a hand-computed expected value in a
 * test matches what a reader would get from a spreadsheet.
 *
 * `q` is clamped to [0, 1]. Null on an empty set.
 */
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const clamped = Math.min(1, Math.max(0, q));
  const index = (sorted.length - 1) * clamped;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (index - lower) * (sorted[upper] - sorted[lower]);
}

export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

/**
 * Sample standard deviation, Bessel-corrected (`n − 1` denominator).
 *
 * Null below two observations: one observation has no spread, and reporting 0
 * would claim a certainty the single data point cannot support. This is the
 * null-not-zero rule at its least ambiguous.
 */
export function sampleStandardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values) as number;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Normal-approximation interval for a mean: `x̄ ± z · s / √n`.
 *
 * Used for continuous quantities — unit returns, CLV — where the Wilson
 * interval does not apply because the variable is not a proportion. Null below
 * two observations, since the standard deviation is.
 */
export function meanConfidenceInterval(values: number[], z = 1.96): ConfidenceInterval {
  const deviation = sampleStandardDeviation(values);
  const average = mean(values);
  if (deviation === null || average === null) return null;
  const halfWidth = (z * deviation) / Math.sqrt(values.length);
  return { low: average - halfWidth, high: average + halfWidth, level: 0.95 };
}

// ---------------------------------------------------------------------------
// Forecast scoring
// ---------------------------------------------------------------------------

/**
 * Brier score: `BS = (1/n) · Σ (pᵢ − oᵢ)²`.
 *
 * - Domain: `pᵢ ∈ (0, 1)`, `oᵢ ∈ {0, 1}`.
 * - Range: `[0, 1]`. Lower is better; 0 is a perfect forecaster.
 * - Denominator: decided publications (won or lost) with a usable
 *   probability. Push, void, cancelled and unsettled are excluded.
 * - Null when: nothing is decided, or fewer than `minSample` decisions exist.
 *
 * Thresholded at `MIN_SEGMENT_SAMPLE` deliberately, and that is stricter than
 * `ledgerMetrics.computeForecastMetrics`, which reports a Brier score from any
 * non-empty set. The looser rule is defensible for an internal diagnostic;
 * for a figure that will be quoted as evidence of skill it is not, because the
 * standard error of a Brier score over a handful of picks is wider than the
 * entire distance between a good model and a coin.
 */
export function brierScore(records: AdvancedPerformanceRecord[], minSample = MIN_SEGMENT_SAMPLE): SampledMetric {
  const rows = scorableRecords(records);
  return sampledMetric(
    () => rows.reduce((sum, row) => sum + (row.modelProbability - outcome(row)) ** 2, 0) / rows.length,
    rows.length,
    minSample
  );
}

/**
 * Logarithmic loss: `LL = −(1/n) · Σ [oᵢ·ln(pᵢ) + (1 − oᵢ)·ln(1 − pᵢ)]`.
 *
 * - Domain: `pᵢ ∈ (0, 1)` clamped to `[ε, 1 − ε]` with `ε = 1e-9`.
 * - Range: `[0, ∞)`. Lower is better. `ln(2) ≈ 0.6931` is the score of always
 *   predicting 50%, which is the number to beat before claiming anything.
 * - Denominator: as Brier — decided rows with a usable probability.
 * - Null when: below `minSample`.
 *
 * Log loss punishes confident errors far harder than Brier does, which is
 * exactly why both are reported: a model can hold a respectable Brier score
 * while occasionally being certain and wrong, and only log loss says so.
 */
export function logLoss(records: AdvancedPerformanceRecord[], minSample = MIN_SEGMENT_SAMPLE): SampledMetric {
  const rows = scorableRecords(records);
  const clamp = (value: number) => Math.min(1 - LOG_LOSS_EPSILON, Math.max(LOG_LOSS_EPSILON, value));
  return sampledMetric(
    () =>
      rows.reduce((sum, row) => {
        const probabilityOfWhatHappened = outcome(row) === 1 ? row.modelProbability : 1 - row.modelProbability;
        return sum - Math.log(clamp(probabilityOfWhatHappened));
      }, 0) / rows.length,
    rows.length,
    minSample
  );
}

/**
 * Brier skill score against the observed base rate:
 * `BSS = 1 − BS_model / BS_baseline`, where the baseline predicts the sample's
 * own win rate for every pick.
 *
 * - Range: `(−∞, 1]`. Positive means better than predicting the base rate.
 * - Null when: below threshold, or the baseline Brier is 0 — which happens
 *   when every decided pick went the same way, and against a set that is all
 *   wins or all losses "skill" has no meaning to measure.
 *
 * The reference is the *observed* base rate rather than 0.5, which makes this
 * a harder test than it looks: a model only scores above zero by beating a
 * forecaster who already knows the answer's long-run frequency.
 */
export function brierSkillScore(records: AdvancedPerformanceRecord[], minSample = MIN_SEGMENT_SAMPLE): SampledMetric {
  const rows = scorableRecords(records);
  return sampledMetric(
    () => {
      const baseRate = rows.filter((row) => outcome(row) === 1).length / rows.length;
      const reference = rows.reduce((sum, row) => sum + (baseRate - outcome(row)) ** 2, 0) / rows.length;
      if (reference === 0) return null;
      const model = rows.reduce((sum, row) => sum + (row.modelProbability - outcome(row)) ** 2, 0) / rows.length;
      return 1 - model / reference;
    },
    rows.length,
    minSample
  );
}

export type ReliabilityBucket = {
  index: number;
  /** Inclusive lower bound of the probability bucket. */
  lowerBound: number;
  /** Exclusive upper bound, except for the final bucket which includes 1. */
  upperBound: number;
  label: string;
  /** Mean forecast probability of the rows in the bucket. Null when empty. */
  predicted: number | null;
  /** Observed win frequency. Null below `MIN_RELIABILITY_BUCKET_SAMPLE`. */
  observed: number | null;
  /** Wilson interval on `observed`, null whenever `observed` is. */
  observedInterval: ConfidenceInterval;
  count: number;
  /** Share of the scored population in this bucket. */
  share: number;
  /** True when the bucket cleared its own sample bar. */
  reliable: boolean;
};

export type ReliabilityCurve = {
  buckets: ReliabilityBucket[];
  sampleSize: number;
  requiredSample: number;
  /**
   * Curve-level state. `insufficient-sample` means the whole curve is below
   * `MIN_CALIBRATION_SAMPLE` and no point on it should be drawn.
   */
  state: MetricValue["state"];
  /** Chart-ready and colour-independent: the diagonal plus the observed line. */
  series: ChartSeries[];
};

/**
 * Reliability curve — observed win frequency against forecast probability,
 * bucketed into equal-width bins.
 *
 * For bucket `b`: `predicted_b = mean(pᵢ | i ∈ b)` and
 * `observed_b = (Σ oᵢ | i ∈ b) / n_b`. A perfectly calibrated forecaster
 * produces `observed_b ≈ predicted_b` for every `b`: the points lie on the
 * diagonal.
 *
 * - Range: both axes `[0, 1]`.
 * - Buckets are `[b/k, (b+1)/k)` with the final bucket closed at 1, so a
 *   probability of exactly 1 has somewhere to go.
 * - Curve null (`state: "insufficient-sample"`, no series) below
 *   `MIN_CALIBRATION_SAMPLE` scored rows.
 * - Individual `observed` values null below `MIN_RELIABILITY_BUCKET_SAMPLE`
 *   in that bucket. `predicted` is still reported, because the mean of the
 *   forecasts we made is a fact about our own output, not an estimate of the
 *   world.
 *
 * The returned series carry dash patterns, markers and text summaries so the
 * curve can be read without distinguishing the diagonal from the data by hue.
 */
export function reliabilityCurve(
  records: AdvancedPerformanceRecord[],
  {
    buckets = DEFAULT_CALIBRATION_BUCKETS,
    minSample = MIN_CALIBRATION_SAMPLE,
    minBucketSample = MIN_RELIABILITY_BUCKET_SAMPLE
  }: { buckets?: number; minSample?: number; minBucketSample?: number } = {}
): ReliabilityCurve {
  const rows = scorableRecords(records);
  const n = rows.length;
  const bucketCount = Math.max(1, Math.floor(buckets));

  if (n === 0 || n < minSample) {
    return {
      buckets: [],
      sampleSize: n,
      requiredSample: minSample,
      state: n === 0 ? "not-applicable" : "insufficient-sample",
      series: []
    };
  }

  const shaped: ReliabilityBucket[] = [];
  for (let index = 0; index < bucketCount; index += 1) {
    const lowerBound = index / bucketCount;
    const upperBound = (index + 1) / bucketCount;
    const isLast = index === bucketCount - 1;
    const inBucket = rows.filter((row) =>
      isLast
        ? row.modelProbability >= lowerBound && row.modelProbability <= 1
        : row.modelProbability >= lowerBound && row.modelProbability < upperBound
    );
    const count = inBucket.length;
    const wins = inBucket.filter((row) => outcome(row) === 1).length;
    const reliable = count >= minBucketSample;
    shaped.push({
      index,
      lowerBound,
      upperBound,
      label: `${Math.round(lowerBound * 100)}–${Math.round(upperBound * 100)}%`,
      predicted: count ? inBucket.reduce((sum, row) => sum + row.modelProbability, 0) / count : null,
      observed: reliable ? wins / count : null,
      observedInterval: reliable ? wilsonInterval(wins, count) : null,
      count,
      share: count / n,
      reliable
    });
  }

  const populated = shaped.filter((bucket) => bucket.count > 0);
  const drawn = shaped.filter((bucket) => bucket.reliable);
  const series: ChartSeries[] = [
    {
      id: "perfect-calibration",
      label: "Perfect calibration",
      pattern: "dashed",
      marker: "cross",
      summary: "Reference line where forecast probability equals observed frequency.",
      points: populated.map((bucket) => ({
        x: String(bucket.index),
        xLabel: bucket.label,
        y: bucket.predicted,
        label: `${bucket.label}: a perfectly calibrated forecast would win ${formatPercent(bucket.predicted)} of the time.`,
        sampleSize: bucket.count
      }))
    },
    {
      id: "observed-frequency",
      label: "Observed frequency",
      pattern: "solid",
      marker: "circle",
      summary:
        drawn.length > 0
          ? `Observed win frequency across ${drawn.length} probability band${drawn.length === 1 ? "" : "s"} with enough settled decisions to measure.`
          : "No probability band yet holds enough settled decisions to measure.",
      points: populated.map((bucket) => ({
        x: String(bucket.index),
        xLabel: bucket.label,
        y: bucket.observed,
        label: bucket.reliable
          ? `${bucket.label}: forecast ${formatPercent(bucket.predicted)}, actually won ${formatPercent(bucket.observed)} of ${bucket.count}.`
          : `${bucket.label}: ${bucket.count} of the ${minBucketSample} settled decisions needed before this band can be measured.`,
        sampleSize: bucket.count
      }))
    }
  ];

  return { buckets: shaped, sampleSize: n, requiredSample: minSample, state: "measured", series };
}

/**
 * Expected calibration error:
 * `ECE = Σ_b (n_b / n) · |predicted_b − observed_b|`.
 *
 * - Range: `[0, 1]`. 0 is perfect calibration.
 * - Denominator: every scored row; each bucket contributes in proportion to
 *   its own population, so a band holding three picks cannot swing the number.
 * - Null when: below `MIN_CALIBRATION_SAMPLE`.
 *
 * Note that ECE is computed over *all* populated buckets, including those too
 * small to publish as individual curve points. Dropping small buckets from the
 * sum would bias the error downwards by discarding exactly the regions where
 * the model is least tested, so the aggregate uses everything and the curve
 * withholds the points a reader would over-interpret.
 */
export function expectedCalibrationError(
  records: AdvancedPerformanceRecord[],
  { buckets = DEFAULT_CALIBRATION_BUCKETS, minSample = MIN_CALIBRATION_SAMPLE }: { buckets?: number; minSample?: number } = {}
): SampledMetric {
  const rows = scorableRecords(records);
  const bucketCount = Math.max(1, Math.floor(buckets));
  return sampledMetric(
    () => {
      const n = rows.length;
      let error = 0;
      for (let index = 0; index < bucketCount; index += 1) {
        const lowerBound = index / bucketCount;
        const upperBound = (index + 1) / bucketCount;
        const isLast = index === bucketCount - 1;
        const inBucket = rows.filter((row) =>
          isLast
            ? row.modelProbability >= lowerBound && row.modelProbability <= 1
            : row.modelProbability >= lowerBound && row.modelProbability < upperBound
        );
        if (!inBucket.length) continue;
        const predicted = inBucket.reduce((sum, row) => sum + row.modelProbability, 0) / inBucket.length;
        const observed = inBucket.filter((row) => outcome(row) === 1).length / inBucket.length;
        error += (inBucket.length / n) * Math.abs(predicted - observed);
      }
      return error;
    },
    rows.length,
    minSample
  );
}

export type ExpectedVersusActual = {
  /** `Σ pᵢ` — wins the model said to expect. Null when nothing is decided. */
  expectedWins: number | null;
  /** `Σ oᵢ` — wins that happened. */
  actualWins: number | null;
  /** `actual − expected`. Positive means the model under-claimed. */
  difference: number | null;
  /**
   * `(actual − expected) / √(Σ pᵢ(1 − pᵢ))` — the Poisson-binomial z-score.
   * Roughly, |z| above 2 is a gap variance struggles to explain.
   */
  zScore: number | null;
  /** 95% interval on the expected count: `Σpᵢ ± 1.96·√(Σ pᵢ(1 − pᵢ))`. */
  expectedInterval: ConfidenceInterval;
  /** True when `actualWins` falls outside `expectedInterval`. */
  outsideExpectation: boolean;
  sampleSize: number;
  requiredSample: number;
  state: MetricValue["state"];
};

/**
 * Expected wins against actual wins — the most direct calibration statement
 * there is, and the one a non-specialist reads fastest.
 *
 * `expected = Σ pᵢ` over decided picks; `actual = Σ oᵢ`. Because each pick is
 * an independent Bernoulli trial with its own probability, the count of wins
 * is Poisson-binomial with variance `Σ pᵢ(1 − pᵢ)`, and that gives both the
 * z-score and the interval without any normal approximation on the
 * probabilities themselves.
 *
 * - Range: counts in `[0, n]`; z-score real.
 * - Null when: below `MIN_SEGMENT_SAMPLE`, or the variance is 0 (every
 *   probability is degenerate, which the ledger's own constraint prevents).
 */
export function expectedVersusActualWins(
  records: AdvancedPerformanceRecord[],
  minSample = MIN_SEGMENT_SAMPLE
): ExpectedVersusActual {
  const rows = scorableRecords(records);
  const n = rows.length;
  const empty: ExpectedVersusActual = {
    expectedWins: null,
    actualWins: null,
    difference: null,
    zScore: null,
    expectedInterval: null,
    outsideExpectation: false,
    sampleSize: n,
    requiredSample: minSample,
    state: n === 0 ? "not-applicable" : "insufficient-sample"
  };
  if (n === 0 || n < minSample) return empty;

  const expected = rows.reduce((sum, row) => sum + row.modelProbability, 0);
  const actual = rows.filter((row) => outcome(row) === 1).length;
  const variance = rows.reduce((sum, row) => sum + row.modelProbability * (1 - row.modelProbability), 0);
  const deviation = Math.sqrt(variance);
  const interval: ConfidenceInterval =
    deviation > 0 ? { low: expected - 1.96 * deviation, high: expected + 1.96 * deviation, level: 0.95 } : null;

  return {
    expectedWins: expected,
    actualWins: actual,
    difference: actual - expected,
    zScore: deviation > 0 ? (actual - expected) / deviation : null,
    expectedInterval: interval,
    outsideExpectation: interval ? actual < interval.low || actual > interval.high : false,
    sampleSize: n,
    requiredSample: minSample,
    state: "measured"
  };
}

// ---------------------------------------------------------------------------
// Selection economics
// ---------------------------------------------------------------------------

/**
 * Hit rate: `wins / (wins + losses)`.
 *
 * - Range: `[0, 1]`.
 * - Denominator: decided rows only. Push and void are excluded — a push
 *   returned the stake and a void never ran, so neither is a selection that
 *   was played and lost, nor one that was played and won.
 * - Null when: below `MIN_SEGMENT_SAMPLE`.
 */
export function hitRate(records: AdvancedPerformanceRecord[], minSample = MIN_SEGMENT_SAMPLE): SampledMetric {
  const rows = decidedRecords(records);
  return sampledMetric(() => rows.filter((row) => outcome(row) === 1).length / rows.length, rows.length, minSample);
}

/**
 * Return on investment at a flat one-unit stake:
 * `ROI = (Σ (oddsᵢ · oᵢ) − n) / n`, equivalently `mean(unit return)`.
 *
 * - Range: `[−1, ∞)`. −1 is every pick losing; 0 is breaking even.
 * - Priced at publication, never at the closing line: this is the return a
 *   follower who acted on the published pick at the published price would have
 *   seen, which is the only ROI we are entitled to claim.
 * - Denominator: decided rows.
 * - Null when: below `MIN_SEGMENT_SAMPLE`.
 */
export function returnOnInvestment(records: AdvancedPerformanceRecord[], minSample = MIN_SEGMENT_SAMPLE): SampledMetric {
  const rows = decidedRecords(records);
  return sampledMetric(() => mean(rows.map(unitReturn)), rows.length, minSample);
}

export type ReturnDistributionBand = {
  id: string;
  label: string;
  /** Inclusive lower bound in units of profit. */
  from: number;
  /** Exclusive upper bound; `null` means unbounded. */
  to: number | null;
  count: number;
  share: number;
  /** Hatch pattern so bands are distinguishable without colour. */
  pattern: SeriesPattern;
};

export type ReturnDistribution = {
  sampleSize: number;
  requiredSample: number;
  state: MetricValue["state"];
  meanReturn: SampledMetric;
  medianReturn: SampledMetric;
  /** Sample standard deviation of unit returns — see `returnVolatility`. */
  volatility: SampledMetric;
  /** `mean / standard deviation`. Null when the deviation is 0 or unknown. */
  returnPerUnitOfRisk: SampledMetric;
  minReturn: number | null;
  maxReturn: number | null;
  meanInterval: ConfidenceInterval;
  bands: ReturnDistributionBand[];
  series: ChartSeries[];
};

/**
 * Fixed, half-open bands `[from, to)` so two periods are directly comparable.
 * Data-driven bin edges would make every chart incomparable with the last one.
 */
const RETURN_BANDS: Array<Omit<ReturnDistributionBand, "count" | "share">> = [
  { id: "lost", label: "Lost (−1.00u)", from: Number.NEGATIVE_INFINITY, to: 0, pattern: "dotted" },
  { id: "small-win", label: "Won, below +1.00u", from: 0, to: 1, pattern: "solid" },
  { id: "mid-win", label: "Won, +1.00u to +1.99u", from: 1, to: 2, pattern: "dashed" },
  { id: "large-win", label: "Won, +2.00u to +4.99u", from: 2, to: 5, pattern: "dash-dot" },
  { id: "outsized-win", label: "Won, +5.00u or more", from: 5, to: null, pattern: "solid" }
];

/**
 * Distribution of per-pick unit returns.
 *
 * A single ROI figure hides the shape that matters most in betting: whether a
 * positive return came from a broad edge or from one 12.0 shot that landed.
 * The bands are fixed rather than data-driven so that two periods can be
 * compared directly, and each carries a hatch pattern so the histogram is
 * legible without colour.
 *
 * - Range: returns in `[−1, ∞)`.
 * - Null when: below `MIN_SEGMENT_SAMPLE`. Band *counts* are still returned
 *   below threshold, because a count of observed events is a fact rather than
 *   an estimate; the summary statistics are withheld.
 */
export function returnDistribution(
  records: AdvancedPerformanceRecord[],
  minSample = MIN_SEGMENT_SAMPLE
): ReturnDistribution {
  const rows = decidedRecords(records);
  const returns = rows.map(unitReturn);
  const n = returns.length;

  const bands: ReturnDistributionBand[] = RETURN_BANDS.map((band) => {
    const count = returns.filter((value) => value >= band.from && (band.to === null || value < band.to)).length;
    return { ...band, count, share: n ? count / n : 0 };
  });

  const deviation = sampleStandardDeviation(returns);
  const average = mean(returns);

  return {
    sampleSize: n,
    requiredSample: minSample,
    state: n === 0 ? "not-applicable" : n < minSample ? "insufficient-sample" : "measured",
    meanReturn: sampledMetric(() => average, n, minSample),
    medianReturn: sampledMetric(() => median(returns), n, minSample),
    volatility: sampledMetric(() => deviation, n, minSample),
    returnPerUnitOfRisk: sampledMetric(
      () => (deviation === null || deviation === 0 || average === null ? null : average / deviation),
      n,
      minSample
    ),
    minReturn: n ? Math.min(...returns) : null,
    maxReturn: n ? Math.max(...returns) : null,
    meanInterval: n >= minSample ? meanConfidenceInterval(returns) : null,
    bands,
    series: [
      {
        id: "return-distribution",
        label: "Settled picks by return",
        pattern: "solid",
        marker: "square",
        summary: n
          ? `How ${n} settled pick${n === 1 ? "" : "s"} were distributed across return bands.`
          : "No settled picks to distribute.",
        points: bands.map((band) => ({
          x: band.id,
          xLabel: band.label,
          y: band.count,
          label: `${band.label}: ${band.count} of ${n} settled pick${n === 1 ? "" : "s"}.`,
          sampleSize: n
        }))
      }
    ]
  };
}

/**
 * Volatility: the sample standard deviation of per-pick unit returns,
 * `s = √(Σ (xᵢ − x̄)² / (n − 1))`.
 *
 * - Range: `[0, ∞)`, in units staked.
 * - Null when: below `MIN_SEGMENT_SAMPLE`, or fewer than two returns exist.
 *
 * Reported next to ROI on purpose. A +4% return with a standard deviation of
 * 1.8 units per pick is not evidence of an edge; it is a number that has not
 * had time to be tested, and the volatility is what says so.
 */
export function returnVolatility(records: AdvancedPerformanceRecord[], minSample = MIN_SEGMENT_SAMPLE): SampledMetric {
  const returns = decidedRecords(records).map(unitReturn);
  return sampledMetric(() => sampleStandardDeviation(returns), returns.length, minSample);
}

export type StreakSummary = {
  longestWinning: number | null;
  longestLosing: number | null;
  /** The run in progress at the end of the sequence. */
  current: { type: "won" | "lost"; length: number } | null;
  sampleSize: number;
};

/**
 * Longest winning and losing runs over decided picks in publication order.
 *
 * - Range: `[1, n]` once anything is decided.
 * - Push, void and cancelled rows are *removed from the sequence* rather than
 *   treated as breaks. A void never ran, so it can no more interrupt a run of
 *   wins than a day with no picks can.
 * - Null when: nothing is decided.
 *
 * Deliberately not sample-thresholded. A longest run is a count of events that
 * actually happened, not an estimate of a population parameter, and withholding
 * an observed fact for being small would be its own kind of dishonesty. The
 * `sampleSize` is returned so a surface can caption it — "3 in a row, from 5
 * settled picks" is the honest rendering.
 */
export function longestStreaks(records: AdvancedPerformanceRecord[]): StreakSummary {
  const rows = chronologically(decidedRecords(records));
  if (!rows.length) return { longestWinning: null, longestLosing: null, current: null, sampleSize: 0 };

  let longestWinning = 0;
  let longestLosing = 0;
  let runType: "won" | "lost" = rows[0].settlementStatus === "won" ? "won" : "lost";
  let runLength = 0;

  for (const row of rows) {
    const type: "won" | "lost" = row.settlementStatus === "won" ? "won" : "lost";
    if (type === runType) {
      runLength += 1;
    } else {
      runType = type;
      runLength = 1;
    }
    if (type === "won") longestWinning = Math.max(longestWinning, runLength);
    else longestLosing = Math.max(longestLosing, runLength);
  }

  return {
    longestWinning: longestWinning || null,
    longestLosing: longestLosing || null,
    current: { type: runType, length: runLength },
    sampleSize: rows.length
  };
}

// ---------------------------------------------------------------------------
// Closing-line value
// ---------------------------------------------------------------------------

export type ClvBand = {
  id: string;
  label: string;
  count: number;
  share: number;
  pattern: SeriesPattern;
};

export type ClvDistribution = {
  /** Rows whose market has closed and could in principle carry a price. */
  eligible: number;
  /** Rows that actually carry a usable closing price. */
  covered: number;
  /**
   * `covered / eligible`. Always reported when anything is eligible, because
   * coverage is the number that decides whether the CLV figure means anything.
   */
  coverage: SampledMetric;
  /** Sentence a surface must render beside any CLV figure. */
  coverageNote: string;
  meanClv: SampledMetric;
  medianClv: SampledMetric;
  meanInterval: ConfidenceInterval;
  /** Share of covered picks that beat the close. */
  beatCloseRate: SampledMetric;
  positive: number;
  negative: number;
  neutral: number;
  bands: ClvBand[];
  series: ChartSeries[];
  sampleSize: number;
  requiredSample: number;
  state: MetricValue["state"];
};

/**
 * CLV bands, written as predicates rather than numeric bounds because "level
 * with the close" is the single point 0 and cannot be expressed as a
 * half-open interval alongside the others. The five are mutually exclusive and
 * exhaustive over the reals.
 */
const CLV_BANDS: Array<Omit<ClvBand, "count" | "share"> & { matches: (value: number) => boolean }> = [
  { id: "worse-5", label: "5% or more below the close", pattern: "dotted", matches: (value) => value <= -0.05 },
  { id: "worse", label: "Below the close", pattern: "dashed", matches: (value) => value > -0.05 && value < 0 },
  { id: "level", label: "Level with the close", pattern: "solid", matches: (value) => value === 0 },
  { id: "better", label: "Above the close", pattern: "dash-dot", matches: (value) => value > 0 && value < 0.05 },
  { id: "better-5", label: "5% or more above the close", pattern: "solid", matches: (value) => value >= 0.05 }
];

/** `CLV = published odds / closing odds − 1`. Exported so callers can reuse it. */
export function closingLineValue(publishedOdds: number, closingOdds: number): number | null {
  if (!Number.isFinite(publishedOdds) || !Number.isFinite(closingOdds)) return null;
  if (publishedOdds <= 1 || closingOdds <= 1) return null;
  return publishedOdds / closingOdds - 1;
}

/**
 * Closing-line value across the ledger, with its coverage attached.
 *
 * `CLVᵢ = published_oddsᵢ / closing_oddsᵢ − 1`. Positive means we published a
 * bigger price than the market settled on — the market moved towards our
 * position, which is the least noisy short-run evidence of an edge there is,
 * because it does not depend on any result.
 *
 * - Range: `(−1, ∞)`.
 * - Eligible denominator: non-retracted publications whose kickoff has passed
 *   relative to the injected `now`. A market that has not closed cannot have a
 *   closing price, and counting it as missing coverage would understate us.
 * - Covered numerator: eligible rows with `closingOdds > 1`.
 * - Null when: fewer than `MIN_SEGMENT_SAMPLE` covered rows.
 *
 * Coverage is not optional decoration. Closing prices are captured by a job
 * racing kickoff and are frequently absent, so a CLV computed over 4 of 106
 * picks is a statement about those 4 picks and must be printed as one. That is
 * what `coverageNote` is for, and why it is a required field rather than a
 * flag.
 */
export function clvDistribution(
  records: AdvancedPerformanceRecord[],
  { now, minSample = MIN_SEGMENT_SAMPLE }: ClockOptions & { minSample?: number }
): ClvDistribution {
  const nowMs = now.getTime();
  const eligibleRows = eligibleRecords(records).filter((record) => {
    const kickoff = Date.parse(record.kickoffAt);
    return Number.isFinite(kickoff) && kickoff <= nowMs;
  });

  const values: number[] = [];
  for (const row of eligibleRows) {
    const closing = row.closingOdds;
    if (closing === null || closing === undefined) continue;
    const value = closingLineValue(row.oddsAtPublication, closing);
    if (value !== null) values.push(value);
  }

  const eligible = eligibleRows.length;
  const covered = values.length;
  const positive = values.filter((value) => value > 0).length;
  const negative = values.filter((value) => value < 0).length;
  const neutral = covered - positive - negative;

  const bands: ClvBand[] = CLV_BANDS.map(({ matches, ...band }) => {
    const count = values.filter(matches).length;
    return { ...band, count, share: covered ? count / covered : 0 };
  });

  const coverageNote =
    eligible === 0
      ? "No market has closed yet, so closing-line value cannot be measured."
      : covered === 0
        ? `No closing price was captured for any of the ${eligible} closed market${eligible === 1 ? "" : "s"}, so closing-line value is unknown.`
        : `Closing prices were captured for ${covered} of ${eligible} closed market${eligible === 1 ? "" : "s"} (${formatPercent(covered / eligible)}). Any closing-line figure describes only those ${covered}.`;

  return {
    eligible,
    covered,
    // Coverage is a census of our own capture job, not an estimate of an
    // unknown quantity, so it is reported from the first closed market.
    coverage: sampledMetric(() => covered / eligible, eligible, 1),
    coverageNote,
    meanClv: sampledMetric(() => mean(values), covered, minSample),
    medianClv: sampledMetric(() => median(values), covered, minSample),
    meanInterval: covered >= minSample ? meanConfidenceInterval(values) : null,
    beatCloseRate: sampledMetric(() => positive / covered, covered, minSample),
    positive,
    negative,
    neutral,
    bands,
    series: [
      {
        id: "clv-distribution",
        label: "Closing-line value",
        pattern: "solid",
        marker: "diamond",
        summary: coverageNote,
        points: bands.map((band) => ({
          x: band.id,
          xLabel: band.label,
          y: covered ? band.count : null,
          label: covered
            ? `${band.label}: ${band.count} of ${covered} picks with a captured closing price.`
            : `${band.label}: no closing prices captured.`,
          sampleSize: covered
        }))
      }
    ],
    sampleSize: covered,
    requiredSample: minSample,
    state: covered === 0 ? "unavailable" : covered < minSample ? "insufficient-sample" : "measured"
  };
}

/**
 * Price-decay rate: how fast the price we published drifted towards the close,
 * measured as continuously compounded odds drift per hour of lead time.
 *
 * `decayᵢ = ln(closing_oddsᵢ / published_oddsᵢ) / lead_hoursᵢ`
 *
 * - Range: real. **Negative means the price shortened after we published** —
 *   the market came towards us — which is the direction that indicates the
 *   published price was good.
 * - Logarithmic because odds compound multiplicatively: a drift from 2.0 to
 *   1.8 and one from 5.0 to 4.5 are the same 10% move and should score the
 *   same, which a linear difference would not do.
 * - Denominator: rows with a closing price *and* a positive lead time.
 * - Null when: below `MIN_SEGMENT_SAMPLE` such rows.
 *
 * Reported alongside CLV rather than instead of it. CLV says how much of the
 * move we captured; decay rate says how quickly it happened, which is what
 * decides whether publishing earlier would be worth anything.
 */
export type PriceDecay = {
  meanDecayPerHour: SampledMetric;
  medianDecayPerHour: SampledMetric;
  /** Share of covered picks where the price shortened after publication. */
  shortenedShare: SampledMetric;
  covered: number;
  eligible: number;
  coverageNote: string;
  sampleSize: number;
  requiredSample: number;
  state: MetricValue["state"];
};

export function priceDecayRate(
  records: AdvancedPerformanceRecord[],
  { now, minSample = MIN_SEGMENT_SAMPLE }: ClockOptions & { minSample?: number }
): PriceDecay {
  const nowMs = now.getTime();
  const eligibleRows = eligibleRecords(records).filter((record) => {
    const kickoff = Date.parse(record.kickoffAt);
    return Number.isFinite(kickoff) && kickoff <= nowMs;
  });

  const rates: number[] = [];
  for (const row of eligibleRows) {
    const closing = row.closingOdds;
    if (closing === null || closing === undefined || !(closing > 1)) continue;
    if (!(row.oddsAtPublication > 1)) continue;
    const leadHours = (Date.parse(row.kickoffAt) - Date.parse(row.publishedAt)) / MS_PER_HOUR;
    if (!Number.isFinite(leadHours) || leadHours <= 0) continue;
    rates.push(Math.log(closing / row.oddsAtPublication) / leadHours);
  }

  const covered = rates.length;
  const eligible = eligibleRows.length;
  const shortened = rates.filter((rate) => rate < 0).length;

  return {
    meanDecayPerHour: sampledMetric(() => mean(rates), covered, minSample),
    medianDecayPerHour: sampledMetric(() => median(rates), covered, minSample),
    shortenedShare: sampledMetric(() => shortened / covered, covered, minSample),
    covered,
    eligible,
    coverageNote:
      covered === 0
        ? `No closing price with a positive lead time exists among ${eligible} closed market${eligible === 1 ? "" : "s"}, so price decay is unknown.`
        : `Price decay is measured over ${covered} of ${eligible} closed market${eligible === 1 ? "" : "s"} that carry a closing price.`,
    sampleSize: covered,
    requiredSample: minSample,
    state: covered === 0 ? "unavailable" : covered < minSample ? "insufficient-sample" : "measured"
  };
}

// ---------------------------------------------------------------------------
// Rolling series
// ---------------------------------------------------------------------------

export type RollingOptions = ClockOptions & {
  /** Length of the trailing window in days. */
  windowDays?: number;
  /** Spacing between evaluation points, in days. */
  stepDays?: number;
  /** Most recent points to keep, so a long history cannot produce a huge array. */
  maxPoints?: number;
  minSample?: number;
};

export type RollingPoint = {
  /** ISO date of the window's closing instant. */
  asOf: string;
  value: number | null;
  sampleSize: number;
  requiredSample: number;
  state: MetricValue["state"];
};

export type RollingSeries = {
  windowDays: number;
  points: RollingPoint[];
  /** Chart-ready form with labels and a non-colour encoding. */
  series: ChartSeries;
  /** True when no point in the series cleared its threshold. */
  allWithheld: boolean;
};

/**
 * The instant a settled pick's return is realised.
 *
 * `settledAt` when we have it, kickoff otherwise: a pick belongs to the window
 * in which its market resolved, not the window in which it was written, or a
 * long-dated selection would move a month's ROI it had not yet earned.
 */
function realisedAt(record: OfficialPublicationSummary): number {
  const settled = record.settledAt ? Date.parse(record.settledAt) : Number.NaN;
  if (Number.isFinite(settled)) return settled;
  return Date.parse(record.kickoffAt);
}

/**
 * Trailing-window anchors: end-of-day UTC instants from the first record to
 * `now`, capped to the most recent `maxPoints`.
 *
 * Anchoring on day boundaries rather than on the records themselves keeps the
 * x-axis evenly spaced and makes the series reproducible: adding a pick
 * changes the values at existing points, never the points themselves.
 */
function rollingAnchors(times: number[], now: Date, stepDays: number, maxPoints: number): number[] {
  if (!times.length) return [];
  const endOfDay = (ms: number) => {
    const date = new Date(ms);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999);
  };
  const last = endOfDay(now.getTime());
  const first = endOfDay(Math.min(...times));
  const step = Math.max(1, Math.floor(stepDays)) * MS_PER_DAY;
  const anchors: number[] = [];
  for (let anchor = last; anchor >= first; anchor -= step) {
    anchors.push(anchor);
    if (anchors.length >= Math.max(1, maxPoints)) break;
  }
  return anchors.reverse();
}

function buildRollingSeries(
  records: AdvancedPerformanceRecord[],
  timeOf: (record: AdvancedPerformanceRecord) => number,
  compute: (window: AdvancedPerformanceRecord[]) => number | null,
  describe: (point: RollingPoint) => string,
  meta: { id: string; label: string; pattern: SeriesPattern; marker: SeriesMarker },
  options: RollingOptions
): RollingSeries {
  const { now, windowDays = 30, stepDays = 1, maxPoints = 90, minSample = MIN_SEGMENT_SAMPLE } = options;
  const rows = decidedRecords(records).filter((record) => Number.isFinite(timeOf(record)));
  const anchors = rollingAnchors(rows.map(timeOf), now, stepDays, maxPoints);
  const windowMs = Math.max(1, windowDays) * MS_PER_DAY;

  const points: RollingPoint[] = anchors.map((anchor) => {
    const window = rows.filter((record) => {
      const at = timeOf(record);
      return at > anchor - windowMs && at <= anchor;
    });
    const metric = sampledMetric(() => compute(window), window.length, minSample);
    return {
      asOf: new Date(anchor).toISOString(),
      value: metric.value,
      sampleSize: metric.sampleSize,
      requiredSample: metric.requiredSample,
      state: metric.state
    };
  });

  const measuredPoints = points.filter((point) => point.value !== null);
  return {
    windowDays,
    points,
    series: {
      id: meta.id,
      label: meta.label,
      pattern: meta.pattern,
      marker: meta.marker,
      summary: measuredPoints.length
        ? `${meta.label} over a ${windowDays}-day trailing window, ${measuredPoints.length} of ${points.length} points measurable.`
        : `${meta.label} over a ${windowDays}-day trailing window. No point yet holds the ${minSample} settled decisions needed to measure it.`,
      points: points.map((point) => ({
        x: point.asOf,
        xLabel: point.asOf.slice(0, 10),
        y: point.value,
        label: describe(point),
        sampleSize: point.sampleSize
      }))
    },
    allWithheld: measuredPoints.length === 0
  };
}

/**
 * Rolling ROI over a trailing window.
 *
 * Each point is `mean(unit return)` over decided picks whose markets settled
 * inside `(anchor − windowDays, anchor]`.
 *
 * - Range per point: `[−1, ∞)`.
 * - A point below `MIN_SEGMENT_SAMPLE` is `null` with `insufficient-sample`,
 *   not a dip to zero. This matters more here than anywhere else in the file:
 *   a rolling chart that plots thin windows as 0 draws a crash that never
 *   happened, and readers believe charts.
 */
export function rollingRoi(records: AdvancedPerformanceRecord[], options: RollingOptions): RollingSeries {
  return buildRollingSeries(
    records,
    realisedAt,
    (window) => mean(window.map(unitReturn)),
    (point) =>
      point.value === null
        ? `${point.asOf.slice(0, 10)}: ${point.sampleSize} of the ${point.requiredSample} settled picks needed to measure return.`
        : `${point.asOf.slice(0, 10)}: ${formatSignedPercent(point.value)} return over ${point.sampleSize} settled picks.`,
    { id: "rolling-roi", label: "Rolling return on investment", pattern: "solid", marker: "circle" },
    options
  );
}

/**
 * Rolling Brier score over a trailing window.
 *
 * Same windowing as `rollingRoi`, scoring probabilities rather than prices.
 * Only rows with a usable probability enter the window; a window below
 * `MIN_SEGMENT_SAMPLE` is withheld.
 *
 * - Range per point: `[0, 1]`, lower better. Note the axis direction is the
 *   opposite of the ROI chart, which is exactly the kind of thing a shared
 *   colour convention would obscure — hence the separate label and marker.
 */
export function rollingBrier(records: AdvancedPerformanceRecord[], options: RollingOptions): RollingSeries {
  const scorable = scorableRecords(records);
  return buildRollingSeries(
    scorable,
    realisedAt,
    (window) =>
      window.length ? window.reduce((sum, row) => sum + (row.modelProbability - outcome(row)) ** 2, 0) / window.length : null,
    (point) =>
      point.value === null
        ? `${point.asOf.slice(0, 10)}: ${point.sampleSize} of the ${point.requiredSample} scored picks needed to measure the Brier score.`
        : `${point.asOf.slice(0, 10)}: Brier score ${point.value.toFixed(4)} over ${point.sampleSize} scored picks, where lower is better.`,
    { id: "rolling-brier", label: "Rolling Brier score", pattern: "dash-dot", marker: "triangle" },
    options
  );
}

// ---------------------------------------------------------------------------
// Process metrics
// ---------------------------------------------------------------------------

export type CoverageSummary = {
  evaluated: number;
  published: number;
  /** `pick` decisions — the engine wanted to act. */
  actionable: number;
  /** `lean` and `watch` — interest short of a publishable pick. */
  observed: number;
  /** `pass`, `withheld` and `unavailable` — the engine declined. */
  abstained: number;
  /** `withheld` and `unavailable` alone: declined for want of data, not judgement. */
  blocked: number;
  coverage: SampledMetric;
  abstentionRate: SampledMetric;
  blockedRate: SampledMetric;
};

const ABSTAINING_STATUSES: ReadonlySet<DecisionStatus> = new Set<DecisionStatus>(["pass", "withheld", "unavailable"]);
const BLOCKED_STATUSES: ReadonlySet<DecisionStatus> = new Set<DecisionStatus>(["withheld", "unavailable"]);

/**
 * Decision coverage and abstention over the markets the engine evaluated.
 *
 * - `coverage = published / evaluated` — range `[0, 1]`.
 * - `abstentionRate = (pass + withheld + unavailable) / evaluated`.
 * - `blockedRate = (withheld + unavailable) / evaluated`.
 * - Null when: below `MIN_SEGMENT_SAMPLE` evaluated decisions.
 *
 * `blockedRate` is split out from abstention because the two say opposite
 * things about the engine. Passing on a market is the model working — it
 * looked and found nothing. Withholding is the model *unable* to look, and a
 * rising blocked rate is a data incident wearing the costume of discipline.
 * Folding them together is how a pipeline outage gets reported as selectivity.
 */
export function decisionCoverage(
  observations: DecisionObservation[],
  minSample = MIN_SEGMENT_SAMPLE
): CoverageSummary {
  const evaluated = observations.length;
  const published = observations.filter((observation) => observation.published).length;
  const actionable = observations.filter((observation) => observation.decisionStatus === "pick").length;
  const observed = observations.filter(
    (observation) => observation.decisionStatus === "lean" || observation.decisionStatus === "watch"
  ).length;
  const abstained = observations.filter((observation) => ABSTAINING_STATUSES.has(observation.decisionStatus)).length;
  const blocked = observations.filter((observation) => BLOCKED_STATUSES.has(observation.decisionStatus)).length;

  return {
    evaluated,
    published,
    actionable,
    observed,
    abstained,
    blocked,
    coverage: sampledMetric(() => published / evaluated, evaluated, minSample),
    abstentionRate: sampledMetric(() => abstained / evaluated, evaluated, minSample),
    blockedRate: sampledMetric(() => blocked / evaluated, evaluated, minSample)
  };
}

/** Convenience wrapper when only the abstention figure is wanted. */
export function abstentionRate(observations: DecisionObservation[], minSample = MIN_SEGMENT_SAMPLE): SampledMetric {
  return decisionCoverage(observations, minSample).abstentionRate;
}

export type TimingSummary = {
  medianMinutes: SampledMetric;
  p10Minutes: SampledMetric;
  p90Minutes: SampledMetric;
  minMinutes: number | null;
  maxMinutes: number | null;
  sampleSize: number;
  requiredSample: number;
  /** Rows excluded because the interval was zero or negative. */
  invalid: number;
};

function timingSummary(durations: number[], invalid: number, minSample: number): TimingSummary {
  const n = durations.length;
  return {
    medianMinutes: sampledMetric(() => median(durations), n, minSample),
    p10Minutes: sampledMetric(() => quantile(durations, 0.1), n, minSample),
    p90Minutes: sampledMetric(() => quantile(durations, 0.9), n, minSample),
    minMinutes: n ? Math.min(...durations) : null,
    maxMinutes: n ? Math.max(...durations) : null,
    sampleSize: n,
    requiredSample: minSample,
    invalid
  };
}

/**
 * Publication lead time: `kickoff − published_at`, in minutes.
 *
 * - Range: `(0, ∞)`. The ledger's `op_publications_before_kickoff` constraint
 *   makes a non-positive lead time impossible in the database; any row that
 *   still shows one is counted in `invalid` and excluded rather than silently
 *   clamped, because a pick published after kickoff is not a prediction and
 *   hiding it would hide exactly the failure worth seeing.
 * - Reported as median, p10 and p90 rather than a mean: lead times are
 *   right-skewed by a few picks published days ahead, and a mean would
 *   describe none of the distribution.
 * - Null when: below `MIN_OPERATIONAL_SAMPLE`.
 */
export function publicationLeadTime(
  records: AdvancedPerformanceRecord[],
  minSample = MIN_OPERATIONAL_SAMPLE
): TimingSummary {
  const durations: number[] = [];
  let invalid = 0;
  for (const record of eligibleRecords(records)) {
    const minutes = (Date.parse(record.kickoffAt) - Date.parse(record.publishedAt)) / MS_PER_MINUTE;
    if (!Number.isFinite(minutes)) continue;
    if (minutes <= 0) {
      invalid += 1;
      continue;
    }
    durations.push(minutes);
  }
  return timingSummary(durations, invalid, minSample);
}

export type SettlementLatency = TimingSummary & {
  /** Terminal rows carrying a settlement timestamp. */
  settled: number;
  /** Rows whose kickoff has passed but which are still unsettled at `now`. */
  outstandingPastKickoff: number;
  /** Longest outstanding wait in minutes, or null when nothing is outstanding. */
  longestOutstandingMinutes: number | null;
};

/**
 * Settlement latency: `settled_at − kickoff`, in minutes.
 *
 * - Range: `(0, ∞)`. Rows settled at or before kickoff are counted as
 *   `invalid` — a result cannot precede the match.
 * - Denominator: terminally settled rows carrying `settledAt`.
 * - Null when: below `MIN_OPERATIONAL_SAMPLE`.
 *
 * `outstandingPastKickoff` is the field that matters most and is deliberately
 * not a rate. When the ledger holds 122 picks whose matches have finished and
 * which nothing has graded, a median latency of "94 minutes" over the 106 that
 * did settle is true and useless on its own; the count of what is still
 * missing is the honest headline, and it is a census, so it needs no threshold.
 */
export function settlementLatency(
  records: AdvancedPerformanceRecord[],
  { now, minSample = MIN_OPERATIONAL_SAMPLE }: ClockOptions & { minSample?: number }
): SettlementLatency {
  const nowMs = now.getTime();
  const durations: number[] = [];
  let invalid = 0;
  let settled = 0;
  let outstanding = 0;
  let longestOutstanding: number | null = null;

  for (const record of eligibleRecords(records)) {
    const kickoff = Date.parse(record.kickoffAt);
    if (!Number.isFinite(kickoff)) continue;
    if (record.settledAt) {
      settled += 1;
      const minutes = (Date.parse(record.settledAt) - kickoff) / MS_PER_MINUTE;
      if (!Number.isFinite(minutes)) continue;
      if (minutes <= 0) {
        invalid += 1;
        continue;
      }
      durations.push(minutes);
      continue;
    }
    if (kickoff <= nowMs) {
      outstanding += 1;
      const waiting = (nowMs - kickoff) / MS_PER_MINUTE;
      longestOutstanding = longestOutstanding === null ? waiting : Math.max(longestOutstanding, waiting);
    }
  }

  return {
    ...timingSummary(durations, invalid, minSample),
    settled,
    outstandingPastKickoff: outstanding,
    longestOutstandingMinutes: longestOutstanding
  };
}

// ---------------------------------------------------------------------------
// Model-version comparison
// ---------------------------------------------------------------------------

export type ModelVersionMetrics = {
  modelVersion: string;
  published: number;
  decided: number;
  won: number;
  lost: number;
  hitRate: SampledMetric;
  hitRateInterval: ConfidenceInterval;
  roi: SampledMetric;
  brierScore: SampledMetric;
  logLoss: SampledMetric;
  expectedVersusActual: ExpectedVersusActual;
};

export type ModelVersionComparison = {
  baseline: ModelVersionMetrics | null;
  candidate: ModelVersionMetrics | null;
  /** `candidate − baseline` hit rate. Null unless both arms clear threshold. */
  hitRateDifference: number | null;
  /** Newcombe hybrid-score interval on the hit-rate difference. */
  hitRateDifferenceInterval: ConfidenceInterval;
  /** `baseline − candidate` Brier. Positive means the candidate forecasts better. */
  brierImprovement: number | null;
  /** True when the hit-rate difference interval excludes zero. */
  separated: boolean;
  /** Why a comparison could not be made, when it could not. */
  blockedReason: string | null;
};

export type ModelVersionReport = {
  versions: ModelVersionMetrics[];
  comparison: ModelVersionComparison;
  series: ChartSeries[];
};

function metricsForVersion(modelVersion: string, rows: AdvancedPerformanceRecord[], minSample: number): ModelVersionMetrics {
  const decided = decidedRecords(rows);
  const wins = decided.filter((row) => outcome(row) === 1).length;
  return {
    modelVersion,
    published: eligibleRecords(rows).length,
    decided: decided.length,
    won: wins,
    lost: decided.length - wins,
    hitRate: hitRate(rows, minSample),
    hitRateInterval: decided.length >= minSample ? wilsonInterval(wins, decided.length) : null,
    roi: returnOnInvestment(rows, minSample),
    brierScore: brierScore(rows, minSample),
    logLoss: logLoss(rows, minSample),
    expectedVersusActual: expectedVersusActualWins(rows, minSample)
  };
}

/**
 * Newcombe's hybrid-score interval for the difference of two proportions.
 *
 * `lower = (p₁ − p₂) − √((p₁ − l₁)² + (u₂ − p₂)²)`
 * `upper = (p₁ − p₂) + √((u₁ − p₁)² + (p₂ − l₂)²)`
 *
 * where `(lᵢ, uᵢ)` are the Wilson intervals of each arm. Chosen over the naive
 * normal interval for the same reason `wilsonInterval` is: at the sample sizes
 * a model comparison actually has, the normal difference interval overshoots
 * `[−1, 1]` and behaves worst precisely at the extreme rates a new arm is most
 * likely to post.
 */
export function proportionDifferenceInterval(
  successes1: number,
  trials1: number,
  successes2: number,
  trials2: number,
  z = 1.96
): ConfidenceInterval {
  if (trials1 <= 0 || trials2 <= 0) return null;
  const first = wilsonInterval(successes1, trials1, z);
  const second = wilsonInterval(successes2, trials2, z);
  if (!first || !second) return null;
  const p1 = successes1 / trials1;
  const p2 = successes2 / trials2;
  const difference = p1 - p2;
  return {
    low: difference - Math.sqrt((p1 - first.low) ** 2 + (second.high - p2) ** 2),
    high: difference + Math.sqrt((first.high - p1) ** 2 + (p2 - second.low) ** 2),
    level: 0.95
  };
}

/**
 * Split the ledger by model version and compare two of them.
 *
 * Versions are ordered by decided count, descending — the arm with the most
 * evidence is the natural baseline, and ties break on the version string so
 * the ordering is deterministic.
 *
 * - Every per-version metric carries its own threshold; an arm below
 *   `MIN_SEGMENT_SAMPLE` reports insufficient sample rather than a rate.
 * - The comparison itself is null unless *both* arms clear the threshold. A
 *   difference between a measured rate and an unmeasurable one is not a
 *   smaller difference, it is no difference at all, and `blockedReason` says
 *   which arm was short.
 * - `separated` is true only when the interval excludes zero. It is the field
 *   a promotion decision should read; the point estimate is not.
 *
 * Rows with no `modelVersion` group under `UNVERSIONED_LABEL` rather than
 * being dropped, so the total across versions always reconciles with the
 * ledger total.
 */
export function compareModelVersions(
  records: AdvancedPerformanceRecord[],
  {
    baselineVersion,
    candidateVersion,
    minSample = MIN_SEGMENT_SAMPLE
  }: { baselineVersion?: string; candidateVersion?: string; minSample?: number } = {}
): ModelVersionReport {
  const groups = new Map<string, AdvancedPerformanceRecord[]>();
  for (const record of eligibleRecords(records)) {
    const key = record.modelVersion ?? UNVERSIONED_LABEL;
    const existing = groups.get(key);
    if (existing) existing.push(record);
    else groups.set(key, [record]);
  }

  const versions = [...groups.entries()]
    .map(([version, rows]) => metricsForVersion(version, rows, minSample))
    .sort((left, right) => right.decided - left.decided || left.modelVersion.localeCompare(right.modelVersion));

  const pick = (requested: string | undefined, fallbackIndex: number): ModelVersionMetrics | null => {
    if (requested) return versions.find((entry) => entry.modelVersion === requested) ?? null;
    return versions[fallbackIndex] ?? null;
  };
  const baseline = pick(baselineVersion, 0);
  const candidate = pick(candidateVersion, 1);

  let blockedReason: string | null = null;
  let hitRateDifference: number | null = null;
  let hitRateDifferenceInterval: ConfidenceInterval = null;
  let brierImprovement: number | null = null;

  if (!baseline || !candidate) {
    blockedReason = "Two model versions are needed to compare, and the ledger holds fewer than two.";
  } else if (baseline.modelVersion === candidate.modelVersion) {
    blockedReason = "The baseline and candidate are the same model version.";
  } else if (baseline.hitRate.value === null || candidate.hitRate.value === null) {
    const short = [baseline, candidate]
      .filter((entry) => entry.hitRate.value === null)
      .map((entry) => `${entry.modelVersion} has ${entry.decided} of the ${minSample} settled decisions needed`);
    blockedReason = `Not enough settled decisions to compare: ${short.join("; ")}.`;
  } else {
    hitRateDifference = candidate.hitRate.value - baseline.hitRate.value;
    hitRateDifferenceInterval = proportionDifferenceInterval(
      candidate.won,
      candidate.decided,
      baseline.won,
      baseline.decided
    );
    brierImprovement =
      baseline.brierScore.value !== null && candidate.brierScore.value !== null
        ? baseline.brierScore.value - candidate.brierScore.value
        : null;
  }

  return {
    versions,
    comparison: {
      baseline,
      candidate,
      hitRateDifference,
      hitRateDifferenceInterval,
      brierImprovement,
      separated: hitRateDifferenceInterval
        ? hitRateDifferenceInterval.low > 0 || hitRateDifferenceInterval.high < 0
        : false,
      blockedReason
    },
    series: [
      {
        id: "model-version-hit-rate",
        label: "Hit rate by model version",
        pattern: "solid",
        marker: "square",
        summary: versions.length
          ? `Settled hit rate for ${versions.length} model version${versions.length === 1 ? "" : "s"}.`
          : "No model versions in the ledger.",
        points: versions.map((entry) => ({
          x: entry.modelVersion,
          xLabel: entry.modelVersion,
          y: entry.hitRate.value,
          label:
            entry.hitRate.value === null
              ? `${entry.modelVersion}: ${entry.decided} of the ${entry.hitRate.requiredSample} settled decisions needed to measure a hit rate.`
              : `${entry.modelVersion}: ${formatPercent(entry.hitRate.value)} from ${entry.decided} settled decisions.`,
          sampleSize: entry.decided
        }))
      }
    ]
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export type AdvancedPerformanceReport = {
  /** The `now` the report was computed against, echoed for reproducibility. */
  asOf: string;
  published: number;
  decided: number;
  unsettled: number;
  excludedFromRecord: { push: number; void: number; cancelled: number; pendingVerification: number };
  forecast: {
    brierScore: SampledMetric;
    logLoss: SampledMetric;
    brierSkillScore: SampledMetric;
    expectedCalibrationError: SampledMetric;
    reliability: ReliabilityCurve;
    expectedVersusActual: ExpectedVersusActual;
  };
  selection: {
    hitRate: SampledMetric;
    hitRateInterval: ConfidenceInterval;
    roi: SampledMetric;
    volatility: SampledMetric;
    distribution: ReturnDistribution;
    streaks: StreakSummary;
  };
  price: { clv: ClvDistribution; decay: PriceDecay };
  rolling: { roi: RollingSeries; brier: RollingSeries };
  process: {
    coverage: CoverageSummary | null;
    leadTime: TimingSummary;
    settlement: SettlementLatency;
  };
  models: ModelVersionReport;
};

/**
 * Everything above, computed once against one injected `now`.
 *
 * Provided so a read layer makes a single call and cannot accidentally compute
 * two figures against two different clocks — which is how a page ends up
 * saying 106 graded in one tile and 107 in the next.
 *
 * `decisions` is optional: coverage and abstention need the decision
 * population, and a caller that only has publications gets `coverage: null`
 * rather than a coverage of 100% derived from the picks that happen to exist.
 */
export function computeAdvancedPerformance(
  records: AdvancedPerformanceRecord[],
  { now, decisions, minSample = MIN_SEGMENT_SAMPLE }: ClockOptions & { decisions?: DecisionObservation[]; minSample?: number }
): AdvancedPerformanceReport {
  const eligible = eligibleRecords(records);
  const decided = decidedRecords(records);
  const wins = decided.filter((row) => outcome(row) === 1).length;
  const count = (status: string) => eligible.filter((record) => record.settlementStatus === status).length;

  return {
    asOf: now.toISOString(),
    published: eligible.length,
    decided: decided.length,
    unsettled: count("unsettled"),
    excludedFromRecord: {
      push: count("push"),
      void: count("void"),
      cancelled: count("cancelled"),
      pendingVerification: count("pending_verification")
    },
    forecast: {
      brierScore: brierScore(records, minSample),
      logLoss: logLoss(records, minSample),
      brierSkillScore: brierSkillScore(records, minSample),
      expectedCalibrationError: expectedCalibrationError(records),
      reliability: reliabilityCurve(records),
      expectedVersusActual: expectedVersusActualWins(records, minSample)
    },
    selection: {
      hitRate: hitRate(records, minSample),
      hitRateInterval: decided.length >= minSample ? wilsonInterval(wins, decided.length) : null,
      roi: returnOnInvestment(records, minSample),
      volatility: returnVolatility(records, minSample),
      distribution: returnDistribution(records, minSample),
      streaks: longestStreaks(records)
    },
    price: {
      clv: clvDistribution(records, { now, minSample }),
      decay: priceDecayRate(records, { now, minSample })
    },
    rolling: {
      roi: rollingRoi(records, { now, minSample }),
      brier: rollingBrier(records, { now, minSample })
    },
    process: {
      coverage: decisions ? decisionCoverage(decisions, minSample) : null,
      leadTime: publicationLeadTime(records),
      settlement: settlementLatency(records, { now })
    },
    models: compareModelVersions(records, { minSample })
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatPercent(value: number | null): string {
  return value === null ? "an unknown share" : `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number | null): string {
  return value === null ? "an unknown return" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}
