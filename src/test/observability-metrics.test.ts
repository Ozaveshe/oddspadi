import { describe, expect, it } from "vitest";
import { OBSERVABILITY_METRICS, metric, classifyMetric } from "@/lib/observability/metrics";

describe("observability registry", () => {
  it("registers all fourteen operational signals the spec names", () => {
    const ids = OBSERVABILITY_METRICS.map((m) => m.id);
    for (const required of [
      "public_read_latency_p95", "route_failure_rate", "projection_age", "fixture_import_lag",
      "odds_import_lag", "model_run_lag", "settlement_lag", "closing_line_coverage",
      "reconciliation_errors", "identity_failures", "stale_card_rate", "contradiction_count",
      "moderation_backlog", "content_validation_failures"
    ]) {
      expect(ids, `missing metric ${required}`).toContain(required);
    }
    expect(ids.length).toBe(14);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("every metric carries a source and warn <= page ordering by direction", () => {
    for (const m of OBSERVABILITY_METRICS) {
      expect(m.source.length).toBeGreaterThan(0);
      // For higher-is-worse, page >= warn; for lower-is-worse, page <= warn.
      if (m.higherIsWorse) expect(m.page).toBeGreaterThanOrEqual(m.warn);
      else expect(m.page).toBeLessThanOrEqual(m.warn);
    }
  });

  it("classifies latency and coverage in the right direction; unread is unknown", () => {
    expect(classifyMetric("public_read_latency_p95", 500)).toBe("ok");
    expect(classifyMetric("public_read_latency_p95", 1000)).toBe("warn");
    expect(classifyMetric("public_read_latency_p95", 3000)).toBe("page");
    // Coverage: lower is worse.
    expect(classifyMetric("closing_line_coverage", 95)).toBe("ok");
    expect(classifyMetric("closing_line_coverage", 85)).toBe("warn");
    expect(classifyMetric("closing_line_coverage", 70)).toBe("page");
    // An unread signal is never a false ok.
    expect(classifyMetric("projection_age", null)).toBe("unknown");
    expect(classifyMetric("nope", 1)).toBe("unknown");
  });

  it("resolves a metric by id", () => {
    expect(metric("settlement_lag")?.unit).toBe("minutes");
    expect(metric("ghost")).toBeNull();
  });
});
