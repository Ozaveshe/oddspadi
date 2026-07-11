import { describe, expect, it } from "vitest";
import { buildHistoricalProviderBackfillPlan } from "@/lib/sports/training/historicalBackfill";

describe("API-Football date-window historical backfill", () => {
  it("splits a season range into non-overlapping capped enrichment jobs", () => {
    const plan = buildHistoricalProviderBackfillPlan({
      provider: "api-football",
      league: "39",
      seasons: [2025],
      from: "2025-08-01",
      to: "2025-08-31",
      intervalDays: 14,
      includeEvents: true,
      includeContext: true,
      maxEventFixtures: 50,
      maxContextFixtures: 120,
      maxJobs: 10
    });

    expect(plan.errors).toEqual([]);
    expect(plan.totalCandidateJobs).toBe(3);
    expect(plan.jobs.map((job) => [job.request.from, job.request.to])).toEqual([
      ["2025-08-01", "2025-08-14"],
      ["2025-08-15", "2025-08-28"],
      ["2025-08-29", "2025-08-31"]
    ]);
    expect(plan.jobs.every((job) =>
      job.request.season === "2025" &&
      job.request.includeEvents === true &&
      job.request.includeContext === true &&
      job.request.maxEventFixtures === 50 &&
      job.request.maxContextFixtures === 120
    )).toBe(true);
  });

  it("keeps date-window execution bounded by maxJobs", () => {
    const plan = buildHistoricalProviderBackfillPlan({
      provider: "api-football",
      league: "39",
      seasons: [2025],
      from: "2025-08-01",
      to: "2025-08-31",
      intervalDays: 7,
      maxJobs: 2
    });

    expect(plan.totalCandidateJobs).toBe(5);
    expect(plan.jobs).toHaveLength(2);
    expect(plan.truncated).toBe(true);
  });
});
