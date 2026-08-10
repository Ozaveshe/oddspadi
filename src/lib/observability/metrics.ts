/**
 * Production observability registry.
 *
 * The single typed source of truth for the operational signals OddsPadi
 * watches — each with a warn/page threshold and the source it is read from.
 * Docs (docs/production-observability.md) and any future emitter read this,
 * so a threshold is stated once and never drifts between code and runbook.
 */

export type MetricUnit = "ms" | "minutes" | "percent" | "count" | "ratio";

export type ObservabilityMetric = {
  /** Stable key. */
  id: string;
  /** Human name. */
  name: string;
  unit: MetricUnit;
  /** Warn threshold — investigate. */
  warn: number;
  /** Page threshold — wake someone. */
  page: number;
  /** Where the value is read from. */
  source: string;
  /** true when a HIGHER value is worse (latency, lag); false when lower is worse (coverage, availability). */
  higherIsWorse: boolean;
};

export const OBSERVABILITY_METRICS: readonly ObservabilityMetric[] = [
  { id: "public_read_latency_p95", name: "Public read latency (p95)", unit: "ms", warn: 800, page: 2500, source: "scripts/load-test-public-reads.mjs / route budgets", higherIsWorse: true },
  { id: "route_failure_rate", name: "Route failure rate", unit: "percent", warn: 1, page: 10, source: "reconciler route_error_spike / withApiHandler logs", higherIsWorse: true },
  { id: "projection_age", name: "Projection age", unit: "minutes", warn: 15, page: 60, source: "op_public_projections.built_at (readProjection)", higherIsWorse: true },
  { id: "fixture_import_lag", name: "Fixture import lag", unit: "minutes", warn: 120, page: 360, source: "op_fixtures.last_synced_at", higherIsWorse: true },
  { id: "odds_import_lag", name: "Odds import lag", unit: "minutes", warn: 90, page: 240, source: "op_odds_snapshots.observed_at", higherIsWorse: true },
  { id: "model_run_lag", name: "Model-run lag", unit: "minutes", warn: 60, page: 120, source: "op_provider_ingestion_runs (production-reconcile / decision-cycle)", higherIsWorse: true },
  { id: "settlement_lag", name: "Settlement lag", unit: "minutes", warn: 60, page: 240, source: "op_publications.settlement_status vs op_fixture_results.final_at", higherIsWorse: true },
  { id: "closing_line_coverage", name: "Closing-line coverage", unit: "percent", warn: 90, page: 80, source: "op_closing_prices captured / eligible publications", higherIsWorse: false },
  { id: "reconciliation_errors", name: "Reconciliation errors", unit: "count", warn: 1, page: 1, source: "op_settlement_exceptions kind='reconciler_*' state='open'", higherIsWorse: true },
  { id: "identity_failures", name: "Identity failures", unit: "count", warn: 1, page: 5, source: "op_settlement_exceptions kind IN (close_identity_failure, missing_participant_identity)", higherIsWorse: true },
  { id: "stale_card_rate", name: "Stale-card rate", unit: "percent", warn: 2, page: 10, source: "slate rows with data availability 'stale' / total", higherIsWorse: true },
  { id: "contradiction_count", name: "Contradiction count", unit: "count", warn: 1, page: 1, source: "prohibited-contradictions.test.tsx (CI gate)", higherIsWorse: true },
  { id: "moderation_backlog", name: "Community moderation backlog", unit: "count", warn: 20, page: 100, source: "op_content_reports state='open'", higherIsWorse: true },
  { id: "content_validation_failures", name: "Content validation failures", unit: "count", warn: 1, page: 5, source: "editorial-generation validation-blocked log", higherIsWorse: true }
] as const;

export function metric(id: string): ObservabilityMetric | null {
  return OBSERVABILITY_METRICS.find((m) => m.id === id) ?? null;
}

/**
 * Classify a reading against its thresholds. `null` reading is `unknown`, never
 * a false "ok" — an unread signal is not a healthy signal.
 */
export function classifyMetric(id: string, value: number | null): "ok" | "warn" | "page" | "unknown" {
  const m = metric(id);
  if (!m || value === null || !Number.isFinite(value)) return "unknown";
  const breaches = (threshold: number) => (m.higherIsWorse ? value >= threshold : value <= threshold);
  if (breaches(m.page)) return "page";
  if (breaches(m.warn)) return "warn";
  return "ok";
}
