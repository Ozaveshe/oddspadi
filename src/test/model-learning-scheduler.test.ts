import { describe, expect, it, vi } from "vitest";
import { runModelLearningCycle } from "../../netlify/functions/model-learning-worker-background";

describe("governed model learning schedule", () => {
  it("rejects an invalid schedule token before calibration starts", async () => {
    const runCalibration = vi.fn();
    const response = await runModelLearningCycle({ scheduleToken: "wrong", adminToken: "right", runCalibration });
    expect(response.status).toBe(401);
    expect(runCalibration).not.toHaveBeenCalled();
  });

  it("stores fresh calibration evidence for every live sport without auto-promoting", async () => {
    const runCalibration = vi.fn(async (sport: string) => ({
      status: "stored" as const,
      configured: true,
      id: `${sport}-run`,
      candidates: [{ status: "reused" as const, configured: true, table: "op_calibration_candidates" as const, id: `${sport}-candidate` }]
    }));
    const response = await runModelLearningCycle({ scheduleToken: "same", adminToken: "same", runCalibration });
    const body = await response.json() as { success: boolean; controls: { automaticLivePromotion: boolean }; results: Array<{ sport: string }> };
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.controls.automaticLivePromotion).toBe(false);
    expect(body.results.map((row) => row.sport)).toEqual(["football", "basketball", "tennis"]);
    expect(runCalibration).toHaveBeenCalledTimes(3);
  });
});
