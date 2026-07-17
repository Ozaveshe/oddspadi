import { afterEach, describe, expect, it } from "vitest";
import { POST as backfill } from "@/app/api/sports/decision/training/backfill/route";
import { GET as storageReceipt, POST as executeStorageReceipt } from "@/app/api/sports/decision/training/historical-provider-storage-receipt/route";
import { POST as providerSync } from "@/app/api/sports/decision/training/provider-sync/route";
import { GET as inspectBacktest, POST as runBacktest } from "@/app/api/sports/decision/training/multi-sport-backtest-run/route";
import { GET as inspectRuntimeReplay, POST as storeRuntimeReplay } from "@/app/api/sports/decision/training/football-runtime-replay/route";
import { POST as runCalibration } from "@/app/api/sports/decision/training/calibration/route";
import { POST as promoteCalibration } from "@/app/api/sports/decision/training/calibration-promotion/route";
import { isTrainingAdminAuthorized } from "@/lib/sports/training/adminAuth";

const originalToken = process.env.ODDSPADI_ADMIN_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.ODDSPADI_ADMIN_TOKEN;
  else process.env.ODDSPADI_ADMIN_TOKEN = originalToken;
});

describe("historical training operator routes", () => {
  it("uses constant-time admin-token comparison and rejects missing or incorrect tokens", () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "correct-token";
    expect(isTrainingAdminAuthorized(new Request("http://localhost/test"))).toBe(false);
    expect(isTrainingAdminAuthorized(new Request("http://localhost/test", { headers: { "x-oddspadi-admin-token": "wrong-token" } }))).toBe(false);
    expect(isTrainingAdminAuthorized(new Request("http://localhost/test", { headers: { "x-oddspadi-admin-token": "correct-token" } }))).toBe(true);
  });

  it("blocks provider calls and historical backfills before any credential-protected work", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "correct-token";
    const providerResponse = await providerSync(new Request("http://localhost/api/sports/decision/training/provider-sync?provider=api-football", { method: "POST" }));
    const backfillResponse = await backfill(new Request("http://localhost/api/sports/decision/training/backfill?provider=api-football", { method: "POST" }));
    expect(providerResponse.status).toBe(401);
    expect(backfillResponse.status).toBe(401);
  });

  it("blocks backtest, calibration and promotion writes before any storage work", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "correct-token";
    const requests = [
      runBacktest(new Request("http://localhost/api/sports/decision/training/multi-sport-backtest-run?sport=football", { method: "POST" })),
      storeRuntimeReplay(new Request("http://localhost/api/sports/decision/training/football-runtime-replay", { method: "POST" })),
      runCalibration(new Request("http://localhost/api/sports/decision/training/calibration?sport=football", { method: "POST" })),
      promoteCalibration(new Request("http://localhost/api/sports/decision/training/calibration-promotion", { method: "POST" }))
    ];
    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401]);
  });

  it("rejects legacy GET execution switches even when an admin token is valid", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "correct-token";
    const response = await inspectBacktest(
      new Request("http://localhost/api/sports/decision/training/multi-sport-backtest-run?sport=football&run=1", { headers: { "x-oddspadi-admin-token": "correct-token" } })
    );
    expect(response.status).toBe(405);
    const receiptResponse = await storageReceipt(
      new Request("http://localhost/api/sports/decision/training/historical-provider-storage-receipt?provider=api-football&dryRun=0&run=1", { headers: { "x-oddspadi-admin-token": "correct-token" } })
    );
    expect(receiptResponse.status).toBe(405);
    const runtimeResponse = await inspectRuntimeReplay(
      new Request("http://localhost/api/sports/decision/training/football-runtime-replay")
    );
    expect(runtimeResponse.status).toBe(401);
  });

  it("blocks POST receipt execution without a token", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "correct-token";
    const response = await executeStorageReceipt(new Request("http://localhost/api/sports/decision/training/historical-provider-storage-receipt?provider=api-football&dryRun=1&run=1", { method: "POST" }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ success: false });
  });
});
