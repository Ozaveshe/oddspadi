import { describe, expect, it, vi } from "vitest";
import { runMultiSportDecisionCycleSweep } from "../../netlify/functions/multi-sport-decision-cycle-sweep";
import {
  multiSportUtcDateWindow,
  runMultiSportDecisionCycleWorker,
  scheduledSportOrder
} from "../../netlify/functions/multi-sport-decision-cycle-worker-background";

describe("multi-sport autonomous decision cycle scheduler", () => {
  it("requires server-only scheduler configuration", async () => {
    const fetchImpl = vi.fn();
    const response = await runMultiSportDecisionCycleSweep({ siteUrl: null, adminToken: null, fetchImpl });
    expect(response.status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("queues the background multi-sport worker", async () => {
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(new URL(String(input)).pathname).toBe("/.netlify/functions/multi-sport-decision-cycle-worker-background");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-oddspadi-schedule-token")).toBe("admin-token");
      return Response.json({ success: true, queued: true }, { status: 202 });
    });
    const response = await runMultiSportDecisionCycleSweep({ siteUrl: "https://oddspadi.example", adminToken: "admin-token", fetchImpl });
    expect(response.status).toBe(202);
  });

  it("rotates sport priority and keeps one shared AI budget across the bounded window", async () => {
    expect(multiSportUtcDateWindow(new Date("2026-07-10T23:30:00-07:00"), 2)).toEqual(["2026-07-11", "2026-07-12"]);
    expect(scheduledSportOrder(new Date("2026-07-10T02:00:00.000Z"))).toEqual(["tennis", "basketball"]);

    let decisionCall = 0;
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-oddspadi-admin-token")).toBe("admin-token");
      expect(url.searchParams.get("limit")).toBe("6");
      expect(url.searchParams.get("date")).toBe("2026-07-10");

      if (url.pathname.endsWith("multi-sport-live-feature-storage-receipt")) {
        expect(url.searchParams.get("run")).toBe("1");
        expect(url.searchParams.get("dryRun")).toBe("0");
        return Response.json({ success: true, data: { status: "stored" } });
      }

      expect(url.pathname).toBe("/api/sports/decision/autonomous-cycle");
      expect(url.searchParams.get("sport")).toBe(decisionCall === 0 ? "tennis" : "basketball");
      expect(url.searchParams.get("aiLimit")).toBe(decisionCall === 0 ? "1" : "0");
      expect(url.searchParams.get("runAi")).toBe("1");
      expect(url.searchParams.get("persist")).toBe("1");
      decisionCall += 1;
      return Response.json({
        success: true,
        data: {
          status: "completed",
          counts: { aiReviewed: decisionCall === 1 ? 1 : 0, aiFallbacks: 0 },
          decisions: decisionCall === 1 ? [{ ai: { requested: true, status: "reviewed" } }] : []
        }
      });
    });

    const response = await runMultiSportDecisionCycleWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "admin-token",
      fixtureLimit: "6",
      aiReviewLimit: "1",
      horizonDays: "1",
      now: new Date("2026-07-10T02:00:00.000Z"),
      fetchImpl
    });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        success: true,
        mode: "scheduled-multi-sport-intelligence-cycle",
        dateWindow: ["2026-07-10"],
        sportOrder: ["tennis", "basketball"],
        limits: expect.objectContaining({ fixtureLimitPerSportDate: 6, totalAiReviewLimit: 1, aiCallsObserved: 1 })
      })
    );
  });

  it("rejects an invalid scheduler token", async () => {
    const fetchImpl = vi.fn();
    const response = await runMultiSportDecisionCycleWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "wrong-token",
      fetchImpl
    });
    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
