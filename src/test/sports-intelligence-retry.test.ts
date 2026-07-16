import { describe, expect, it } from "vitest";
import { shouldRunFullCycle } from "../../netlify/functions/sports-intelligence-worker-background";

describe("sports intelligence full-cycle retry", () => {
  const now = new Date("2026-07-16T06:25:00.000Z");

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
});
