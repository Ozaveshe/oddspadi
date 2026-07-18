import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import type { Sport } from "@/lib/sports/types";
import { buildChampionChallengerReceipt, type ChampionChallengerReceipt } from "./championChallenger";
import type { DecisionRunRow, OutcomeRow } from "./decisionCalibration";
import { readActiveCalibrationPromotion, type ActiveCalibrationPromotion } from "./decisionCalibrationPromotion";

type GovernedSport = Extract<Sport, "football" | "basketball" | "tennis">;

export type ChallengerCandidateRow = {
  id: string;
  sport: GovernedSport;
  model_key: string;
  engine_version: string;
  window_end: string | null;
  metrics: Record<string, unknown> | null;
};

export type ChampionChallengerPreviewResult =
  | {
      status: "ready";
      champion: ActiveCalibrationPromotion;
      challenger: {
        candidateId: string;
        sport: GovernedSport;
        modelKey: string;
        engineVersion: string;
        evaluationWindowStart: string;
      };
      receipt: ChampionChallengerReceipt;
    }
  | { status: "not-applicable" | "not-configured" | "not-found" | "pending-migration" | "failed"; reason: string };

export type ChampionChallengerStoreResult = {
  status: "stored" | "reused" | "not-applicable" | "not-configured" | "not-found" | "pending-migration" | "failed";
  configured: boolean;
  table: "op_model_comparison_receipts";
  id?: string;
  receipt?: ChampionChallengerReceipt;
  reason?: string;
};

