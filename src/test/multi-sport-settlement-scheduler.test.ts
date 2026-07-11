import { describe, expect, it, vi } from "vitest";
import { runMultiSportSettlementSweep } from "../../netlify/functions/multi-sport-settlement-sweep";
import { runMultiSportSettlementWorker } from "../../netlify/functions/multi-sport-settlement-worker-background";

describe("multi-sport settlement scheduler", () => {
  it("queues the authenticated background worker", async () => {
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(new URL(String(input)).pathname).toBe("/.netlify/functions/multi-sport-settlement-worker-background");
      expect(new Headers(init?.headers).get("x-oddspadi-schedule-token")).toBe("admin-token");
      return Response.json({ success: true, queued: true }, { status: 202 });
    });
    const response = await runMultiSportSettlementSweep({ siteUrl: "https://oddspadi.example", adminToken: "admin-token", fetchImpl });
    expect(response.status).toBe(202);
  });

  it("settles outcomes and feature labels for basketball and tennis with one bounded limit", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(`${url.pathname}:${url.searchParams.get("sport")}`);
      expect(url.searchParams.get("limit")).toBe("80");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-oddspadi-admin-token")).toBe("admin-token");
      return Response.json({ success: true, data: { status: "no-pending" } });
    });
    const response = await runMultiSportSettlementWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "admin-token",
      limit: "80",
      fetchImpl
    });
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      "/api/sports/decision/autonomous-settlement:basketball",
      "/api/sports/decision/training/multi-sport-live-settlement-label-receipt:basketball",
      "/api/sports/decision/autonomous-settlement:tennis",
      "/api/sports/decision/training/multi-sport-live-settlement-label-receipt:tennis"
    ]);
  });

  it("rejects an invalid scheduler token", async () => {
    const fetchImpl = vi.fn();
    const response = await runMultiSportSettlementWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "wrong-token",
      fetchImpl
    });
    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
