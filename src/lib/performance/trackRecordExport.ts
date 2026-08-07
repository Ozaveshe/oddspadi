import { trackRecordBandDefinitions } from "@/lib/performance/trackRecordFilters";
import { exportFilterContext, type TrackRecordRow, type TrackRecordView } from "@/lib/performance/trackRecordView";

/**
 * Exports of the public track record.
 *
 * An export leaves the page behind. Whoever opens the file next will not see
 * the caption that said the sample was 106 picks over one day, will not see the
 * note that closing prices are missing for all of them, and will not know
 * whether "ROI" meant return on turnover or return on bankroll. So the file
 * carries its own context: the period and its exact boundaries, every active
 * filter, the availability of the read, and a definition for every metric and
 * every derived band it contains.
 *
 * Two invariants:
 *
 * **CSV and JSON are the same numbers.** Both are projected from one
 * `TrackRecordView`, which is the same object the page rendered. There is no
 * second aggregation path, so a discrepancy between the page and the file is
 * not expressible.
 *
 * **An empty cell means "not known".** It never means zero. That distinction is
 * the whole reason this record is trustworthy, and it is the first thing lost
 * when a null is serialised as `0` to keep a spreadsheet tidy.
 */

export type MetricDefinition = { metric: string; definition: string };

export const TRACK_RECORD_METRIC_DEFINITIONS: MetricDefinition[] = [
  { metric: "Published", definition: "Official public picks published in the period. Retracted claims are counted here and excluded from every other figure." },
  { metric: "Settled", definition: "Publications that have reached a terminal state: won, lost, push, void or cancelled." },
  { metric: "Pending", definition: "Publications with no verdict yet — unsettled, or awaiting verification." },
  { metric: "Won", definition: "Settled correct at the published price." },
  { metric: "Lost", definition: "Settled incorrect. One unit staked, one unit lost." },
  { metric: "Push", definition: "The market returned the stake. Not a win and not a loss; excluded from the hit-rate denominator." },
  { metric: "Void", definition: "The market never resolved. Excluded from the hit-rate denominator." },
  { metric: "Cancelled", definition: "The fixture was called off. Excluded from the hit-rate denominator." },
  { metric: "Decided", definition: "Won plus lost. The denominator for hit rate, profit and yield." },
  { metric: "Profit (units)", definition: "One unit staked per decided pick at the price recorded at publication. A win returns the price minus the stake; a loss costs one unit. Pushes and voids contribute nothing." },
  { metric: "ROI / yield", definition: "Profit in units divided by decided picks — return per unit staked, not return on a bankroll." },
  { metric: "Hit rate", definition: "Won divided by decided. Pushes, voids, cancellations and pending picks are not in the denominator." },
  { metric: "Hit-rate interval", definition: "95% Wilson score interval around the hit rate. Wilson rather than the normal approximation because at small samples the normal interval can exceed 0–100% and collapses to zero width at 0% or 100%." },
  { metric: "Average published odds", definition: "Mean decimal price at the moment of publication, across every publication in the view." },
  { metric: "Average closing odds", definition: "Mean decimal closing price, across only those publications that carry one. Read the coverage figure beside it before quoting this." },
  { metric: "Closing-line coverage", definition: "Share of publications in the view that carry a closing price at all. A coverage of 0% is a measurement about our data; it is not a statement about the model." },
  { metric: "Average CLV", definition: "Mean of (published odds / closing odds − 1) over publications that carry a closing price. Positive means the published price was better than the close." },
  { metric: "Current streak", definition: "The trailing run of identical verdicts, ordered by settlement time." },
  { metric: "Current drawdown (units)", definition: "Units below the highest cumulative profit reached so far, in publication order." },
  { metric: "Maximum drawdown (units)", definition: "The largest peak-to-trough fall in cumulative profit, in publication order." },
  { metric: "Last settlement", definition: "The most recent settlement timestamp in the view." },
  { metric: "Brier score", definition: "Mean squared error of the model probability against the outcome. Lower is better. A forecast metric: it judges the probability, not the price." },
  { metric: "Log loss", definition: "Mean negative log likelihood of the outcome under the model probability, clamped so a confident miss is expensive but finite." },
  { metric: "Expected calibration error", definition: "Weighted mean gap between predicted and observed frequency across probability buckets. Withheld below 50 settled events." },
  { metric: "Brier skill", definition: "Improvement in Brier score against always predicting the base rate. Positive means better than guessing the average." },
  { metric: "Fair odds", definition: "1 divided by the model probability — the price at which the model is indifferent. Not a price anyone offered." },
  { metric: "Unit return", definition: "The one-unit profit of a single row. Empty for pending, push, void and cancelled rows." },
  { metric: "Correction state", definition: "Whether the claim still stands as first published, has been corrected forward, or has been retracted. Retracted claims score in neither direction." },
  { metric: "Publication lead time", definition: "Hours between publication and kickoff. Every publication is written before kickoff; the ledger refuses any that is not." }
];

