import { afterEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/_archived/api-sports-decision/training/football-provider-live-feature-storage-receipt/route";

describe("football live feature storage route authorization", () => {
  afterEach(() => {
    delete process.env.ODDSPADI_ADMIN_TOKEN;
  });

  it("keeps GET read-only even when write parameters are supplied", async () => {
    const response = await GET(
      new Request(
        "http://127.0.0.1:3025/api/sports/decision/training/football-provider-live-feature-storage-receipt?date=2026-08-21&run=1&dryRun=0"
      )
    );

    expect(response.status).toBe(405);
  });

  it("requires explicit write mode on POST", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "test-admin-token";
    const response = await POST(
      new Request(
        "http://127.0.0.1:3025/api/sports/decision/training/football-provider-live-feature-storage-receipt?date=2026-08-21&dryRun=1",
        { method: "POST", headers: { "x-oddspadi-admin-token": "test-admin-token" } }
      )
    );

    expect(response.status).toBe(400);
  });

  it("rejects unauthenticated POST writes before provider work starts", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "test-admin-token";
    const response = await POST(
      new Request(
        "http://127.0.0.1:3025/api/sports/decision/training/football-provider-live-feature-storage-receipt?date=2026-08-21&run=1&dryRun=0",
        { method: "POST" }
      )
    );

    expect(response.status).toBe(401);
  });
});
