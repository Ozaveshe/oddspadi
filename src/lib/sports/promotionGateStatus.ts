import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Live reading of the seven promotion gates, for the engine page's status
 * board.
 *
 * "Why do we have 0 published?" was being answered in chat instead of on the
 * product. These are the same seven gates `decisionCalibration` enforces —
 * computed from `op_prediction_outcomes`, the exact table the promotion
 * candidate reads — so the page shows the true distance to publication rather
 * than a mood.
 */
export type PromotionGate = {
  id: string;
  label: string;
  /** Current measured value, formatted by the caller. */
  value: number | null;
  threshold: number;
  /** Whether bigger is better for this gate. */
  direction: "at-least" | "at-most";
  passing: boolean;
  /** 0..1 progress toward the threshold, clamped, for the bar width. */
  progress: number;
};

export type PromotionGateStatus = {
  sport: string;
  settled: number;
  gates: PromotionGate[];
  passingCount: number;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export async function readPromotionGateStatus(sport: string): Promise<PromotionGateStatus | null> {
  const client = getSupabaseServerClient();
  if (!client) return null;

  const { data, error } = await client
    .from("op_prediction_outcomes")
    .select("result,model_probability,odds,closing_odds")
    .eq("sport", sport)
    .limit(5000);
  if (error || !data) return null;

  const settledRows = data
    .map((row) => ({
      result: String(row.result),
      p: Number(row.model_probability),
      odds: row.odds === null ? null : Number(row.odds),
      closing: row.closing_odds === null ? null : Number(row.closing_odds)
    }))
    .filter((row) => (row.result === "won" || row.result === "lost") && Number.isFinite(row.p) && row.p >= 0 && row.p <= 1);

  const n = settledRows.length;
  const wins = settledRows.filter((row) => row.result === "won").length;
  const baseRate = n ? wins / n : 0;
  const brier = n ? settledRows.reduce((sum, row) => sum + (row.p - (row.result === "won" ? 1 : 0)) ** 2, 0) / n : null;
  const referenceBrier = n ? settledRows.reduce((sum, row) => sum + (baseRate - (row.result === "won" ? 1 : 0)) ** 2, 0) / n : null;
  const brierSkill = brier !== null && referenceBrier ? 1 - brier / referenceBrier : null;
  const clampP = (value: number) => Math.min(1 - 1e-9, Math.max(1e-9, value));
  const logLoss = n
    ? settledRows.reduce((sum, row) => sum - Math.log(clampP(row.result === "won" ? row.p : 1 - row.p)), 0) / n
    : null;
  const buckets = Array.from({ length: 10 }, (_, index) => {
    const inBucket = settledRows.filter((row) => row.p >= index / 10 && row.p < (index + 1) / 10 + (index === 9 ? 0.01 : 0));
    if (!inBucket.length) return null;
    const predicted = inBucket.reduce((sum, row) => sum + row.p, 0) / inBucket.length;
    const actual = inBucket.filter((row) => row.result === "won").length / inBucket.length;
    return { n: inBucket.length, gap: Math.abs(predicted - actual) };
  }).filter((bucket): bucket is NonNullable<typeof bucket> => bucket !== null);
  const ece = n ? buckets.reduce((sum, bucket) => sum + (bucket.n / n) * bucket.gap, 0) : null;
  const withClosing = settledRows.filter((row) => row.closing !== null && row.closing > 1);
  const closingCoverage = n ? withClosing.length / n : null;
  const clvRows = withClosing.filter((row) => row.odds !== null && row.odds > 1);
  const averageClv = clvRows.length
    ? clvRows.reduce((sum, row) => sum + (row.odds! / row.closing! - 1), 0) / clvRows.length
    : null;

  const gate = (
    id: string,
    label: string,
    value: number | null,
    threshold: number,
    direction: PromotionGate["direction"]
  ): PromotionGate => {
    const passing =
      value !== null && (direction === "at-least" ? value >= threshold : value <= threshold);
    const progress =
      value === null
        ? 0
        : direction === "at-least"
          ? clamp01(threshold === 0 ? (value > 0 ? 1 : 0) : value / threshold)
          // For at-most gates the bar shows headroom used; full bar = at the limit.
          : clamp01(threshold === 0 ? 1 : value / threshold);
    return { id, label, value, threshold, direction, passing, progress };
  };

  const gates: PromotionGate[] = [
    gate("settled", "Settled outcomes", n, 30, "at-least"),
    gate("brier", "Brier score", brier, 0.25, "at-most"),
    gate("skill", "Brier skill vs base rate", brierSkill, 0, "at-least"),
    gate("logloss", "Log loss", logLoss, Math.log(2), "at-most"),
    gate("ece", "Calibration error (ECE)", ece, 0.1, "at-most"),
    gate("coverage", "Closing-line coverage", closingCoverage, 0.8, "at-least"),
    gate("clv", "Average closing-line value", averageClv, 0, "at-least")
  ];

  return { sport, settled: n, gates, passingCount: gates.filter((entry) => entry.passing).length };
}
