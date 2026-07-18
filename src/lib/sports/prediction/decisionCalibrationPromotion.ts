import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import type { Sport } from "@/lib/sports/types";
import type { DecisionCalibrationMetrics, ProbabilityCalibrationBucket } from "./decisionCalibration";

export type CalibrationCandidateWriteResult = {
  status: "stored" | "reused" | "skipped" | "pending-migration" | "failed";
  configured: boolean;
  table: "op_calibration_candidates";
  id?: string;
  reason?: string;
};

export type ActiveCalibrationPromotion = {
  id: string;
  candidateId: string;
  sport: Sport;
  modelKey: string;
  engineVersion: string;
  approvedAt: string;
  expiresAt: string | null;
  approvedBy: string;
  rationale: string;
  comparisonReceiptId?: string | null;
  candidate: {
    id: string;
    source: string;
    windowStart?: string | null;
    windowEnd?: string | null;
    sampleSize: number;
    settledSize: number;
    outcomeHash: string;
    probabilityBuckets: ProbabilityCalibrationBucket[];
    metrics: Record<string, unknown>;
  };
};

export type ActiveCalibrationPromotionReadResult =
  | { status: "found"; promotion: ActiveCalibrationPromotion }
  | { status: "not-found" | "pending-migration" | "failed"; reason?: string };

export type CalibrationPromotionWriteResult = {
  status: "approved" | "revoked" | "not-configured" | "pending-migration" | "failed";
  configured: boolean;
  table: "op_calibration_promotions";
  id?: string;
  reason?: string;
};

type CandidateRow = {
  id: string;
  sport: string;
  model_key: string;
  engine_version: string;
  source: string;
  window_start: string | null;
  window_end: string | null;
  sample_size: number;
  settled_size: number;
  outcome_hash: string;
  metrics: unknown;
  calibration_buckets: unknown;
};