/**
 * The sentences that must travel with any number from this record.
 *
 * These are not decoration. Each one names a way the figures above are
 * routinely misread.
 */
export const TRACK_RECORD_EXPORT_NOTES: string[] = [
  "Source of truth: op_publications, op_publication_settlements and op_publication_revisions. Nothing here is derived from news, prediction cards or internal decision tables.",
  "An empty cell means the value is not known. It never means zero.",
  "Only the official_public_pick record class exists in this export. Shadow decisions, backtests, editorial observations and community selections are separate classes and are never aggregated with these rows.",
  "Forecast metrics (Brier, log loss, calibration) judge a probability. Selection metrics (hit rate, profit, yield, CLV, drawdown) judge a bet at a price. They answer different questions and are never combined into one headline.",
  "Periods are measured by publication time in the timezone named in the context block, not by kickoff.",
  "Past results are not a guide to future results, and no analysis removes the risk of losing money."
];

const CSV_COLUMNS: Array<{ header: string; value: (row: TrackRecordRow) => string | number | null }> = [
  { header: "publication_id", value: (row) => row.publicationId },
  { header: "published_at_utc", value: (row) => row.publishedAt },
  { header: "kickoff_at_utc", value: (row) => row.kickoffAt },
  { header: "fixture", value: (row) => row.fixtureLabel },
  { header: "fixture_external_id", value: (row) => row.fixtureExternalId },
  { header: "sport", value: (row) => row.sport },
  { header: "competition", value: (row) => row.competition },
  { header: "market", value: (row) => row.market },
  { header: "market_family", value: (row) => row.marketFamily },
  { header: "market_line", value: (row) => row.marketLine },
  { header: "selection", value: (row) => row.selection },
  { header: "selection_label", value: (row) => row.selectionLabel },
  { header: "selection_type", value: (row) => row.selectionType },
  { header: "odds_at_publication", value: (row) => row.oddsAtPublication },
  { header: "odds_band", value: (row) => row.oddsBand },
  { header: "model_probability", value: (row) => row.modelProbability },
  { header: "fair_odds", value: (row) => (Number.isFinite(row.fairOdds) ? Number(row.fairOdds.toFixed(4)) : null) },
  { header: "probability_band", value: (row) => row.probabilityBand },
  { header: "closing_odds", value: (row) => row.closingOdds },
  { header: "closing_line_value", value: (row) => (row.closingLineValue === null ? null : Number(row.closingLineValue.toFixed(6))) },
  { header: "result", value: (row) => row.settlementStatus },
  { header: "settled_at_utc", value: (row) => row.settledAt },
  { header: "unit_return", value: (row) => (row.unitReturn === null ? null : Number(row.unitReturn.toFixed(4))) },
  { header: "model_version", value: (row) => row.modelVersion },
  { header: "calibration_version", value: (row) => row.calibrationVersion },
  { header: "decision_tier", value: (row) => row.decisionTier },
  { header: "data_readiness", value: (row) => row.dataReadiness },
  { header: "lead_time_hours", value: (row) => (row.leadTimeHours === null ? null : Number(row.leadTimeHours.toFixed(2))) },
  { header: "lead_time_band", value: (row) => row.leadTimeBand },
  { header: "correction_state", value: (row) => row.correctionState },
  { header: "correction_reason", value: (row) => row.correctionReason },
  { header: "revision", value: (row) => row.revision }
];

export const TRACK_RECORD_CSV_HEADERS = CSV_COLUMNS.map((column) => column.header);

/** RFC 4180. A null is an empty field, which the notes define as "not known". */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvComment(line: string): string {
  return `# ${line.replaceAll("\r", " ").replaceAll("\n", " ")}`;
}

const NOT_AVAILABLE = "not available (unavailable)";

