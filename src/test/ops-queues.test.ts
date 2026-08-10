import { describe, expect, it } from "vitest";
import { MARKET_QUEUES, COMMUNITY_QUEUES, bucketCasesByQueue, type QueueCaseRow } from "@/lib/ops/queues";

describe("workspace queues", () => {
  it("names the market queues the brief asks for", () => {
    const ids = MARKET_QUEUES.map((q) => q.id);
    for (const required of [
      "stale_exceptions",
      "market_mapping",
      "result_verification",
      "settlement",
      "closing_price",
      "provider_incidents",
      "reconciliation_mismatches"
    ]) {
      expect(ids, `missing ${required}`).toContain(required);
    }
  });

  it("buckets active cases by category and shows every queue even at zero", () => {
    const cases: QueueCaseRow[] = [
      { category: "settlement_exception", state: "open" },
      { category: "settlement_exception", state: "in_progress" },
      { category: "missing_close", state: "open" },
      { category: "market_mismatch", state: "resolved" }, // terminal — excluded
      { category: "stale_odds", state: "waiting" }
    ];
    const counts = Object.fromEntries(bucketCasesByQueue(cases, MARKET_QUEUES).map((q) => [q.id, q.count]));
    expect(counts.settlement).toBe(2);
    expect(counts.closing_price).toBe(1);
    expect(counts.market_mapping).toBe(0); // the only one was resolved
    expect(counts.stale_exceptions).toBe(1); // stale_odds
    expect(counts.provider_incidents).toBe(0);
    // Every queue is present.
    expect(bucketCasesByQueue(cases, MARKET_QUEUES)).toHaveLength(MARKET_QUEUES.length);
  });

  it("buckets community cases into report / abuse / content queues", () => {
    const cases: QueueCaseRow[] = [
      { category: "user_report", state: "open" },
      { category: "community_abuse", state: "escalated" },
      { category: "community_abuse", state: "dismissed" } // terminal — excluded
    ];
    const counts = Object.fromEntries(bucketCasesByQueue(cases, COMMUNITY_QUEUES).map((q) => [q.id, q.count]));
    expect(counts.community_reports).toBe(1);
    expect(counts.community_abuse).toBe(1);
    expect(counts.content_errors).toBe(0);
  });

  it("never counts a case with a null category into any queue", () => {
    const counts = bucketCasesByQueue([{ category: null, state: "open" }], MARKET_QUEUES);
    expect(counts.every((q) => q.count === 0)).toBe(true);
  });
});
