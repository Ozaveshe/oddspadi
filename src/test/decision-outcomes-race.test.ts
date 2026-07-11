import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseRuntimeStatusMock = vi.hoisted(() => vi.fn());
const getSupabaseServerClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseRuntimeStatus: getSupabaseRuntimeStatusMock,
  getSupabaseServerClient: getSupabaseServerClientMock
}));

import { storePredictionOutcome } from "@/lib/sports/prediction/decisionOutcomes";

function outcomeLookup(data: { id: string; result: string } | null) {
  const query = {
    eq: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data, error: null }))
  };
  query.eq.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return { select: vi.fn(() => query) };
}

describe("prediction outcome concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabaseRuntimeStatusMock.mockReturnValue({ serverWriteReady: true, missingServerEnv: [] });
  });

  it("re-reads a concurrent unique insert and conditionally settles its pending row", async () => {
    const firstLookup = outcomeLookup(null);
    const concurrentLookup = outcomeLookup({ id: "outcome-1", result: "pending" });
    const updateQuery = {
      eq: vi.fn(),
      select: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { id: "outcome-1" }, error: null })) }))
    };
    updateQuery.eq.mockReturnValue(updateQuery);
    const insertQuery = {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }))
        }))
      }))
    };
    let calls = 0;
    const client = {
      from: vi.fn(() => {
        calls += 1;
        if (calls === 1) return firstLookup;
        if (calls === 2) return insertQuery;
        if (calls === 3) return concurrentLookup;
        if (calls === 4) return { update: vi.fn(() => updateQuery) };
        throw new Error(`Unexpected table call ${calls}`);
      })
    };
    getSupabaseServerClientMock.mockReturnValue(client);

    const result = await storePredictionOutcome({
      decisionRunId: "decision-run-1",
      fixtureExternalId: "api-football:fixture-1",
      sport: "football",
      market: "h2h",
      selection: "home",
      result: "won",
      source: "autonomous-shadow"
    });

    expect(result).toMatchObject({ status: "stored", id: "outcome-1" });
    expect(updateQuery.eq).toHaveBeenNthCalledWith(1, "id", "outcome-1");
    expect(updateQuery.eq).toHaveBeenNthCalledWith(2, "result", "pending");
  });
});
