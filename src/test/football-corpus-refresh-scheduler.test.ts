import { describe, expect, it, vi } from "vitest";
import { runFootballCorpusRefreshSweep } from "../../netlify/functions/football-corpus-refresh-sweep";
import {
  footballCorpusDateWindow,
  footballPlayerHistoryWindow,
  footballSeasonForCorpusDate,
  runFootballCorpusRefreshWorker
} from "../../netlify/functions/football-corpus-refresh-worker-background";

describe("football historical corpus refresh scheduler", () => {
  it("requires server-only scheduler configuration", async () => {
    const fetchImpl = vi.fn();
    const response = await runFootballCorpusRefreshSweep({ siteUrl: null, adminToken: null, fetchImpl });
    expect(response.status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("queues the authenticated background worker", async () => {
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(new URL(String(input)).pathname).toBe("/.netlify/functions/football-corpus-refresh-worker-background");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-oddspadi-schedule-token")).toBe("admin-token");
      return Response.json({ success: true, queued: true }, { status: 202 });
    });
    const response = await runFootballCorpusRefreshSweep({ siteUrl: "https://oddspadi.example", adminToken: "admin-token", fetchImpl });
    expect(response.status).toBe(202);
  });

  it("builds the previous two complete UTC dates and the correct football season", () => {
    expect(footballSeasonForCorpusDate("2027-05-23")).toBe("2026");
    expect(footballSeasonForCorpusDate("2027-07-01")).toBe("2027");
    expect(footballCorpusDateWindow(new Date("2026-07-14T03:40:00.000Z"))).toEqual({
      from: "2026-07-12",
      to: "2026-07-13",
      season: "2026"
    });
    expect(footballPlayerHistoryWindow(new Date("2026-07-14T03:40:00.000Z"))).toEqual({
      from: "2025-08-15",
      to: "2025-08-21",
      season: "2025",
      windowIndex: 2,
      windowCount: 46
    });
  });

  it("requests separate bounded recent and historical player-stat provider writes", async () => {
    let requestNumber = 0;
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requestNumber += 1;
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/sports/decision/training/historical-provider-storage-receipt");
      expect(url.searchParams.get("provider")).toBe("api-football");
      expect(url.searchParams.get("league")).toBe("39");
      expect(url.searchParams.get("includePlayerStats")).toBe("1");
      expect(url.searchParams.get("maxJobs")).toBe("1");
      expect(url.searchParams.get("dryRun")).toBe("0");
      expect(url.searchParams.get("run")).toBe("1");
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("x-oddspadi-admin-token")).toBe("admin-token");
      if (requestNumber === 1) {
        expect(url.searchParams.get("seasonFrom")).toBe("2026");
        expect(url.searchParams.get("from")).toBe("2026-07-12");
        expect(url.searchParams.get("to")).toBe("2026-07-13");
        expect(url.searchParams.get("includeEvents")).toBe("1");
        expect(url.searchParams.get("includeLineups")).toBe("1");
        expect(url.searchParams.get("maxEventFixtures")).toBe("12");
        expect(url.searchParams.get("maxContextFixtures")).toBe("12");
      } else {
        expect(url.searchParams.get("seasonFrom")).toBe("2025");
        expect(url.searchParams.get("from")).toBe("2025-08-15");
        expect(url.searchParams.get("to")).toBe("2025-08-21");
        expect(url.searchParams.has("includeEvents")).toBe(false);
        expect(url.searchParams.has("includeLineups")).toBe(false);
        expect(url.searchParams.get("maxContextFixtures")).toBe("20");
      }
      return Response.json({ success: true, data: { status: "stored", readback: { evidenceReady: true } } });
    });
    const response = await runFootballCorpusRefreshWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "admin-token",
      now: new Date("2026-07-14T03:40:00.000Z"),
      fetchImpl
    });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await response.json()).toEqual(expect.objectContaining({
      success: true,
      pipelineStatus: "completed",
      mode: "scheduled-football-corpus-refresh",
      recent: expect.objectContaining({ dateWindow: { from: "2026-07-12", to: "2026-07-13", season: "2026" }, fixtureLimit: 12 }),
      playerHistory: expect.objectContaining({
        dateWindow: { from: "2025-08-15", to: "2025-08-21", season: "2025", windowIndex: 2, windowCount: 46 },
        fixtureLimit: 20
      })
    }));
  });

  it("reports partial health when one independent corpus lane fails", async () => {
    let requestNumber = 0;
    const fetchImpl = vi.fn(async () => {
      requestNumber += 1;
      return requestNumber === 1
        ? Response.json({ success: true }, { status: 200 })
        : Response.json({ success: false, error: "player statistics entitlement unavailable" }, { status: 403 });
    });
    const response = await runFootballCorpusRefreshWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "admin-token",
      now: new Date("2026-07-14T03:40:00.000Z"),
      fetchImpl
    });
    expect(response.status).toBe(207);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await response.json()).toEqual(expect.objectContaining({ success: false, pipelineStatus: "partial" }));
  });

  it("rejects an invalid scheduler token before spending provider credits", async () => {
    const fetchImpl = vi.fn();
    const response = await runFootballCorpusRefreshWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "wrong-token",
      fetchImpl
    });
    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
