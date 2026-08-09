import { describe, expect, it } from "vitest";
import { serviceTargets, serviceTarget, meetsTarget } from "@/lib/ops/serviceTargets";

describe("service-level targets", () => {
  it("defines the eight named operational targets with defaults", () => {
    const ids = serviceTargets({}).map((t) => t.id);
    for (const required of [
      "stale_card_rate",
      "result_verification_delay",
      "settlement_delay",
      "closing_price_coverage",
      "mapping_review_time",
      "high_priority_incident_response",
      "community_report_response",
      "content_correction_time"
    ]) {
      expect(ids, `missing ${required}`).toContain(required);
    }
    expect(ids.length).toBe(8);
  });

  it("never measures the operation on prediction win rate", () => {
    for (const t of serviceTargets({})) {
      expect(t.id).not.toMatch(/win|hit_?rate|roi|yield|brier/i);
      expect(t.name).not.toMatch(/win rate|hit rate/i);
    }
  });

  it("applies a JSON override and ignores unknown keys and bad values", () => {
    const env = { ODDSPADI_OPS_SLA_OVERRIDES: JSON.stringify({ settlement_delay: 45, bogus: 9, closing_price_coverage: "x" }) };
    expect(serviceTarget("settlement_delay", env)?.target).toBe(45);
    // Unchanged: the bad string value falls back to the default 90.
    expect(serviceTarget("closing_price_coverage", env)?.target).toBe(90);
  });

  it("falls back to defaults when the override is malformed JSON", () => {
    const env = { ODDSPADI_OPS_SLA_OVERRIDES: "{not json" };
    expect(serviceTarget("settlement_delay", env)?.target).toBe(60);
  });

  it("checks a value against its target in the right direction; unknown is null", () => {
    // settlement_delay: lower is better, default 60.
    expect(meetsTarget("settlement_delay", 45, {})).toBe(true);
    expect(meetsTarget("settlement_delay", 90, {})).toBe(false);
    // closing_price_coverage: higher is better, default 90.
    expect(meetsTarget("closing_price_coverage", 95, {})).toBe(true);
    expect(meetsTarget("closing_price_coverage", 80, {})).toBe(false);
    expect(meetsTarget("settlement_delay", null, {})).toBeNull();
    expect(meetsTarget("nope", 1, {})).toBeNull();
  });
});