export type ChampionChallengerSweepResult = {
  status: "completed" | "not-configured" | "pending-migration" | "failed";
  candidatesInspected: number;
  comparisons: ChampionChallengerStoreResult[];
  reason?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function tableMissing(reason: string | undefined, name: string): boolean {
  const message = reason?.toLowerCase() ?? "";
  return message.includes(name.toLowerCase()) && (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"));
}

function candidateReady(candidate: ChallengerCandidateRow): boolean {
  return record(record(candidate.metrics).promotionReadiness).status === "ready-shadow-review";
}

export function selectEarliestReadyChallengerCandidates(
  candidates: ChallengerCandidateRow[],
  limit = 12
): ChallengerCandidateRow[] {
  const earliestReadyByIdentity = new Map<string, ChallengerCandidateRow>();
  for (const candidate of candidates) {
    if (!candidateReady(candidate)) continue;
    const windowEnd = Date.parse(candidate.window_end ?? "");
    if (!Number.isFinite(windowEnd)) continue;
    const identity = `${candidate.model_key}\u0000${candidate.engine_version}`;
    const existing = earliestReadyByIdentity.get(identity);
    if (!existing || windowEnd < Date.parse(existing.window_end ?? "")) {
      earliestReadyByIdentity.set(identity, candidate);
    }
  }
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 12;
  return [...earliestReadyByIdentity.values()]
    .sort((left, right) => Date.parse(left.window_end ?? "") - Date.parse(right.window_end ?? ""))
    .slice(0, safeLimit);
}

async function readChallengerCandidate(candidateId: string): Promise<ChallengerCandidateRow | { error: string; pendingMigration?: boolean } | null> {
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };
  const result = await client
    .from("op_calibration_candidates")
    .select("id,sport,model_key,engine_version,window_end,metrics")
    .eq("id", candidateId)
    .maybeSingle();
  if (result.error) return { error: result.error.message, pendingMigration: tableMissing(result.error.message, "op_calibration_candidates") };
  return result.data ? result.data as ChallengerCandidateRow : null;
}

export async function previewChampionChallengerComparison({
  sport,
  challengerCandidateId,
  now = new Date()
}: {
  sport: GovernedSport;
  challengerCandidateId: string;
  now?: Date;
}): Promise<ChampionChallengerPreviewResult> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return { status: "not-configured", reason: `Supabase server reads are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.` };
  }
  const promotionResult = await readActiveCalibrationPromotion(sport, now);
  if (promotionResult.status !== "found") {
    if (promotionResult.status === "not-found") {
      return { status: "not-applicable", reason: `No active ${sport} champion exists; the first promotion is a bootstrap decision.` };
    }
    return {
      status: promotionResult.status === "pending-migration" ? "pending-migration" : "failed",
      reason: promotionResult.reason ?? `No unambiguous active ${sport} champion promotion exists.`
    };
  }
  const candidateResult = await readChallengerCandidate(challengerCandidateId);
  if (!candidateResult) return { status: "not-found", reason: "Challenger calibration candidate was not found." };
  if ("error" in candidateResult) {
    return { status: candidateResult.pendingMigration ? "pending-migration" : "failed", reason: candidateResult.error };
  }
  if (candidateResult.sport !== sport) return { status: "failed", reason: "Challenger sport does not match the active champion sport." };
  if (!candidateReady(candidateResult)) return { status: "failed", reason: "Challenger candidate has not passed shadow-review calibration gates." };
  if (!candidateResult.window_end) return { status: "failed", reason: "Challenger candidate lacks a frozen evaluation window boundary." };
  const champion = promotionResult.promotion;
  if (champion.modelKey === candidateResult.model_key && champion.engineVersion === candidateResult.engine_version) {
    return { status: "not-applicable", reason: "The candidate refreshes the exact champion identity; paired challenger comparison applies only to a distinct model or engine." };
  }

  const client = getSupabaseServerClient();
  if (!client) return { status: "failed", reason: "Supabase client could not be created." };
  const outcomesResult = await client
    .from("op_prediction_outcomes")
    .select("id,decision_run_id,fixture_external_id,sport,market,selection,model_probability,implied_probability,value_edge,odds,closing_odds,result,settled_at,created_at")
    .eq("sport", sport)
    .neq("result", "pending")
    .gt("settled_at", candidateResult.window_end)
    .lte("settled_at", now.toISOString())
    .order("settled_at", { ascending: false })
    .limit(5000);
  if (outcomesResult.error) return { status: "failed", reason: outcomesResult.error.message };
  const shadowResult = await client
    .from("op_shadow_predictions")
    .select("id,fixture_external_id,sport,market,selection,model_probability,implied_probability,odds,closing_odds,result,settled_at,generated_at,model_key,engine_version")
    .eq("sport", sport)
    .neq("result", "pending")
    .gt("settled_at", candidateResult.window_end)
    .lte("settled_at", now.toISOString())
    .order("settled_at", { ascending: false })
    .limit(5000);
  if (shadowResult.error) {
    return {
      status: tableMissing(shadowResult.error.message, "op_shadow_predictions") ? "pending-migration" : "failed",
      reason: shadowResult.error.message
    };
  }
  const shadowOutcomes = (shadowResult.data ?? []).map((row) => ({
    ...row,
    decision_run_id: null,
    value_edge: typeof row.model_probability === "number" && typeof row.implied_probability === "number"
      ? row.model_probability - row.implied_probability
      : null,
    created_at: row.generated_at
  })) as OutcomeRow[];
  const outcomes = [...(outcomesResult.data ?? []) as OutcomeRow[], ...shadowOutcomes];
  const runIds = [...new Set(outcomes.map((row) => row.decision_run_id).filter((id): id is string => Boolean(id)))];
  let decisionRuns: DecisionRunRow[] = [];
  if (runIds.length) {
    const runsResult = await client.from("op_decision_runs").select("id,confidence,health,engine_version,model_key").in("id", runIds);
    if (runsResult.error) return { status: "failed", reason: runsResult.error.message };
    decisionRuns = (runsResult.data ?? []) as DecisionRunRow[];
  }
  const challenger = {
    candidateId: candidateResult.id,
    sport,
    modelKey: candidateResult.model_key,
    engineVersion: candidateResult.engine_version,
    evaluationWindowStart: candidateResult.window_end
  };
  const receipt = buildChampionChallengerReceipt({
    sport,
    champion: { promotionId: champion.id, modelKey: champion.modelKey, engineVersion: champion.engineVersion },
    challenger: { candidateId: challenger.candidateId, modelKey: challenger.modelKey, engineVersion: challenger.engineVersion },
    evaluationWindowStart: challenger.evaluationWindowStart,
    outcomes,
    decisionRuns,
    now
  });
  return { status: "ready", champion, challenger, receipt };
}

async function findStoredReceipt(receiptHash: string): Promise<{ id: string; receipt: ChampionChallengerReceipt } | { error: string; pendingMigration?: boolean } | null> {
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };
  const result = await client.from("op_model_comparison_receipts").select("id,metrics").eq("receipt_hash", receiptHash).maybeSingle();
  if (result.error) return { error: result.error.message, pendingMigration: tableMissing(result.error.message, "op_model_comparison_receipts") };
  if (!result.data?.id) return null;
  const metrics = record(result.data.metrics);
  if (metrics.version !== "champion-challenger-v1" || metrics.receiptHash !== receiptHash) {
    return { error: "Stored champion-challenger receipt metrics do not match their immutable receipt hash." };
  }
  return { id: String(result.data.id), receipt: metrics as ChampionChallengerReceipt };
}

