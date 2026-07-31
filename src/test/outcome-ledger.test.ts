import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runOutcomeLedgerSweep } from "@/lib/sports/results/outcomeLedger";
import { finishProviderRun, startProviderRun } from "@/lib/sports/intelligence/repository";

/**
 * The outcome ledger is the piece that used to be hand-run ops scripts; if it
 * regresses, nothing errors — the evidence corpus just silently stops growing.
 * These tests pin the chain: all four stages run, writes only happen with
 * persist, needs_review never overwrites, and a failed stage degrades to
 * partial instead of aborting the rest.
 */
vi.mock("@/lib/sports/intelligence/repository", () => ({
  startProviderRun: vi.fn(),
  finishProviderRun: vi.fn(async (run: unknown, update: unknown) => ({ ...(run as object), ...(update as object) }))
}));

type UpdateRecord = { table: string; payload: Record<string, unknown>; ids: string[] };

function fakeClient({
  fixtures,
  decisions,
  failingRpcs = new Set<string>()
}: {
  fixtures: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  failingRpcs?: Set<string>;
}) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const updates: UpdateRecord[] = [];

  function builder(table: string) {
    const state: { updatePayload: Record<string, unknown> | null; updateIds: string[] } = { updatePayload: null, updateIds: [] };
    const query: Record<string, unknown> = {};
    const chain = (..._args: unknown[]) => query;
    for (const method of ["select", "gte", "gt", "is", "order", "limit", "eq"]) query[method] = chain;
    query.update = (payload: Record<string, unknown>) => {
      state.updatePayload = payload;
      return query;
    };
    query.in = (column: string, values: string[]) => {
      if (state.updatePayload && column === "id") state.updateIds = values;
      return query;
    };
    query.then = (resolve: (value: unknown) => unknown) => {
      if (state.updatePayload) {
        updates.push({ table, payload: state.updatePayload, ids: state.updateIds });
        return resolve({ data: null, error: null });
      }
      if (table === "op_fixtures") return resolve({ data: fixtures, error: null });
      if (table === "op_market_decisions") return resolve({ data: decisions, error: null });
      return resolve({ data: [], error: null });
    };
    return query;
  }

  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (failingRpcs.has(fn)) return { data: null, error: { message: `${fn} exploded` } };
      return { data: [{ sport: "football", quotes_marked: 3, inserted: 2 }], error: null };
    }),
    from: (table: string) => builder(table)
  };
  return { client: client as unknown as SupabaseClient, rpcCalls, updates };
}

const FIXTURES = [
  { id: "fx-1", sport: "football", status: "finished", home_score: 2, away_score: 1 },
  { id: "fx-2", sport: "football", status: "postponed", home_score: null, away_score: null }
];

const DECISIONS = [
  { id: "d-1", fixture_id: "fx-1", market: "match_winner", selection: "home" },
  { id: "d-2", fixture_id: "fx-1", market: "match_winner", selection: "away" },
  { id: "d-3", fixture_id: "fx-2", market: "match_winner", selection: "home" },
  { id: "d-4", fixture_id: "fx-1", market: "asian_handicap", selection: "home_-0_75" }
];

