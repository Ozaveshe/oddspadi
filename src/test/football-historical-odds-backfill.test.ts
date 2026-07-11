import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/_archived/api-sports-decision/training/football-historical-odds-backfill/route";
import {
  buildFootballHistoricalOddsBackfillPlan,
  footballHistoricalOddsCheckpointKey,
  runFootballHistoricalOddsBackfill
} from "@/lib/sports/training/footballHistoricalOddsBackfill";
import type { FootballOddsAttachmentResult } from "@/lib/sports/training/footballOddsAttachment";
import type { HistoricalFootballFixtureInput } from "@/lib/sports/training/historicalIngestion";
import type { StoredFootballProviderFixtures } from "@/lib/sports/training/footballProviderFeatureCorpusRepository";

function fixture(
  externalId: string,
  kickoffAt: string,
  { season = "2021", round = "Regular Season - 1" }: { season?: string; round?: string } = {}
): HistoricalFootballFixtureInput {
  return {
    sport: "football",
    externalId,
    kickoffAt,
    league: { externalId: "api-football:39", name: "Premier League" },
    season,
    round,
    status: "finished",
    homeTeam: { externalId: `${externalId}:home`, name: `${externalId} Home` },
    awayTeam: { externalId: `${externalId}:away`, name: `${externalId} Away` },
    homeScore: 1,
    awayScore: 0
  };
}

function corpus(fixtures: HistoricalFootballFixtureInput[]): StoredFootballProviderFixtures {
  return {
    provider: "api_football",
    fixtures,
    source: {
      kind: "supabase-raw-provider-payload",
      provider: "api_football",
      batchRows: 1,
      materializedBatches: 1,
      compactBatchesSkipped: 0,
      candidateFixtures: fixtures.length,
      duplicateFixtures: 0,
      invalidFixtures: 0,
      rawPayloadLinkedFixtures: fixtures.length,
      fixtureLimit: 500,
      batchIds: ["batch-1"],
      ingestionRunIds: ["run-1"],
      payloadHashes: ["hash-1"]
    }
  };
}

function attachmentResult(status: FootballOddsAttachmentResult["status"]): FootballOddsAttachmentResult {
  return {
    status,
    configured: true,
    dryRun: status === "dry-run",
    provider: "the-odds-api",
    endpoint: "https://api.the-odds-api.com/REDACTED",
    snapshotAt: "2021-08-14T13:45:00.000Z",
    fetched: 5,
    normalizedEvents: 5,
    matchedFixtures: 1,
    candidateMatchedFixtures: 1,
    closingRequested: true,
    closingWindowMinutes: 90,
    closingEligibleFixtures: 1,
    closingRejectedFixtures: 0,
    oddsRows: 30,
    rowsWritten: status === "stored" ? 30 : 0,
    unmatchedEvents: [],
    closingRejectedEvents: [],
    sampleMatches: []
  };
}

describe("football historical odds backfill", () => {
  afterEach(() => {
    delete process.env.ODDSPADI_ADMIN_TOKEN;
  });

  it("plans canonical opening and closing jobs with retention, quota, and resume guards", () => {
    const plan = buildFootballHistoricalOddsBackfillPlan({
      fixtures: [
        fixture("pre-coverage", "2019-08-10T14:00:00.000Z", { season: "2019" }),
        fixture("round-1-a", "2021-08-14T14:00:00.000Z"),
        fixture("round-1-b", "2021-08-14T16:30:00.000Z"),
        fixture("round-2-a", "2021-08-21T14:00:00.000Z", { round: "Regular Season - 2" })
      ],
      request: { mode: "both", maxJobs: 2, regions: "uk" }
    });

    expect(plan.execute).toBe(false);
    expect(plan.totalGeneratedJobs).toBe(7);
    expect(plan.skippedBeforeCoverage).toBe(2);
    expect(plan.totalCandidateJobs).toBe(5);
    expect(plan.jobs).toHaveLength(2);
    expect(plan.nextOffset).toBe(2);
    expect(plan.estimatedCreditsPerJob).toBe(10);
    expect(plan.estimatedCredits).toBe(20);
    expect(plan.totalEstimatedCredits).toBe(50);
    expect(plan.warnings).toContain("Plan-only mode is active. No The Odds API credits will be spent.");
  });

  it("does not call the odds provider while in plan-only mode", async () => {
    const attachmentRunner = vi.fn();
    const result = await runFootballHistoricalOddsBackfill({
      request: { mode: "both", execute: false },
      corpusReader: async () => corpus([fixture("fixture-1", "2021-08-14T14:00:00.000Z")]),
      completionReader: async () => ({ keys: [], rows: 0 }),
      attachmentRunner
    });

    expect(result.status).toBe("planned");
    expect(result.plan.jobs).toHaveLength(2);
    expect(result.executedJobs).toBe(0);
    expect(result.estimatedCreditsConsumed).toBe(0);
    expect(attachmentRunner).not.toHaveBeenCalled();
  });

  it("excludes completed snapshots from remaining credit estimates", () => {
    const fixtures = [fixture("fixture-1", "2021-08-14T14:00:00.000Z")];
    const initial = buildFootballHistoricalOddsBackfillPlan({ fixtures, request: { mode: "both", regions: "uk" } });
    const completed = initial.jobs[0]!;
    const resumed = buildFootballHistoricalOddsBackfillPlan({
      fixtures,
      request: { mode: "both", regions: "uk" },
      completedSnapshots: [footballHistoricalOddsCheckpointKey(completed.mode, completed.snapshotAt)],
      checkpointRows: 1
    });

    expect(resumed.completedJobs).toBe(1);
    expect(resumed.remainingCandidateJobs).toBe(1);
    expect(resumed.checkpointRows).toBe(1);
    expect(resumed.totalEstimatedCredits).toBe(10);
    expect(resumed.jobs.map((job) => job.id)).not.toContain(completed.id);
  });

  it("executes a capped closing job with the closing guard attached", async () => {
    const attachmentRunner = vi.fn(async () => attachmentResult("dry-run"));
    const result = await runFootballHistoricalOddsBackfill({
      request: { mode: "closing", execute: true, dryRun: true, maxJobs: 1, regions: "uk,eu" },
      corpusReader: async () => corpus([fixture("fixture-1", "2021-08-14T14:00:00.000Z")]),
      completionReader: async () => ({ keys: [], rows: 0 }),
      attachmentRunner
    });

    expect(result.status).toBe("dry-run");
    expect(result.executedJobs).toBe(1);
    expect(result.estimatedCreditsConsumed).toBe(20);
    expect(attachmentRunner).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ isClosing: true, closingWindowMinutes: 90 })
    }));
  });

  it("requires admin authorization before planning or spending credits", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "test-admin-token";
    const response = await POST(new Request(
      "http://127.0.0.1:3025/api/sports/decision/training/football-historical-odds-backfill?mode=both",
      { method: "POST" }
    ));
    expect(response.status).toBe(401);
  });
});
