import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseRuntimeStatus = vi.hoisted(() => vi.fn());
const getSupabaseServerClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ getSupabaseRuntimeStatus, getSupabaseServerClient }));

import {
  approveCalibrationCandidate,
  readActiveCalibrationPromotion
} from "@/lib/sports/prediction/decisionCalibrationPromotion";

function candidate() {
  return {
    id: "candidate-2",
    sport: "football",
    model_key: "football-v2",
    engine_version: "engine-v1",
    source: "settled-outcomes",
    window_start: "2026-01-01T00:00:00.000Z",
    window_end: "2026-02-01T00:00:00.000Z",
    sample_size: 80,
    settled_size: 80,
    outcome_hash: "outcomes-v2",
    metrics: { promotionReadiness: { status: "ready-shadow-review" } },
    calibration_buckets: []
  };
}

describe("calibration promotion repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSupabaseRuntimeStatus.mockReturnValue({ serverWriteReady: true, missingServerEnv: [] });
  });

  it("uses the atomic receipt-bound RPC instead of a revoke-then-insert race", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: candidate(), error: null });
    const candidateQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle
    };
    const rpc = vi.fn().mockResolvedValue({ data: "promotion-2", error: null });
    const client = { from: vi.fn().mockReturnValue(candidateQuery), rpc };
    getSupabaseServerClient.mockReturnValue(client);

    const result = await approveCalibrationCandidate({
      candidateId: "candidate-2",
      approvedBy: "risk-operator",
      rationale: "Paired challenger proved superior.",
      comparisonReceiptId: "comparison-1",
      expiresAt: null
    });

    expect(result).toMatchObject({ status: "approved", id: "promotion-2" });
    expect(rpc).toHaveBeenCalledWith("op_promote_calibration_challenger", {
      p_candidate_id: "candidate-2",
      p_approved_by: "risk-operator",
      p_rationale: "Paired challenger proved superior.",
      p_expires_at: null,
      p_comparison_receipt_id: "comparison-1"
    });
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("fails closed instead of choosing the newest row when legacy state has two sport champions", async () => {
    const promotions = [
      {
        id: "promotion-1",
        candidate_id: "candidate-1",
        sport: "football",
        model_key: "football-v1",
        engine_version: "engine-v1",
        approved_at: "2026-03-01T00:00:00.000Z",
        expires_at: null,
        approved_by: "operator",
        rationale: "first",
        comparison_receipt_id: null
      },
      {
        id: "promotion-2",
        candidate_id: "candidate-2",
        sport: "football",
        model_key: "football-v2",
        engine_version: "engine-v1",
        approved_at: "2026-03-02T00:00:00.000Z",
        expires_at: null,
        approved_by: "operator",
        rationale: "second",
        comparison_receipt_id: "comparison-1"
      }
    ];
    const promotionQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: promotions, error: null })
    };
    const client = { from: vi.fn().mockReturnValue(promotionQuery) };
    getSupabaseServerClient.mockReturnValue(client);

    const result = await readActiveCalibrationPromotion("football", new Date("2026-03-10T00:00:00.000Z"));

    expect(result).toEqual({ status: "failed", reason: "Ambiguous champion state: 2 active football promotions exist." });
    expect(client.from).toHaveBeenCalledTimes(1);
  });
});