describe("runOutcomeLedgerSweep", () => {
  beforeEach(() => {
    vi.mocked(startProviderRun).mockReset();
    vi.mocked(startProviderRun).mockResolvedValue({
      run: { runId: "run-1", providerName: "oddspadi-engine", jobType: "outcome-ledger", startedAt: "2026-07-31T00:00:00Z", finishedAt: null, status: "running", fixturesFound: 0, oddsFound: 0, predictionsGenerated: 0, valuePicksPublished: 0, errors: [] },
      acquired: true
    });
    vi.mocked(finishProviderRun).mockClear();
  });

  it("reports unavailable without a client", async () => {
    const report = await runOutcomeLedgerSweep({ client: null });
    expect(report.status).toBe("unavailable");
    expect(report.stages).toEqual([]);
  });

  it("retries lock acquisition and skips only after every attempt is busy", async () => {
    vi.mocked(startProviderRun).mockResolvedValue({
      run: { runId: null, providerName: "oddspadi-engine", jobType: "outcome-ledger", startedAt: "2026-07-31T00:00:00Z", finishedAt: null, status: "running", fixturesFound: 0, oddsFound: 0, predictionsGenerated: 0, valuePicksPublished: 0, errors: ["Skipped outcome-ledger; active provider_sync receipt owns the sports pipeline."] },
      acquired: false
    });
    const { client, rpcCalls } = fakeClient({ fixtures: FIXTURES, decisions: DECISIONS });
    const report = await runOutcomeLedgerSweep({ client, persist: true, retryDelayMs: 0 });
    expect(report.status).toBe("skipped");
    expect(rpcCalls).toEqual([]);
    // The pipeline holds the global lock most minutes; a single attempt would
    // make the schedule a lottery, so acquisition retries before giving up.
    expect(vi.mocked(startProviderRun)).toHaveBeenCalledTimes(5);
  });

  it("proceeds as soon as a retry wins the lock", async () => {
    const busy = {
      run: { runId: null, providerName: "oddspadi-engine", jobType: "outcome-ledger", startedAt: "2026-07-31T00:00:00Z", finishedAt: null, status: "running" as const, fixturesFound: 0, oddsFound: 0, predictionsGenerated: 0, valuePicksPublished: 0, errors: ["busy"] },
      acquired: false
    };
    const won = {
      run: { runId: "run-2", providerName: "oddspadi-engine", jobType: "outcome-ledger", startedAt: "2026-07-31T00:01:00Z", finishedAt: null, status: "running" as const, fixturesFound: 0, oddsFound: 0, predictionsGenerated: 0, valuePicksPublished: 0, errors: [] },
      acquired: true
    };
    vi.mocked(startProviderRun).mockResolvedValueOnce(busy).mockResolvedValueOnce(busy).mockResolvedValueOnce(won);
    const { client, rpcCalls } = fakeClient({ fixtures: FIXTURES, decisions: DECISIONS });
    const report = await runOutcomeLedgerSweep({ client, persist: true, retryDelayMs: 0 });
    expect(report.status).toBe("completed");
    expect(vi.mocked(startProviderRun)).toHaveBeenCalledTimes(3);
    expect(rpcCalls.map((call) => call.fn)).toContain("op_mark_closing_odds");
  });

  it("runs all four stages and writes only decided verdicts", async () => {
    const { client, rpcCalls, updates } = fakeClient({ fixtures: FIXTURES, decisions: DECISIONS });
    const report = await runOutcomeLedgerSweep({ client, persist: true, days: 14 });

    expect(report.status).toBe("completed");
    expect(report.stages.map((stage) => stage.stage)).toEqual([
      "closing-odds",
      "decision-settlement",
      "outcome-backfill",
      "odds-prune"
    ]);
    expect(rpcCalls.map((call) => call.fn)).toEqual([
      "op_mark_closing_odds",
      "op_backfill_prediction_outcomes",
      "op_prune_stale_odds"
    ]);
    for (const call of rpcCalls) expect(call.args.p_commit ?? call.args.p_commit === undefined).toBeTruthy();
    expect(rpcCalls[0]!.args.p_window_minutes).toBe(90);

    // home won (2-1), away lost, postponed voided; the handicap is ungradeable
    // and must never be written.
    const written = new Map(updates.map((update) => [String(update.payload.settlement_status), update.ids]));
    expect(written.get("won")).toEqual(["d-1"]);
    expect(written.get("lost")).toEqual(["d-2"]);
    expect(written.get("void")).toEqual(["d-3"]);
    expect(updates.flatMap((update) => update.ids)).not.toContain("d-4");

    const settlement = report.stages.find((stage) => stage.stage === "decision-settlement");
    expect(settlement?.detail).toMatchObject({ fixtures: 2, won: 1, lost: 1, void: 1, needs_review: 1, written: 3 });
    expect(vi.mocked(finishProviderRun)).toHaveBeenCalledTimes(1);
    const [, update] = vi.mocked(finishProviderRun).mock.calls[0]!;
    expect(update).toMatchObject({ status: "completed", fixturesFound: 2, oddsFound: 3, predictionsGenerated: 2 });
  });

  it("grades nothing into the database on a dry run", async () => {
    const { client, rpcCalls, updates } = fakeClient({ fixtures: FIXTURES, decisions: DECISIONS });
    const report = await runOutcomeLedgerSweep({ client, persist: false });
    expect(report.status).toBe("completed");
    expect(updates).toEqual([]);
    for (const call of rpcCalls) expect(call.args.p_commit).toBe(false);
  });

  it("marks the run partial when one stage fails but still runs the rest", async () => {
    const { client, rpcCalls } = fakeClient({
      fixtures: FIXTURES,
      decisions: DECISIONS,
      failingRpcs: new Set(["op_backfill_prediction_outcomes"])
    });
    const report = await runOutcomeLedgerSweep({ client, persist: true });
    expect(report.status).toBe("partial");
    const failed = report.stages.find((stage) => stage.stage === "outcome-backfill");
    expect(failed?.status).toBe("failed");
    // The prune still ran after the failure.
    expect(rpcCalls.map((call) => call.fn)).toContain("op_prune_stale_odds");
    const [, update] = vi.mocked(finishProviderRun).mock.calls[0]!;
    expect(update).toMatchObject({ status: "partial" });
  });
});
