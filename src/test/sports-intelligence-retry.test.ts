import { describe, expect, it } from "vitest";
import { runSportsIntelligenceCycle, shouldRunFullCycle } from "../../netlify/functions/sports-intelligence-worker-background";
import { config as sweepConfig } from "../../netlify/functions/sports-intelligence-sweep";

describe("sports intelligence full-cycle retry", () => {
  const now = new Date("2026-07-16T06:25:00.000Z");

  it("refreshes odds inside the narrowest public freshness boundary", () => {
    expect(sweepConfig.schedule).toBe("25,55 * * * *");
  });

  it("retries after the configured hour when today's weekly receipt is missing or stale", () => {
    expect(shouldRunFullCycle({ requested: false, now, fullRunHour: 2, latestWeeklyRun: null })).toBe(true);
    expect(shouldRunFullCycle({ requested: false, now, fullRunHour: 2, latestWeeklyRun: { status: "completed", finishedAt: "2026-07-15T02:30:00.000Z" } })).toBe(true);
  });

  it("does not duplicate a current-day running or completed full cycle", () => {
    expect(shouldRunFullCycle({ requested: false, now, fullRunHour: 2, latestWeeklyRun: { status: "running", startedAt: "2026-07-16T06:20:00.000Z" } })).toBe(false);
    expect(shouldRunFullCycle({ requested: false, now, fullRunHour: 2, latestWeeklyRun: { status: "completed", finishedAt: "2026-07-16T02:30:00.000Z" } })).toBe(false);
  });

  it("honours an explicit full-cycle request before the scheduled hour", () => {
    expect(shouldRunFullCycle({ requested: true, now: new Date("2026-07-16T00:25:00.000Z"), fullRunHour: 2, latestWeeklyRun: null })).toBe(true);
  });

  it("executes full-cycle pipeline operations directly and in order", async () => {
    const calls: string[] = [];
    const result = (jobType: string) => async () => {
      calls.push(jobType);
      return { run: { jobType, status: "completed" } } as never;
    };
    const stages = await runSportsIntelligenceCycle(true, {
      importFixtures: result("import-fixtures"),
      refreshOdds: result("refresh-odds"),
      runDailyEngine: result("run-daily-engine"),
      generateWeeklyPredictions: result("generate-weekly-predictions")
    });

    expect(calls).toEqual(["import-fixtures", "refresh-odds", "run-daily-engine", "generate-weekly-predictions"]);
    expect(stages.every((stage) => stage.ok)).toBe(true);
  });

  it("refreshes today's decisions on bounded odds-only schedule ticks", async () => {
    const calls: string[] = [];
    const result = (jobType: string) => async () => {
      calls.push(jobType);
      return { run: { jobType, status: "completed" } } as never;
    };

    await runSportsIntelligenceCycle(false, {
      importFixtures: result("import-fixtures"),
      refreshOdds: result("refresh-odds"),
      runDailyEngine: result("run-daily-engine"),
      generateWeeklyPredictions: result("generate-weekly-predictions")
    });

    expect(calls).toEqual(["refresh-odds", "run-daily-engine"]);
  });
});
