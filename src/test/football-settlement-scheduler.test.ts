import { describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/_archived/api-sports-decision/training/football-provider-live-settlement-label-receipt/route";
import { runFootballSettlementSweep } from "../../netlify/functions/football-settlement-sweep";
import { runFootballSettlementWorker } from "../../netlify/functions/football-settlement-worker-background";

describe("football settlement scheduler", () => {
  it("requires server-only scheduler configuration", async () => {
    const fetchImpl = vi.fn();
    const response = await runFootballSettlementSweep({ siteUrl: null, adminToken: null, fetchImpl });

    expect(response.status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("triggers the long-running background worker", async () => {
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/.netlify/functions/football-settlement-worker-background");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-oddspadi-schedule-token")).toBe("admin-token");
      return Response.json({ success: true, queued: true }, { status: 202 });
    });

    const response = await runFootballSettlementSweep({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      fetchImpl
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ success: true, queued: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("runs the provider settlement route inside the authenticated background worker", async () => {
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("limit")).toBe("250");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-oddspadi-admin-token")).toBe("admin-token");
      if (url.pathname === "/api/sports/decision/autonomous-settlement") {
        return Response.json({ success: true, data: { status: "no-pending" } });
      }
      expect(url.pathname).toBe("/api/sports/decision/training/football-provider-live-settlement-label-receipt");
      expect(url.searchParams.get("run")).toBe("1");
      expect(url.searchParams.get("dryRun")).toBe("0");
      return Response.json({ success: true, data: { status: "waiting-final-score" } });
    });

    const response = await runFootballSettlementWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "admin-token",
      fetchImpl
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      autonomousOutcomes: { status: 200, body: { success: true, data: { status: "no-pending" } } },
      trainingLabels: { status: 200, body: { success: true, data: { status: "waiting-final-score" } } }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects unauthenticated background invocations", async () => {
    const fetchImpl = vi.fn();
    const response = await runFootballSettlementWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "wrong-token",
      fetchImpl
    });

    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps GET read-only and requires admin authorization for POST writes", async () => {
    const getResponse = await GET(
      new Request(
        "http://127.0.0.1:3025/api/sports/decision/training/football-provider-live-settlement-label-receipt?run=1&dryRun=0"
      )
    );
    expect(getResponse.status).toBe(405);

    const postResponse = await POST(
      new Request(
        "http://127.0.0.1:3025/api/sports/decision/training/football-provider-live-settlement-label-receipt?run=1&dryRun=0",
        { method: "POST" }
      )
    );
    expect(postResponse.status).toBe(401);
  });
});
