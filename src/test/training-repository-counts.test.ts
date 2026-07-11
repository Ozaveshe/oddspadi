import { describe, expect, it } from "vitest";
import { realRowCount, runWithConcurrency } from "@/lib/sports/training/trainingRepository";

describe("training corpus real-row counts", () => {
  it("derives non-demo evidence from stable total and demo counts", () => {
    expect(realRowCount(220_893, 480)).toBe(220_413);
    expect(realRowCount(6_160, 80)).toBe(6_080);
  });

  it("never reports a negative real-row count when a source count is malformed", () => {
    expect(realRowCount(0, 0)).toBe(0);
    expect(realRowCount(5, 8)).toBe(0);
  });

  it("keeps database count requests bounded while preserving task order", async () => {
    let active = 0;
    let peak = 0;
    const results = await runWithConcurrency(
      Array.from({ length: 7 }, (_, index) => async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return index;
      }),
      2
    );

    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
