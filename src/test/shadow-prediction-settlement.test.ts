import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseRuntimeStatus = vi.hoisted(() => vi.fn());
const getSupabaseServerClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ getSupabaseRuntimeStatus, getSupabaseServerClient }));

import { settlePendingShadowPredictions } from "@/lib/sports/prediction/shadowPredictionRepository";

function pendingRow() {
  return {
    id: "shadow-1",
    champion_outcome_id: "outcome-1",
    champion_decision_run_id: "run-1",
    fixture_external_id: "fixture-1",
    sport: "football",
    market: "match_winner",
    selection: "home",
    model_key: "football-shadow-1",
    engine_version: "decision-engine-v1",
    model_artifact_hash: "artifact-1",
    input_hash: "input-1",
    model_probability: 0.58,
    result: "pending",
    metadata: { privateShadow: true }
  };
}

function clientFor(championOverrides: Record<string, unknown> = {}) {
  const pendingQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [pendingRow()], error: null })
  };
  const championQuery = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({
      data: [{
        id: "outcome-1",
        decision_run_id: "run-1",
        fixture_external_id: "fixture-1",
        sport: "football",
        market: "match_winner",
        selection: "home",
        closing_odds: 2.1,
        result: "won",
        settled_at: "2026-07-18T06:00:00.000Z",
        ...championOverrides
      }],
      error: null
    })
  };
  const updateQuery = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "shadow-1" }, error: null })
  };
  const client = {
    from: vi.fn((table: string) => {
      if (table === "op_prediction_outcomes") return championQuery;
      if (table === "op_shadow_predictions") return client.from.mock.calls.filter(([name]) => name === table).length === 1
        ? pendingQuery
        : updateQuery;
      throw new Error(`Unexpected table ${table}`);
    })
  };
  return { client, updateQuery };
}

describe("private shadow settlement", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSupabaseRuntimeStatus.mockReturnValue({ serverWriteReady: true, missingServerEnv: [] });
  });

  it("mirrors the exact champion result and settlement receipt", async () => {
    const { client, updateQuery } = clientFor();
    getSupabaseServerClient.mockReturnValue(client);

    const result = await settlePendingShadowPredictions({ sport: "football", now: new Date("2026-07-18T06:01:00.000Z") });

    expect(result).toMatchObject({ status: "settled", totals: { pending: 1, settled: 1, failed: 0 } });
    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      result: "won",
      settled_at: "2026-07-18T06:00:00.000Z",
      closing_odds: 2.1,
      metadata: expect.objectContaining({ settlement: expect.objectContaining({ source: "exact-champion-outcome", championOutcomeId: "outcome-1" }) })
    }));
  });

  it("fails closed instead of settling a mismatched pair", async () => {
    const { client, updateQuery } = clientFor({ selection: "away" });
    getSupabaseServerClient.mockReturnValue(client);

    const result = await settlePendingShadowPredictions({ sport: "football" });

    expect(result).toMatchObject({ status: "failed", totals: { pending: 1, settled: 0, failed: 1 } });
    expect(updateQuery.update).not.toHaveBeenCalled();
  });
});