function metricPairs(view: TrackRecordView): Array<[string, string]> {
  const summary = view.summary;
  // On an unreadable ledger even the counts are unknown. `published: 0` in an
  // export would be read as "nothing was published", which is a claim about
  // the product rather than about the read that failed.
  const unknown = view.availability === "unavailable";
  const count = (input: number): string => (unknown ? NOT_AVAILABLE : String(input));
  const value = (metric: { value: number | null; state: string }, format: (input: number) => string): string =>
    metric.value === null ? `not available (${metric.state})` : format(metric.value);
  const percent = (input: number) => `${(input * 100).toFixed(1)}%`;
  const signedPercent = (input: number) => `${input >= 0 ? "+" : "−"}${Math.abs(input * 100).toFixed(1)}%`;
  const units = (input: number) => `${input >= 0 ? "+" : "−"}${Math.abs(input).toFixed(2)}u`;
  const plain = (input: number) => input.toFixed(4);

  return [
    ["Published", count(summary.published)],
    ["Settled", count(summary.settled)],
    ["Pending", count(summary.pending)],
    ["Won", count(summary.won)],
    ["Lost", count(summary.lost)],
    ["Push", count(summary.push)],
    ["Void", count(summary.voided)],
    ["Cancelled", count(summary.cancelled)],
    ["Decided", count(summary.decided)],
    ["Profit (units)", value(summary.profitUnits, units)],
    ["ROI / yield", value(summary.roi, signedPercent)],
    ["Hit rate", value(summary.hitRate, percent)],
    [
      "Hit-rate interval (95%)",
      summary.hitRateInterval
        ? `${percent(summary.hitRateInterval.low)} to ${percent(summary.hitRateInterval.high)}`
        : "not available (no decided picks)"
    ],
    ["Average published odds", value(summary.averagePublishedOdds, (input) => input.toFixed(2))],
    ["Average closing odds", value(summary.averageClosingOdds, (input) => input.toFixed(2))],
    [
      "Closing-line coverage",
      `${value(summary.closingCoverage, percent)} (${summary.closingCoverageCount} of ${summary.published} publications carry a closing price)`
    ],
    ["Average CLV", value(summary.averageClosingLineValue, signedPercent)],
    [
      "Current streak",
      summary.currentStreak.kind ? `${summary.currentStreak.length} ${summary.currentStreak.kind}` : "no settled picks yet"
    ],
    ["Current drawdown (units)", value(summary.currentDrawdownUnits, (input) => `${input.toFixed(2)}u`)],
    ["Maximum drawdown (units)", value(summary.maxDrawdownUnits, (input) => `${input.toFixed(2)}u`)],
    ["Last settlement (UTC)", summary.lastSettlementAt ?? "none"],
    ["Brier score", value(summary.forecast.brierScore, plain)],
    ["Log loss", value(summary.forecast.logLoss, plain)],
    ["Expected calibration error", value(summary.forecast.expectedCalibrationError, plain)],
    ["Brier skill", value(summary.forecast.brierSkill, plain)]
  ];
}

/**
 * The CSV.
 *
 * Context, summary and definitions travel as `#`-prefixed comment lines ahead
 * of the data, which pandas (`comment="#"`), R (`comment.char="#"`) and most
 * spreadsheet importers either skip or park in a single column. The data table
 * below them is plain RFC 4180 with one header row, so nothing has to be
 * cleaned before it can be parsed.
 */
