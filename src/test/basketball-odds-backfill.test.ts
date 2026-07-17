import { describe, expect, it, vi } from "vitest";
import { runBasketballOddsBackfill } from "@/lib/sports/training/basketballOddsBackfill";
import type { BasketballOddsAttachmentResult } from "@/lib/sports/training/basketballOddsAttachment";

function attachmentResult(status: BasketballOddsAttachmentResult["status"], requestCost = 10): BasketballOddsAttachmentResult {
  return {
    status,
    configured: true,
    dryRun: status !== "stored",
    provider: "the-odds-api",
    endpoint: "https://api.the-odds-api.com/v4/historical/sports/basketball_nba/odds/?apiKey=REDACTED",
    fetched: 8,
    normalizedEvents: 8,
    matchedFixtures: 7,
    oddsRows: 28,
    rowsWritten: status === "stored" ? 28 : 0,
    quota: { requestCost, requestsUsed: 100, requestsRemaining: 900 },
    unmatchedEvents: [],
    sampleMatches: []
  };
}

describe("basketball historical odds backfill", () => {
  it("plans a resumable checkpoint without spending provider credits", async () => {
    const attach = vi.fn();
    const result = await runBasketballOddsBackfill({
      request: {
        from: "2024-02-01",
        to: "2024-02-10",
        run: false,
        maxJobs: 7,
        maxCredits: 30,
        regions: "us"
      },
      completedDates: new Set(["2024-02-01T12:00:00Z"]),
      attachImpl: attach
    });

    expect(result.status).toBe("planned");
    expect(result.candidateJobs).toBe(10);
    expect(result.skippedCompletedJobs).toBe(1);
    expect(result.plannedJobs).toBe(3);
    expect(result.quotaGuard.estimatedCreditsPlanned).toBe(30);
    expect(result.nextCursor).toBe("2024-02-02T12:00:00Z");
    expect(result.truncated).toBe(true);
    expect(attach).not.toHaveBeenCalled();
  });

  it("executes only the bounded checkpoint and reports observed quota", async () => {
    const attach = vi.fn(async () => attachmentResult("stored", 10));
    const result = await runBasketballOddsBackfill({
      request: {
        from: "2024-02-01",
        to: "2024-02-05",
        run: true,
        dryRun: false,
        maxJobs: 2,
        maxCredits: 20
      },
      completedDates: new Set(),
      attachImpl: attach
    });

    expect(result.status).toBe("stored");
    expect(result.executedJobs).toBe(2);
    expect(result.storedJobs).toBe(2);
    expect(result.quotaGuard.observedCreditsUsed).toBe(20);
    expect(result.nextCursor).toBe("2024-02-03T12:00:00Z");
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed request as the continuation cursor", async () => {
    const failed = { ...attachmentResult("provider-error", 10), reason: "quota exhausted" };
    const result = await runBasketballOddsBackfill({
      request: { from: "2024-02-01", to: "2024-02-03", run: true, maxJobs: 3, maxCredits: 30 },
      completedDates: new Set(),
      attachImpl: vi.fn(async () => failed)
    });

    expect(result.status).toBe("failed");
    expect(result.executedJobs).toBe(1);
    expect(result.nextCursor).toBe("2024-02-01T12:00:00Z");
  });
});
