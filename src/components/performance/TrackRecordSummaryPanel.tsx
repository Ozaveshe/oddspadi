import { LocalTimeText } from "@/components/odds/LocalTime";
import { formatMetric } from "@/lib/performance/ledgerMetrics";
import { describeStreak, formatPrice, formatUnits } from "@/lib/performance/trackRecordSummary";
import type { TrackRecordView } from "@/lib/performance/trackRecordView";

/**
 * The headline block.
 *
 * Every tile prints `formatMetric` or one of its siblings, which return
 * "Not available", "Not applicable" or "Insufficient sample (n)" rather than a
 * number when there is no measurement. No tile in this component can render a
 * bare `0` for a metric that was never measured, because no tile reads
 * `.value` directly.
 *
 * The counts are different: a count of zero settled picks is a real
 * measurement, and it is printed — but only after the caller has established
 * that the read succeeded. When it did not, the whole panel is replaced by the
 * unavailable notice.
 */
export function TrackRecordSummaryPanel({ view, compact = false }: { view: TrackRecordView; compact?: boolean }) {
  const summary = view.summary;

  if (view.presentation === "unavailable") {
    return (
      <div className="empty-state track-record-unavailable">
        <h2>The publication ledger could not be read</h2>
        <p className="muted">
          No record is shown for this period. This is not a zero: we could not ask the ledger, so we do not know what it
          would have said.
        </p>
      </div>
    );
  }

  if (summary.published === 0) {
    return (
      <div className="empty-state track-record-empty-period">
        <h2>No official picks were published in this period</h2>
        <p className="muted">{view.coverage.sentence}</p>
        <p className="small muted">
          An empty period is not a result. There is no hit rate, no yield and no profit to report, because there was
          nothing to report on.
        </p>
      </div>
    );
  }

  const headline = [
    { label: "Published", value: String(summary.published) },
    { label: "Settled", value: String(summary.settled) },
    { label: "Pending", value: String(summary.pending) },
    { label: "Won", value: String(summary.won) },
    { label: "Lost", value: String(summary.lost) },
    { label: "Push", value: String(summary.push) },
    { label: "Void", value: String(summary.voided + summary.cancelled) },
    { label: "Hit rate", value: formatMetric(summary.hitRate, "percent") },
    { label: "Profit", value: formatUnits(summary.profitUnits) },
    { label: "ROI / yield", value: formatMetric(summary.roi, "signed-percent") }
  ];

  const detail = [
    { label: "Average odds", value: formatPrice(summary.averagePublishedOdds) },
    { label: "Average close", value: formatPrice(summary.averageClosingOdds) },
    { label: "Closing coverage", value: formatMetric(summary.closingCoverage, "percent") },
    { label: "Average CLV", value: formatMetric(summary.averageClosingLineValue, "signed-percent") },
    { label: "Current streak", value: describeStreak(summary.currentStreak) },
    { label: "Current drawdown", value: formatUnits(summary.currentDrawdownUnits) },
    { label: "Max drawdown", value: formatUnits(summary.maxDrawdownUnits) }
  ];

  const tiles = compact ? headline : [...headline, ...detail];

  return (
    <div className="track-record-summary">
      <div className="metrics-grid results-metrics">
        {tiles.map((tile) => (
          <div className="metric" key={tile.label}>
            <span className="metric-label">{tile.label}</span>
            <span className="metric-value">{tile.value}</span>
          </div>
        ))}
      </div>

      {summary.hitRateInterval ? (
        <p className="small muted">
          95% Wilson interval on the hit rate: {(summary.hitRateInterval.low * 100).toFixed(1)}% to{" "}
          {(summary.hitRateInterval.high * 100).toFixed(1)}%. The interval, not the point estimate, is the honest width
          of what {summary.decided} settled pick{summary.decided === 1 ? "" : "s"} can tell you.
        </p>
      ) : null}

      {summary.smallSampleWarning ? <p className="muted small">{summary.smallSampleWarning}</p> : null}

      <p className="small muted">
        Closing prices are held for {summary.closingCoverageCount} of {summary.published} publication
        {summary.published === 1 ? "" : "s"} in this view. Average closing odds and CLV are computed over those rows only
        and are reported as not available when there are none — a closing-line value of zero would be a claim about the
        model rather than about our data.
      </p>

      <p className="small muted">
        Last settlement:{" "}
        {summary.lastSettlementAt ? (
          <LocalTimeText iso={summary.lastSettlementAt} variant="datetime" />
        ) : (
          "nothing in this view has settled yet"
        )}
        .
      </p>

      <p className="small muted">
        Hit rate, profit, yield, CLV and drawdown judge a selection at its price. Brier score and calibration judge the
        probability. They answer different questions and are never combined into one headline.
      </p>

      {summary.truncated ? (
        <p className="small muted">
          This period holds more publications than a single page will sweep. The figures above cover the most recent
          rows; use the CSV or JSON export for the complete period.
        </p>
      ) : null}
    </div>
  );
}

/** The forecast half, kept in its own block so it can never be added to the above. */
export function TrackRecordForecastPanel({ view }: { view: TrackRecordView }) {
  const forecast = view.summary.forecast;
  if (view.presentation === "unavailable") return null;
  return (
    <div className="metrics-grid results-metrics">
      <div className="metric">
        <span className="metric-label">Brier score</span>
        <span className="metric-value">{formatMetric(forecast.brierScore, "decimal")}</span>
      </div>
      <div className="metric">
        <span className="metric-label">Log loss</span>
        <span className="metric-value">{formatMetric(forecast.logLoss, "decimal")}</span>
      </div>
      <div className="metric">
        <span className="metric-label">Calibration error</span>
        <span className="metric-value">{formatMetric(forecast.expectedCalibrationError, "decimal")}</span>
      </div>
      <div className="metric">
        <span className="metric-label">Brier skill</span>
        <span className="metric-value">{formatMetric(forecast.brierSkill, "decimal")}</span>
      </div>
    </div>
  );
}