export function formatTrackRecordCsv(view: TrackRecordView): string {
  const lines: string[] = [];
  lines.push(csvComment("OddsPadi official public track record"));
  lines.push(csvComment(`Generated at ${view.asOf} (UTC)`));
  lines.push(csvComment(""));
  lines.push(csvComment("-- Filter context --"));
  for (const [key, value] of Object.entries(exportFilterContext(view))) lines.push(csvComment(`${key}: ${value}`));
  if (view.presentation !== "live") {
    lines.push(
      csvComment(
        view.presentation === "unavailable"
          ? "WARNING: the ledger could not be read when this file was generated. It contains no rows, and that is not a zero record."
          : `WARNING: the ledger could not be read; these figures are the last known good answer, from ${view.lastKnownGoodAt}.`
      )
    );
  }
  if (view.summary.truncated) {
    lines.push(csvComment("WARNING: the period contains more publications than this export's row cap. These are the most recent."));
  }
  if (view.summary.smallSampleWarning) lines.push(csvComment(`Sample warning: ${view.summary.smallSampleWarning}`));

  lines.push(csvComment(""));
  lines.push(csvComment("-- Summary --"));
  for (const [label, value] of metricPairs(view)) lines.push(csvComment(`${label}: ${value}`));

  lines.push(csvComment(""));
  lines.push(csvComment("-- Metric definitions --"));
  for (const entry of TRACK_RECORD_METRIC_DEFINITIONS) lines.push(csvComment(`${entry.metric}: ${entry.definition}`));

  lines.push(csvComment(""));
  lines.push(csvComment("-- Band definitions --"));
  for (const entry of trackRecordBandDefinitions()) {
    lines.push(csvComment(`${entry.dimension} / ${entry.band}: ${entry.definition}`));
  }

  lines.push(csvComment(""));
  lines.push(csvComment("-- Notes --"));
  for (const note of TRACK_RECORD_EXPORT_NOTES) lines.push(csvComment(note));
  lines.push(csvComment(""));

  lines.push(TRACK_RECORD_CSV_HEADERS.join(","));
  for (const row of view.page.rows) {
    lines.push(CSV_COLUMNS.map((column) => csvCell(column.value(row))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export type TrackRecordJsonExport = {
  generatedAt: string;
  source: {
    tables: string[];
    recordClass: "official_public_pick";
    availability: string;
    presentation: string;
    lastKnownGoodAt: string | null;
    truncated: boolean;
  };
  context: Record<string, string>;
  coverage: string;
  ledgerSpan: TrackRecordView["ledgerSpan"];
  warnings: string[];
  summary: Record<string, string>;
  /** Machine-readable summary values. Null means not known, never zero. */
  summaryValues: Record<string, number | null>;
  definitions: MetricDefinition[];
  bandDefinitions: Array<{ dimension: string; band: string; definition: string }>;
  notes: string[];
  rowCount: number;
  rows: TrackRecordRow[];
};

/** The JSON export. Same view, same numbers, same definitions as the CSV. */
export function formatTrackRecordJson(view: TrackRecordView): TrackRecordJsonExport {
  const summary = view.summary;
  const warnings: string[] = [];
  if (view.presentation === "unavailable") {
    warnings.push("The ledger could not be read. This export contains no rows, and that is not a zero record.");
  }
  if (view.presentation === "last-known-good") {
    warnings.push(`The ledger could not be read; these figures are the last known good answer, from ${view.lastKnownGoodAt}.`);
  }
  if (summary.truncated) {
    warnings.push("The period contains more publications than this export's row cap. These are the most recent.");
  }
  if (summary.smallSampleWarning) warnings.push(summary.smallSampleWarning);

  // Null, not zero, when the read failed. A machine-readable `"won": 0` is the
  // worst possible place for a claim we did not make to end up.
  const knownCount = (input: number): number | null => (view.availability === "unavailable" ? null : input);

  return {
    generatedAt: view.asOf,
    source: {
      tables: ["op_publications", "op_publication_settlements", "op_publication_revisions"],
      recordClass: "official_public_pick",
      availability: view.availability,
      presentation: view.presentation,
      lastKnownGoodAt: view.lastKnownGoodAt,
      truncated: summary.truncated
    },
    context: exportFilterContext(view),
    coverage: view.coverage.sentence,
    ledgerSpan: view.ledgerSpan,
    warnings,
    summary: Object.fromEntries(metricPairs(view)),
    summaryValues: {
      published: knownCount(summary.published),
      settled: knownCount(summary.settled),
      pending: knownCount(summary.pending),
      won: knownCount(summary.won),
      lost: knownCount(summary.lost),
      push: knownCount(summary.push),
      void: knownCount(summary.voided),
      cancelled: knownCount(summary.cancelled),
      decided: knownCount(summary.decided),
      profitUnits: summary.profitUnits.value,
      roi: summary.roi.value,
      hitRate: summary.hitRate.value,
      hitRateIntervalLow: summary.hitRateInterval?.low ?? null,
      hitRateIntervalHigh: summary.hitRateInterval?.high ?? null,
      averagePublishedOdds: summary.averagePublishedOdds.value,
      averageClosingOdds: summary.averageClosingOdds.value,
      closingCoverage: summary.closingCoverage.value,
      closingCoverageCount: summary.closingCoverageCount,
      averageClosingLineValue: summary.averageClosingLineValue.value,
      currentStreakLength: summary.currentStreak.length,
      currentDrawdownUnits: summary.currentDrawdownUnits.value,
      maxDrawdownUnits: summary.maxDrawdownUnits.value,
      brierScore: summary.forecast.brierScore.value,
      logLoss: summary.forecast.logLoss.value,
      expectedCalibrationError: summary.forecast.expectedCalibrationError.value,
      brierSkill: summary.forecast.brierSkill.value
    },
    definitions: TRACK_RECORD_METRIC_DEFINITIONS,
    bandDefinitions: trackRecordBandDefinitions(),
    notes: TRACK_RECORD_EXPORT_NOTES,
    rowCount: view.page.rows.length,
    rows: view.page.rows
  };
}

/** Filename stem for either format. Carries the period so files stay distinct. */
export function trackRecordExportFilename(view: TrackRecordView, extension: "csv" | "json"): string {
  const period = view.period.id;
  const stamp = view.asOf.slice(0, 10);
  return `oddspadi-track-record-${period}-${stamp}.${extension}`;
}
