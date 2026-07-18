import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseRuntimeStatus = vi.hoisted(() => vi.fn());
const getSupabaseServerClient = vi.hoisted(() => vi.fn());
const readActiveCalibrationPromotion = vi.hoisted(() => vi.fn());
const buildChampionChallengerReceipt = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ getSupabaseRuntimeStatus, getSupabaseServerClient }));
vi.mock("@/lib/sports/prediction/decisionCalibrationPromotion", () => ({ readActiveCalibrationPromotion }));
vi.mock("@/lib/sports/prediction/championChallenger", () => ({ buildChampionChallengerReceipt }));

import { runAndStoreChampionChallengerComparison } from "@/lib/sports/prediction/championChallengerRepository";

describe("champion challenger repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSupabaseRuntimeStatus.mockReturnValue({ serverWriteReady: true, missingServerEnv: [] });
    readActiveCalibrationPromotion.mockResolvedValue({
      status: "found",
      promotion: {
        id: "promotion-1",
        modelKey: "football-v1",
        engineVersion: "engine-v1"
      }
    });
  });

  it("reads the latest bounded evidence and returns the exact immutable receipt when a hash is reused", async () => {
    const previewReceipt = {
      version: "champion-challenger-v1",
      receiptHash: "receipt-hash-1",
      status: "warming",
      eligibleForPromotion: false,
      asOf: "2026-04-10T12:00:00.000Z",
      sample: { paired: 0 }
    };
    const storedReceipt = { ...previewReceipt, asOf: "2026-04-10T11:00:00.000Z" };
    buildChampionChallengerReceipt.mockReturnValue(previewReceipt);

    const candidateQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "candidate-2",
          sport: "football",
          model_key: "football-v2",
          engine_version: "engine-v1",
          window_end: "2026-03-01T00:00:00.000Z",
          metrics: { promotionReadiness: { status: "ready-shadow-review" } }
        },
        error: null
      })
    };
    const outcomeQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null })
    };
    const receiptQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "receipt-1", metrics: storedReceipt }, error: null })
    };
    const client = {
      from: vi.fn((table: string) => {
        if (table === "op_calibration_candidates") return candidateQuery;
        if (table === "op_prediction_outcomes") return outcomeQuery;
        if (table === "op_model_comparison_receipts") return receiptQuery;
        throw new Error(`Unexpected table ${table}`);
      })
    };
    getSupabaseServerClient.mockReturnValue(client);

    const result = await runAndStoreChampionChallengerComparison({
      sport: "football",
      challengerCandidateId: "candidate-2",
      now: new Date("2026-04-10T12:00:00.000Z")
    });

    expect(outcomeQuery.order).toHaveBeenCalledWith("settled_at", { ascending: false });
    expect(result).toMatchObject({ status: "reused", id: "receipt-1", receipt: storedReceipt });
  });

  it("fails closed when stored metrics do not match the receipt hash", async () => {
    const previewReceipt = {
      version: "champion-challenger-v1",
      receiptHash: "receipt-hash-1",
      status: "warming",
      eligibleForPromotion: false,
      asOf: "2026-04-10T12:00:00.000Z",
      sample: { paired: 0 }
    };
    buildChampionChallengerReceipt.mockReturnValue(previewReceipt);
    const candidateQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "candidate-2", sport: "football", model_key: "football-v2", engine_version: "engine-v1",
          window_end: "2026-03-01T00:00:00.000Z", metrics: { promotionReadiness: { status: "ready-shadow-review" } }
        },
        error: null
      })
    };
    const outcomeQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null })
    };
    const receiptQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "receipt-1", metrics: { ...previewReceipt, receiptHash: "different-hash" } }, error: null
      })
    };
    getSupabaseServerClient.mockReturnValue({
      from: vi.fn((table: string) => table === "op_calibration_candidates" ? candidateQuery : table === "op_prediction_outcomes" ? outcomeQuery : receiptQuery)
    });

    const result = await runAndStoreChampionChallengerComparison({ sport: "football", challengerCandidateId: "candidate-2" });

    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("do not match") });
  });
});
