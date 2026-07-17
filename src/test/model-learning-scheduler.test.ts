import { describe, expect, it, vi } from "vitest";
import { config } from "../../netlify/functions/model-learning-sweep";
import { runModelLearningCycle, runSerializedModelLearningCycle } from "../../netlify/functions/model-learning-worker-background";

const runningReceipt = {
  runId: "model-run-1",
  providerName: "oddspadi-model-governance",
  jobType: "model-learning",
  startedAt: "2026-07-20T04:15:00.000Z",
  finishedAt: null,
  status: "running" as const,
  fixturesFound: 0,
  oddsFound: 0,
  predictionsGenerated: 0,
  valuePicksPublished: 0,
  errors: []
};

describe("governed model learning schedule", () => {
  it("runs after the football corpus and main 04:25 intelligence windows instead of overlapping them", () => {
    expect(config.schedule).toBe("45 4 * * *");
  });

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

  it("fails closed when calibration was stored but its promotion candidate was not", async () => {
    const response = await runModelLearningCycle({
      scheduleToken: "same",
      adminToken: "same",
      sports: ["football"],
      runCalibration: vi.fn(async () => ({
        status: "stored" as const,
        configured: true,
        id: "calibration-run",
        candidates: [{
          status: "failed" as const,
          configured: true,
          table: "op_calibration_candidates" as const,
          reason: "candidate persistence failed"
        }]
      })),
      now: new Date("2026-07-17T04:45:00.000Z")
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ success: false });
  });

  it("skips before model writes when another sports pipeline receipt owns the global lock", async () => {
    const cycle = vi.fn();
    const response = await runSerializedModelLearningCycle({
      scheduleToken: "same",
      adminToken: "same",
      claimRun: vi.fn(async () => ({ acquired: false, run: { ...runningReceipt, jobType: "refresh-odds" } })),
      cycle
    });

    expect(response.status).toBe(409);
    expect(cycle).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ success: false, skippedOverlap: true });
  });

  it("finishes one durable model-learning receipt after a successful governed cycle", async () => {
    const finishRun = vi.fn(async (run, status, errors, finishedAt) => ({ ...run, status, errors, finishedAt }));
    const cycle = vi.fn(async () => Response.json({
      success: true,
      results: [
        { sport: "football", calibration: { status: "stored", reason: null }, runtimeReplay: { status: "not-due", reason: null } },
        { sport: "basketball", calibration: { status: "stored", reason: null }, runtimeReplay: { status: "not-due", reason: null } },
        { sport: "tennis", calibration: { status: "stored", reason: null }, runtimeReplay: { status: "not-due", reason: null } }
      ]
    }));
    const response = await runSerializedModelLearningCycle({
      scheduleToken: "same",
      adminToken: "same",
      now: new Date("2026-07-17T04:15:00.000Z"),
      claimRun: vi.fn(async () => ({ acquired: true, run: runningReceipt })),
      finishRun,
      cycle
    });

    expect(response.status).toBe(200);
    expect(finishRun).toHaveBeenCalledWith(runningReceipt, "completed", [], expect.any(String));
    await expect(response.json()).resolves.toMatchObject({ success: true, run: { status: "completed" } });
  });
});
