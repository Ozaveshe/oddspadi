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
    const runRuntimeReplay = vi.fn();
    const response = await runModelLearningCycle({
      scheduleToken: "same",
      adminToken: "same",
      runCalibration,
      runRuntimeReplay,
      now: new Date("2026-07-17T03:45:00.000Z")
    });
    const body = await response.json() as { success: boolean; controls: { automaticLivePromotion: boolean }; results: Array<{ sport: string }> };
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.controls.automaticLivePromotion).toBe(false);
    expect(body.results.map((row) => row.sport)).toEqual(["football", "basketball", "tennis"]);
    expect(runCalibration).toHaveBeenCalledTimes(3);
    expect(runRuntimeReplay).not.toHaveBeenCalled();
  });

  it("stores exact runtime replay evidence on the weekly learning window before calibration", async () => {
    const runCalibration = vi.fn(async (sport: string) => ({ status: "stored" as const, configured: true, id: `${sport}-calibration` }));
    const runRuntimeReplay = vi.fn(async (sport: string) => ({
      status: "stored" as const,
      configured: true as const,
      id: `${sport}-runtime-replay`,
      result: { sport }
    }) as never);
    const response = await runModelLearningCycle({
      scheduleToken: "same",
      adminToken: "same",
      runCalibration,
      runRuntimeReplay,
      now: new Date("2026-07-20T03:45:00.000Z")
    });
    const body = await response.json() as {
      success: boolean;
      controls: { weeklyRuntimeParityBacktests: boolean; automaticLivePromotion: boolean };
      results: Array<{ sport: string; runtimeReplay: { status: string } }>;
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.controls.weeklyRuntimeParityBacktests).toBe(true);
    expect(body.controls.automaticLivePromotion).toBe(false);
    expect(runRuntimeReplay.mock.calls.map(([sport]) => sport)).toEqual(["football", "basketball", "tennis"]);
    expect(runCalibration).toHaveBeenCalledTimes(3);
    expect(body.results.every((row) => row.runtimeReplay.status === "stored")).toBe(true);
  });
});
