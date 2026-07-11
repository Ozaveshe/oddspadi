import { describe, expect, it, vi } from "vitest";
import { runDecisionCycleSweep } from "../../netlify/functions/decision-cycle-sweep";
import { footballSeasonForDate, runDecisionCycleWorker, utcDateWindow } from "../../netlify/functions/decision-cycle-worker-background";

describe("autonomous decision cycle scheduler", () => {
  it("requires server-only scheduler configuration", async () => {
    const fetchImpl = vi.fn();
    const response = await runDecisionCycleSweep({ siteUrl: null, adminToken: null, fetchImpl });
    expect(response.status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("queues the background decision worker", async () => {
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/.netlify/functions/decision-cycle-worker-background");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-oddspadi-schedule-token")).toBe("admin-token");
      return Response.json({ success: true, queued: true }, { status: 202 });
    });
    const response = await runDecisionCycleSweep({ siteUrl: "https://oddspadi.example", adminToken: "admin-token", fetchImpl });
    expect(response.status).toBe(202);
  });

  it("builds a UTC date window without leaking local timezone offsets", () => {
    expect(utcDateWindow(new Date("2026-07-10T23:30:00-07:00"), 3)).toEqual(["2026-07-11", "2026-07-12", "2026-07-13"]);
    expect(footballSeasonForDate("2026-08-21")).toBe("2026");
    expect(footballSeasonForDate("2027-05-23")).toBe("2026");
  });

  it("captures provider context and live features before each authenticated bounded agent cycle", async () => {
    let decisionCall = 0;
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-oddspadi-admin-token")).toBe("admin-token");
      if (url.pathname.endsWith("provider-sync")) {
        expect(url.searchParams.get("provider")).toBe("api-football");
        expect(url.searchParams.get("league")).toBe("39");
        expect(url.searchParams.get("season")).toBe("2026");
        expect(url.searchParams.get("limit")).toBe("5");
        expect(url.searchParams.get("maxContextFixtures")).toBe("5");
        expect(url.searchParams.get("includeEvents")).toBe(url.searchParams.get("date") === "2026-07-10" ? "1" : "0");
        expect(url.searchParams.get("includeStandings")).toBe("1");
        expect(url.searchParams.get("includeAvailability")).toBe("1");
        expect(url.searchParams.get("includeLineups")).toBe("1");
        expect(url.searchParams.get("includeWeather")).toBe("1");
        expect(url.searchParams.get("includeNews")).toBe("0");
        expect(url.searchParams.get("dryRun")).toBe("0");
        return Response.json({ success: true, data: { status: "stored" } });
      }
      if (url.pathname.endsWith("football-provider-live-feature-storage-receipt")) {
        expect(url.searchParams.get("limit")).toBe("7");
        expect(url.searchParams.get("run")).toBe("1");
        expect(url.searchParams.get("dryRun")).toBe("0");
        return Response.json({ success: true, data: { status: "stored" } });
      }

      expect(url.pathname).toBe("/api/sports/decision/autonomous-cycle");
      expect(url.searchParams.get("sport")).toBe("football");
      expect(url.searchParams.get("limit")).toBe("9");
      expect(url.searchParams.get("aiLimit")).toBe(decisionCall === 0 ? "2" : "1");
      expect(url.searchParams.get("runAi")).toBe("1");
      expect(url.searchParams.get("persist")).toBe("1");
      decisionCall += 1;
      return Response.json({
        success: true,
        data: {
          status: "completed",
          counts: { aiReviewed: 1, aiFallbacks: 0 },
          decisions: [{ ai: { requested: true, status: "reviewed" } }]
        }
      });
    });
    const response = await runDecisionCycleWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "admin-token",
      fixtureLimit: "9",
      featureLimit: "7",
      contextLimit: "5",
      footballLeagueIds: "39,140",
      horizonDays: "2",
      aiReviewLimit: "2",
      now: new Date("2026-07-10T12:00:00.000Z"),
      fetchImpl
    });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        success: true,
        mode: "scheduled-football-intelligence-cycle",
        dateWindow: ["2026-07-10", "2026-07-11"],
        limits: expect.objectContaining({ totalAiReviewLimit: 2, aiCallsObserved: 2, contextLimitPerDate: 5, footballLeagueId: "39" })
      })
    );
  });

  it("rejects an invalid scheduler token", async () => {
    const fetchImpl = vi.fn();
    const response = await runDecisionCycleWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "wrong-token",
      fetchImpl
    });
    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
