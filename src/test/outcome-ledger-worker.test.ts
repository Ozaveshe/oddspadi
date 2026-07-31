import { describe, expect, it, vi } from "vitest";
import { runOutcomeLedgerWorker } from "../../netlify/functions/outcome-ledger-worker-background";

/**
 * The worker exists because the Next route dies at the platform's real
 * execution cap: it must sequence the ledger as small per-stage slices and
 * keep draining settlement while a slice reports an exhausted budget. If this
 * regresses to a single long call, production runs orphan the pipeline lock
 * again.
 */
function sliceResponse(stage: string, { budgetExhausted = false, runStatus = "completed" } = {}) {
  return Response.json({
    success: true,
    data: {
      status: runStatus,
      stages: stage === "decision-settlement" ? [{ stage, detail: { budgetExhausted } }] : [{ stage, detail: {} }]
    }
  });
}

describe("outcome ledger worker", () => {
  it("requires configuration and a valid schedule token", async () => {
    const fetchImpl = vi.fn();
    expect((await runOutcomeLedgerWorker({ siteUrl: null, adminToken: null, scheduleToken: null, fetchImpl })).status).toBe(503);
    expect(
      (await runOutcomeLedgerWorker({ siteUrl: "https://oddspadi.example", adminToken: "token", scheduleToken: "wrong", fetchImpl })).status
    ).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sequences one slice per stage and repeats settlement while its budget is exhausted", async () => {
    const stagesCalled: string[] = [];
    let settlementCalls = 0;
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/cron/outcome-ledger");
      expect(new Headers(init?.headers).get("x-oddspadi-admin-token")).toBe("admin-token");
      const stage = url.searchParams.get("stage")!;
      stagesCalled.push(stage);
      if (stage === "decision-settlement") {
        settlementCalls += 1;
        // Two backlog slices, then a finishing one.
        return sliceResponse(stage, { budgetExhausted: settlementCalls < 3 });
      }
      return sliceResponse(stage);
    });

    const response = await runOutcomeLedgerWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "admin-token",
      fetchImpl,
      waitMs: async () => {}
    });

    expect(response.status).toBe(200);
    expect(stagesCalled).toEqual([
      "closing-odds",
      "decision-settlement",
      "decision-settlement",
      "decision-settlement",
      "outcome-backfill",
      "odds-prune"
    ]);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, mode: "scheduled-outcome-ledger" });
  });

  it("waits and retries a slice that found the pipeline lock busy", async () => {
    let closingCalls = 0;
    const waits: number[] = [];
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const stage = new URL(String(input)).searchParams.get("stage")!;
      if (stage === "closing-odds") {
        closingCalls += 1;
        return sliceResponse(stage, { runStatus: closingCalls < 3 ? "skipped" : "completed" });
      }
      return sliceResponse(stage);
    });

    const response = await runOutcomeLedgerWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "admin-token",
      fetchImpl,
      waitMs: async (ms) => {
        waits.push(ms);
      }
    });

    expect(response.status).toBe(200);
    expect(closingCalls).toBe(3);
    expect(waits.filter((ms) => ms === 45_000).length).toBe(2);
  });

  it("reports failure when a slice errors outright", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const stage = new URL(String(input)).searchParams.get("stage")!;
      if (stage === "outcome-backfill") return Response.json({ success: false }, { status: 503 });
      return sliceResponse(stage);
    });
    const response = await runOutcomeLedgerWorker({
      siteUrl: "https://oddspadi.example",
      adminToken: "admin-token",
      scheduleToken: "admin-token",
      fetchImpl,
      waitMs: async () => {}
    });
    expect(response.status).toBe(502);
    expect((await response.json()).success).toBe(false);
  });
});
