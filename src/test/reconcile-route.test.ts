import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseServerClientMock = vi.hoisted(() => vi.fn());
const startProviderRunMock = vi.hoisted(() => vi.fn());
const finishProviderRunMock = vi.hoisted(() => vi.fn());
const readLatestProviderRunMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: getSupabaseServerClientMock }));
vi.mock("@/lib/sports/intelligence/repository", () => ({
  startProviderRun: startProviderRunMock,
  finishProviderRun: finishProviderRunMock,
  readLatestProviderRun: readLatestProviderRunMock
}));

import { POST } from "@/app/api/cron/reconcile/route";

const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const method of ["select", "in", "is", "eq", "not", "limit", "order"]) c[method] = vi.fn(() => c);
  (c as { then: unknown }).then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return c as Record<string, ReturnType<typeof vi.fn>> & { then: unknown };
}

const ADMIN = "admin-token-xyz";

describe("reconcile cron route", () => {
  const original = process.env.ODDSPADI_ADMIN_TOKEN;
  beforeEach(() => {
    process.env.ODDSPADI_ADMIN_TOKEN = ADMIN;
    startProviderRunMock.mockResolvedValue({ acquired: true, run: { runId: "r1" } });
    finishProviderRunMock.mockResolvedValue({});
  });
  afterEach(() => {
    process.env.ODDSPADI_ADMIN_TOKEN = original;
    vi.clearAllMocks();
  });

  function request() {
    return new Request("http://127.0.0.1:3025/api/cron/reconcile", { method: "POST", headers: { "x-oddspadi-admin-token": ADMIN } });
  }

  it("rejects an unauthenticated call", async () => {
    getSupabaseServerClientMock.mockReturnValue({ from: vi.fn(() => chain([])), rpc: vi.fn() });
    const response = await POST(new Request("http://127.0.0.1:3025/api/cron/reconcile", { method: "POST" }));
    expect(response.status).toBe(401);
  });

  it("writes one alert per finding and never mutates a source table", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const tables: Record<string, unknown[]> = {
      op_fixtures: [],
      op_publications: [],
      op_editorial_stories: [],
      op_fixture_decision_summaries: [],
      // one current conflicted result → one finding
      op_fixture_results: [{ fixture_id: "f1", verification_state: "conflicted", is_current: true }],
      op_community_tips: [],
      op_public_projections: [],
      op_closing_prices: [],
      op_model_registry: []
    };
    const chains: Record<string, ReturnType<typeof chain>> = {};
    const from = vi.fn((table: string) => {
      // op_fixtures is read twice (fixtures + duplicates); return an empty chain both times
      const key = table === "op_fixtures" ? "op_fixtures" : table;
      chains[key] = chain(tables[key] ?? []);
      return chains[key];
    });
    getSupabaseServerClientMock.mockReturnValue({ from, rpc });

    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("findings");
    expect(body.data.findingCount).toBe(1);
    // Alert written through the exception RPC, not a source-table mutation.
    expect(rpc).toHaveBeenCalledWith("op_record_settlement_exception", expect.objectContaining({ p_kind: "reconciler_result_conflict" }));
    for (const c of Object.values(chains)) {
      expect(c.update).toBeUndefined();
      expect(c.delete).toBeUndefined();
    }
  });

  it("returns could_not_check (502) with no alerts when a source is unreadable", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const from = vi.fn(() => {
      const c: Record<string, unknown> = {};
      for (const method of ["select", "in", "is", "eq", "not", "limit", "order"]) c[method] = vi.fn(() => c);
      (c as { then: unknown }).then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve);
      return c;
    });
    getSupabaseServerClientMock.mockReturnValue({ from, rpc });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("reconcile function wiring", () => {
  it("the sweep is scheduled and does not read an inbound token or touch the DB", () => {
    const sweep = read("netlify/functions/production-reconciler-sweep.ts");
    expect(sweep).toMatch(/export const config[^=]*=\s*\{[^}]*schedule/);
    expect(sweep).not.toContain('request.headers.get("x-oddspadi-schedule-token")');
    expect(sweep).not.toContain("createClient(");
  });

  it("the worker verifies the schedule token with the shared verifier", () => {
    expect(read("netlify/functions/production-reconciler-worker-background.ts")).toContain("safeTokenMatches");
  });

  it("the migration extends the exception-kind check with reconciler kinds", () => {
    const migration = read("supabase/migrations/20260809160000_reconciler_exception_kinds.sql");
    expect(migration).toContain("reconciler_result_conflict");
    expect(migration).toContain("reconciler_model_version_mismatch");
  });
});