type PromotionRow = {
  id: string;
  candidate_id: string;
  sport: string;
  model_key: string;
  engine_version: string;
  approved_at: string;
  expires_at: string | null;
  approved_by: string;
  rationale: string;
  comparison_receipt_id: string | null;
};

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function tableMissing(reason: string | undefined, table: string): boolean {
  const message = reason?.toLowerCase() ?? "";
  return message.includes(table) && (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"));
}

function championGovernanceMigrationMissing(reason: string | undefined): boolean {
  const message = reason?.toLowerCase() ?? "";
  return tableMissing(reason, "op_promote_calibration_challenger") ||
    tableMissing(reason, "op_model_comparison_receipts") ||
    (message.includes("comparison_receipt_id") && (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find")));
}

function normalizeProbabilityBuckets(value: unknown): ProbabilityCalibrationBucket[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = record(entry);
    const id = text(row.id);
    const lowerBound = finiteNumber(row.lowerBound);
    const upperBound = finiteNumber(row.upperBound);
    const sampleSize = finiteNumber(row.sampleSize);
    const settledSize = finiteNumber(row.settledSize);
    const roiUnits = finiteNumber(row.roiUnits);
    if (!id || lowerBound === null || upperBound === null || sampleSize === null || settledSize === null || roiUnits === null) return [];
    return [
      {
        id,
        lowerBound,
        upperBound,
        sampleSize: Math.max(0, Math.trunc(sampleSize)),
        settledSize: Math.max(0, Math.trunc(settledSize)),
        winRate: finiteNumber(row.winRate),
        brierScore: finiteNumber(row.brierScore),
        logLoss: finiteNumber(row.logLoss),
        averageProbability: finiteNumber(row.averageProbability),
        calibrationGap: finiteNumber(row.calibrationGap),
        winRateInterval: null,
        roiUnits
      }
    ];
  });
}

function metricsPayload(metrics: DecisionCalibrationMetrics): Record<string, unknown> {
  return {
    brierScore: metrics.brierScore,
    brierSkillScore: metrics.brierSkillScore,
    logLoss: metrics.logLoss,
    expectedCalibrationError: metrics.expectedCalibrationError,
    maximumCalibrationError: metrics.maximumCalibrationError,
    averageEdge: metrics.averageEdge,
    averageClosingLineValue: metrics.averageClosingLineValue,
    closingLineSampleSize: metrics.closingLineSampleSize,
    closingLineCoverage: metrics.closingLineCoverage,
    roiUnits: metrics.roiUnits,
    roiYield: metrics.roiYield,
    promotionReadiness: metrics.promotionReadiness,
    notes: metrics.notes
  };
}

function candidateIsPromotionReady(candidate: CandidateRow): boolean {
  return record(record(candidate.metrics).promotionReadiness).status === "ready-shadow-review";
}

function activePromotionFromRows(promotion: PromotionRow, candidate: CandidateRow): ActiveCalibrationPromotion | null {
  if (candidate.sport !== promotion.sport || candidate.model_key !== promotion.model_key || candidate.engine_version !== promotion.engine_version) return null;
  const sport = promotion.sport as Sport;
  if (!sport || !candidateIsPromotionReady(candidate)) return null;
  const buckets = normalizeProbabilityBuckets(candidate.calibration_buckets);
  return {
    id: promotion.id,
    candidateId: promotion.candidate_id,
    sport,
    modelKey: promotion.model_key,
    engineVersion: promotion.engine_version,
    approvedAt: promotion.approved_at,
    expiresAt: promotion.expires_at,
    approvedBy: promotion.approved_by,
    rationale: promotion.rationale,
    comparisonReceiptId: promotion.comparison_receipt_id,
    candidate: {
      id: candidate.id,
      source: candidate.source,
      windowStart: candidate.window_start,
      windowEnd: candidate.window_end,
      sampleSize: candidate.sample_size,
      settledSize: candidate.settled_size,
      outcomeHash: candidate.outcome_hash,
      probabilityBuckets: buckets,
      metrics: record(candidate.metrics)
    }
  };
}

export function calibrationOutcomeHash({
  sport,
  modelKey,
  engineVersion,
  outcomeIds
}: {
  sport: string;
  modelKey: string;
  engineVersion: string;
  outcomeIds: string[];
}): string {
  return stableHash({ sport, modelKey, engineVersion, outcomeIds: outcomeIds.slice().sort() });
}

export async function storeCalibrationCandidate({
  metrics,
  calibrationRunId,
  outcomeIds,
  source = "settled-outcomes"
}: {
  metrics: DecisionCalibrationMetrics;
  calibrationRunId?: string;
  outcomeIds: string[];
  source?: string;
}): Promise<CalibrationCandidateWriteResult> {
  if (!metrics.modelKey || !metrics.engineVersion) {
    return {
      status: "skipped",
      configured: true,
      table: "op_calibration_candidates",
      reason: "Calibration candidates require a single resolved model key and engine version."
    };
  }

  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return {
      status: "failed",
      configured: false,
      table: "op_calibration_candidates",
      reason: `Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }
  const client = getSupabaseServerClient();
  if (!client) return { status: "failed", configured: true, table: "op_calibration_candidates", reason: "Supabase client could not be created." };

  const normalizedOutcomeIds = Array.from(new Set(outcomeIds)).sort();
  const outcomeHash = calibrationOutcomeHash({
    sport: metrics.sport,
    modelKey: metrics.modelKey,
    engineVersion: metrics.engineVersion,
    outcomeIds: normalizedOutcomeIds
  });
  const existing = await client
    .from("op_calibration_candidates")
    .select("id")
    .eq("sport", metrics.sport)
    .eq("model_key", metrics.modelKey)
    .eq("engine_version", metrics.engineVersion)
    .eq("outcome_hash", outcomeHash)
    .maybeSingle();
  if (existing.error) {
    if (tableMissing(existing.error.message, "op_calibration_candidates")) {
      return { status: "pending-migration", configured: true, table: "op_calibration_candidates", reason: "Apply the calibration candidate migration before storing model-bound outcomes." };
    }
    return { status: "failed", configured: true, table: "op_calibration_candidates", reason: existing.error.message };
  }
  if (typeof existing.data?.id === "string") {
    return { status: "reused", configured: true, table: "op_calibration_candidates", id: existing.data.id };
  }

  const { data, error } = await client
    .from("op_calibration_candidates")
    .insert({
      calibration_run_id: calibrationRunId ?? null,
      sport: metrics.sport,
      model_key: metrics.modelKey,
      engine_version: metrics.engineVersion,
      source,
      window_start: metrics.windowStart,
      window_end: metrics.windowEnd,
      sample_size: metrics.sampleSize,
      settled_size: metrics.settledSize,
      outcome_hash: outcomeHash,
      outcome_ids: normalizedOutcomeIds,
      metrics: metricsPayload(metrics),
      calibration_buckets: metrics.probabilityBuckets,
      generated_at: new Date().toISOString()
    })
    .select("id")
    .single();
  if (error) {
    if (tableMissing(error.message, "op_calibration_candidates")) {
      return { status: "pending-migration", configured: true, table: "op_calibration_candidates", reason: "Apply the calibration candidate migration before storing model-bound outcomes." };
    }
    return { status: "failed", configured: true, table: "op_calibration_candidates", reason: error.message };
  }
  return { status: "stored", configured: true, table: "op_calibration_candidates", id: typeof data?.id === "string" ? data.id : undefined };
}

export async function readActiveCalibrationPromotion(sport: Sport, now = new Date()): Promise<ActiveCalibrationPromotionReadResult> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) return { status: "not-found", reason: "Supabase server reads are not configured." };
  const client = getSupabaseServerClient();
  if (!client) return { status: "failed", reason: "Supabase client could not be created." };

  const promotions = await client
    .from("op_calibration_promotions")
    .select("id,candidate_id,sport,model_key,engine_version,approved_at,expires_at,approved_by,rationale,comparison_receipt_id")
    .eq("sport", sport)
    .eq("status", "approved")
    .is("revoked_at", null)
    .order("approved_at", { ascending: false })
    .limit(8);
  if (promotions.error) {
    if (tableMissing(promotions.error.message, "op_calibration_promotions") || championGovernanceMigrationMissing(promotions.error.message)) return { status: "pending-migration", reason: promotions.error.message };
    return { status: "failed", reason: promotions.error.message };
  }

  const activeRows = ((promotions.data ?? []) as PromotionRow[]).filter((promotion) => {
    const expiry = promotion.expires_at ? Date.parse(promotion.expires_at) : Number.POSITIVE_INFINITY;
    return !Number.isFinite(expiry) || expiry > now.getTime();
  });
  if (activeRows.length > 1) return { status: "failed", reason: `Ambiguous champion state: ${activeRows.length} active ${sport} promotions exist.` };
  const rawPromotion = activeRows[0];
  if (!rawPromotion) return { status: "not-found" };
  const candidateResult = await client
    .from("op_calibration_candidates")
    .select("id,sport,model_key,engine_version,source,window_start,window_end,sample_size,settled_size,outcome_hash,metrics,calibration_buckets")
    .eq("id", rawPromotion.candidate_id)
    .maybeSingle();
  if (candidateResult.error) {
    if (tableMissing(candidateResult.error.message, "op_calibration_candidates")) return { status: "pending-migration", reason: candidateResult.error.message };
    return { status: "failed", reason: candidateResult.error.message };
  }
  if (!candidateResult.data) return { status: "failed", reason: "The active champion candidate is missing." };
  const promotion = activePromotionFromRows(rawPromotion, candidateResult.data as CandidateRow);
  return promotion ? { status: "found", promotion } : { status: "failed", reason: "The active champion promotion does not match a promotion-ready candidate." };
}

export async function approveCalibrationCandidate({
  candidateId,
  approvedBy,
  rationale,
  expiresAt,
  comparisonReceiptId
}: {
  candidateId: string;
  approvedBy: string;
  rationale: string;
  expiresAt?: string | null;
  comparisonReceiptId?: string | null;
}): Promise<CalibrationPromotionWriteResult> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return { status: "not-configured", configured: false, table: "op_calibration_promotions", reason: `Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.` };
  }
  const client = getSupabaseServerClient();
  if (!client) return { status: "failed", configured: true, table: "op_calibration_promotions", reason: "Supabase client could not be created." };
  const candidateResult = await client
    .from("op_calibration_candidates")
    .select("id,sport,model_key,engine_version,source,window_start,window_end,sample_size,settled_size,outcome_hash,metrics,calibration_buckets")
    .eq("id", candidateId)
    .maybeSingle();
  if (candidateResult.error) {
    if (tableMissing(candidateResult.error.message, "op_calibration_candidates")) return { status: "pending-migration", configured: true, table: "op_calibration_promotions", reason: candidateResult.error.message };
    return { status: "failed", configured: true, table: "op_calibration_promotions", reason: candidateResult.error.message };
  }
  if (!candidateResult.data) return { status: "failed", configured: true, table: "op_calibration_promotions", reason: "Calibration candidate was not found." };
  const candidate = candidateResult.data as CandidateRow;
  if (!candidateIsPromotionReady(candidate)) {
    return { status: "failed", configured: true, table: "op_calibration_promotions", reason: "Calibration candidate has not passed the shadow-review quality gate." };
  }
  if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
    return { status: "failed", configured: true, table: "op_calibration_promotions", reason: "Promotion expiry must be a valid future timestamp." };
  }

  const { data, error } = await client.rpc("op_promote_calibration_challenger", {
    p_candidate_id: candidate.id,
    p_approved_by: approvedBy,
    p_rationale: rationale,
    p_expires_at: expiresAt ?? null,
    p_comparison_receipt_id: comparisonReceiptId ?? null
  });
  if (error) {
    if (championGovernanceMigrationMissing(error.message)) {
      return { status: "pending-migration", configured: true, table: "op_calibration_promotions", reason: error.message };
    }
    return { status: "failed", configured: true, table: "op_calibration_promotions", reason: error.message };
  }
  return { status: "approved", configured: true, table: "op_calibration_promotions", id: typeof data === "string" ? data : undefined };
}

export async function revokeCalibrationPromotion({
  promotionId,
  revokedBy,
  reason
}: {
  promotionId: string;
  revokedBy: string;
  reason: string;
}): Promise<CalibrationPromotionWriteResult> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return { status: "not-configured", configured: false, table: "op_calibration_promotions", reason: `Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.` };
  }
  const client = getSupabaseServerClient();
  if (!client) return { status: "failed", configured: true, table: "op_calibration_promotions", reason: "Supabase client could not be created." };
  const { data, error } = await client
    .from("op_calibration_promotions")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: revokedBy, revocation_reason: reason })
    .eq("id", promotionId)
    .eq("status", "approved")
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    if (tableMissing(error.message, "op_calibration_promotions")) return { status: "pending-migration", configured: true, table: "op_calibration_promotions", reason: error.message };
    return { status: "failed", configured: true, table: "op_calibration_promotions", reason: error.message };
  }
  if (!data?.id) return { status: "failed", configured: true, table: "op_calibration_promotions", reason: "Active promotion was not found." };
  return { status: "revoked", configured: true, table: "op_calibration_promotions", id: data.id };
}
