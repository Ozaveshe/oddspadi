import { describe, expect, it } from "vitest";
import { buildWeeklyRecap, runWeeklyRecap, type WeeklyRecapOutcome } from "../../netlify/functions/weekly-results-recap-worker-background";

const row = (result: string, odds: number, home: string): WeeklyRecapOutcome => ({ result, odds, home_team: home, away_team: "Rivals", recommended_selection: home, selection: "home" });

describe("weekly public-results recap", () => {
  it("keeps wins, losses, pushes and voids in one complete recap", () => {
    const generatedAt = new Date("2026-07-13T06:15:00Z");
    const recap = buildWeeklyRecap(
      [row("won", 2.4, "Best XI"), row("won", 1.8, "Second XI"), row("lost", 2.1, "Missed XI"), row("push", 1.9, "Push XI"), row("void", 2, "Void XI")],
      new Date("2026-07-06T00:00:00Z"),
      new Date("2026-07-13T00:00:00Z"),
      generatedAt
    );
    expect(recap).toMatchObject({ graded_count: 5, wins: 2, losses: 1, pushes: 1, voids: 1, accuracy: 2 / 3, best_call: "Best XI vs Rivals: Best XI" });
    expect(recap.roi).toBeCloseTo((2.4 + 1.8 - 3) / 3);
  });

  it("rejects an unauthorised scheduled invocation before database access", async () => {
    const response = await runWeeklyRecap({ scheduleToken: "wrong", adminToken: "right", supabaseUrl: null, supabaseKey: null });
    expect(response.status).toBe(401);
  });
});
