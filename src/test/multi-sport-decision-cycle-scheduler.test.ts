import { describe, expect, it, vi } from "vitest";
import { runMultiSportDecisionCycleSweep } from "../../netlify/functions/multi-sport-decision-cycle-sweep";
import { runMultiSportDecisionCycleWorker } from "../../netlify/functions/multi-sport-decision-cycle-worker-background";

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

  it("uses only built pipeline routes for basketball and tennis", async () => {
    const paths: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-oddspadi-admin-token")).toBe("admin-token");
      expect(url.searchParams.get("sports")).toBe("basketball,tennis");
      return Response.json({
        success: true,
        data: { run: { status: "completed" } }
      });
    });

    const response = await runMultiSportDecisionCycleWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "admin-token",
      fetchImpl
    });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(paths).toEqual(["/api/cron/refresh-odds", "/api/cron/run-daily-engine"]);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        success: true,
        mode: "scheduled-multi-sport-pipeline-cycle",
        sports: ["basketball", "tennis"]
      })
    );
  });

  it("fails the schedule when a built pipeline route reports partial sport coverage", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const partial = new URL(String(input)).pathname.endsWith("refresh-odds");
      return Response.json(
        { success: true, data: { run: { status: partial ? "partial" : "completed" } } },
        { status: partial ? 207 : 200 }
      );
    });
    const response = await runMultiSportDecisionCycleWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "admin-token",
      fetchImpl
    });
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.success).toBe(false);
    expect(body.stages[0]).toMatchObject({ name: "refresh-odds", status: 207, pipelineStatus: "partial", ok: false });
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
