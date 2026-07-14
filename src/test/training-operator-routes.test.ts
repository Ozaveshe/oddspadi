import { afterEach, describe, expect, it } from "vitest";
import { POST as backfill } from "@/app/api/sports/decision/training/backfill/route";
import { GET as storageReceipt } from "@/app/api/sports/decision/training/historical-provider-storage-receipt/route";
import { POST as providerSync } from "@/app/api/sports/decision/training/provider-sync/route";
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

  it("blocks receipt execution without a token while retaining a non-executing preview contract", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "correct-token";
    const response = await storageReceipt(new Request("http://localhost/api/sports/decision/training/historical-provider-storage-receipt?provider=api-football&dryRun=1&run=1"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ success: false });
  });
});