export async function runAndStoreChampionChallengerComparison({
  sport,
  challengerCandidateId,
  now = new Date()
}: {
  sport: GovernedSport;
  challengerCandidateId: string;
  now?: Date;
}): Promise<ChampionChallengerStoreResult> {
  const preview = await previewChampionChallengerComparison({ sport, challengerCandidateId, now });
  if (preview.status !== "ready") {
    return {
      status: preview.status,
      configured: preview.status !== "not-configured",
      table: "op_model_comparison_receipts",
      reason: preview.reason
    };
  }
  const existing = await findStoredReceipt(preview.receipt.receiptHash);
  if (existing && "error" in existing) {
    return {
      status: existing.pendingMigration ? "pending-migration" : "failed",
      configured: true,
      table: "op_model_comparison_receipts",
      receipt: preview.receipt,
      reason: existing.error
    };
  }
  if (existing) return { status: "reused", configured: true, table: "op_model_comparison_receipts", id: existing.id, receipt: existing.receipt };

  const client = getSupabaseServerClient();
  if (!client) return { status: "failed", configured: true, table: "op_model_comparison_receipts", receipt: preview.receipt, reason: "Supabase client could not be created." };
  const result = await client.from("op_model_comparison_receipts").insert({
    sport,
    champion_promotion_id: preview.champion.id,
    champion_model_key: preview.champion.modelKey,
    champion_engine_version: preview.champion.engineVersion,
    challenger_candidate_id: preview.challenger.candidateId,
    challenger_model_key: preview.challenger.modelKey,
    challenger_engine_version: preview.challenger.engineVersion,
    evaluation_window_start: preview.challenger.evaluationWindowStart,
    latest_paired_outcome_at: preview.receipt.latestPairedOutcomeAt,
    paired_size: preview.receipt.sample.paired,
    paired_fixture_hash: preview.receipt.pairedFixtureHash,
    receipt_hash: preview.receipt.receiptHash,
    status: preview.receipt.status,
    eligible_for_promotion: preview.receipt.eligibleForPromotion,
    metrics: preview.receipt,
    generated_at: preview.receipt.asOf
  }).select("id").single();
  if (result.error) {
    if (tableMissing(result.error.message, "op_model_comparison_receipts")) {
      return { status: "pending-migration", configured: true, table: "op_model_comparison_receipts", receipt: preview.receipt, reason: result.error.message };
    }
    const raced = await findStoredReceipt(preview.receipt.receiptHash);
    if (raced && !("error" in raced)) return { status: "reused", configured: true, table: "op_model_comparison_receipts", id: raced.id, receipt: raced.receipt };
    return { status: "failed", configured: true, table: "op_model_comparison_receipts", receipt: preview.receipt, reason: result.error.message };
  }
  return { status: "stored", configured: true, table: "op_model_comparison_receipts", id: String(result.data.id), receipt: preview.receipt };
}

export async function runChampionChallengerSweep({
  sport,
  now = new Date(),
  limit = 12
}: {
  sport: GovernedSport;
  now?: Date;
  limit?: number;
}): Promise<ChampionChallengerSweepResult> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return {
      status: "not-configured",
      candidatesInspected: 0,
      comparisons: [],
      reason: `Supabase server reads are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }
  const client = getSupabaseServerClient();
  if (!client) return { status: "failed", candidatesInspected: 0, comparisons: [], reason: "Supabase client could not be created." };
  const candidatesResult = await client
    .from("op_calibration_candidates")
    .select("id,sport,model_key,engine_version,window_end,metrics")
    .eq("sport", sport)
    .not("window_end", "is", null)
    .lt("window_end", now.toISOString())
    .order("window_end", { ascending: true })
    .limit(500);
  if (candidatesResult.error) {
    return {
      status: tableMissing(candidatesResult.error.message, "op_calibration_candidates") ? "pending-migration" : "failed",
      candidatesInspected: 0,
      comparisons: [],
      reason: candidatesResult.error.message
    };
  }
  const eligible = selectEarliestReadyChallengerCandidates((candidatesResult.data ?? []) as ChallengerCandidateRow[], limit);
  const comparisons: ChampionChallengerStoreResult[] = [];
  for (const candidate of eligible) {
    comparisons.push(await runAndStoreChampionChallengerComparison({ sport, challengerCandidateId: candidate.id, now }));
  }
  return { status: "completed", candidatesInspected: eligible.length, comparisons };
}
