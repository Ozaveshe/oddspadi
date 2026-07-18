import { createHash } from "node:crypto";
import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import { buildPrediction } from "@/lib/sports/service";
import type { Match, Prediction } from "@/lib/sports/types";
import type { PredictionOutcomeInput, PredictionOutcomeResult } from "./decisionOutcomes";
import type { ShadowModelArtifact } from "./shadowModelArtifact";

export type ShadowPredictionDraft = {
  championOutcomeId: string;
  championDecisionRunId: string;
  fixtureExternalId: string;
  sport: ShadowModelArtifact["sport"];
  market: string;
  selection: string;
  modelKey: string;
  engineVersion: string;
  modelArtifactHash: string;
  inputHash: string;
  championModelProbability: number;
  modelProbability: number;
  impliedProbability: number | null;
  odds: number | null;
  kickoffAt: string;
  generatedAt: string;
  metadata: Record<string, unknown>;
};

export type ShadowPredictionBuildResult =
  | { status: "ready"; draft: ShadowPredictionDraft }
  | { status: "not-applicable" | "failed"; reason: string };

export type ShadowPredictionStoreResult = {
  status: "stored" | "reused" | "not-applicable" | "not-configured" | "pending-migration" | "failed";
  configured: boolean;
  table: "op_shadow_predictions";
  id?: string;
  modelKey?: string;
  modelProbability?: number;
  reason?: string;
};

export type ShadowPredictionSettlementResult = {
  status: "settled" | "reused" | "waiting" | "no-pending" | "not-configured" | "pending-migration" | "partial" | "failed";
  configured: boolean;
  table: "op_shadow_predictions";
  totals: { pending: number; settled: number; reused: number; waiting: number; failed: number };
  reason?: string;
};

type ShadowPredictionRow = {
  id: string;
  champion_outcome_id: string;
  champion_decision_run_id: string;
  fixture_external_id: string;
  sport: ShadowModelArtifact["sport"];
  market: string;
  selection: string;
  model_key: string;
  engine_version: string;
  model_artifact_hash: string;
  input_hash: string;
  model_probability: number;
  result: PredictionOutcomeResult;
  metadata: Record<string, unknown> | null;
};

type ChampionOutcomeRow = {
  id: string;
  decision_run_id: string | null;
  fixture_external_id: string;
  sport: string;
  market: string;
  selection: string;
  closing_odds: number | null;
  result: PredictionOutcomeResult;
  settled_at: string | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function tableMissing(reason: string | undefined, table: string): boolean {
  const message = reason?.toLowerCase() ?? "";
  return message.includes(table) && (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"));
}

function finiteProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function finiteDecimalOdds(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 1;
}

function idempotencyConflict(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return error?.code === "23505" || message.includes("duplicate key") || message.includes("unique constraint");
}

export function buildShadowPredictionDraft({
  match,
  championPrediction,
  championOutcome,
  championOutcomeId,
  artifact,
  now = new Date()
}: {
  match: Match;
  championPrediction: Prediction;
  championOutcome: PredictionOutcomeInput;
  championOutcomeId: string;
  artifact: ShadowModelArtifact;
  now?: Date;
}): ShadowPredictionBuildResult {
  if (match.sport !== artifact.sport || championOutcome.sport !== artifact.sport) {
    return { status: "failed", reason: "Shadow artifact, fixture, and champion outcome sport must match exactly." };
  }
  if (match.dataSource?.kind !== "provider") {
    return { status: "not-applicable", reason: "Shadow inference requires a verified provider fixture." };
  }
  const kickoffAt = Date.parse(match.kickoffTime);
  if (match.status !== "scheduled" || !Number.isFinite(kickoffAt) || now.getTime() >= kickoffAt) {
    return { status: "not-applicable", reason: "Shadow inference is pre-kickoff only; live, finished, or invalid fixtures are rejected." };
  }
  if (!championOutcome.decisionRunId || championOutcome.result !== "pending") {
    return { status: "failed", reason: "Shadow inference requires an exact pending champion outcome with a durable decision run." };
  }
  if (
    championOutcome.fixtureExternalId !== match.id ||
    !finiteProbability(championOutcome.modelProbability) ||
    !championOutcome.market ||
    !championOutcome.selection
  ) {
    return { status: "failed", reason: "Champion outcome identity or probability is incomplete." };
  }

  const championPredictionProbability = championPrediction.markets
    .find((market) => market.marketId === championOutcome.market)
    ?.probabilities[championOutcome.selection];
  if (
    championPrediction.matchId !== match.id ||
    championPrediction.sport !== match.sport ||
    !championPrediction.evidenceHash?.trim() ||
    !finiteProbability(championPredictionProbability) ||
    Math.abs(championPredictionProbability - championOutcome.modelProbability) >= 0.000001
  ) {
    return { status: "failed", reason: "Champion prediction evidence does not match the durable outcome identity and probability." };
  }
  if (
    (championOutcome.impliedProbability != null && !finiteProbability(championOutcome.impliedProbability)) ||
    (championOutcome.odds != null && !finiteDecimalOdds(championOutcome.odds))
  ) {
    return { status: "failed", reason: "Champion market evidence contains an invalid implied probability or decimal price." };
  }

  const challengerPrediction = buildPrediction(match, { modelOverride: artifact.modelOverride, now });
  const challengerProbability = challengerPrediction.markets
    .find((market) => market.marketId === championOutcome.market)
    ?.probabilities[championOutcome.selection];
  if (!finiteProbability(challengerProbability)) {
    return { status: "failed", reason: "The challenger did not produce the champion's exact market and selection probability." };
  }
  if (Math.abs(challengerProbability - championOutcome.modelProbability) < 0.000001) {
    return { status: "not-applicable", reason: "The challenger probability is identical to the champion for this exact selection." };
  }

  const generatedAt = now.toISOString();
  const inputHash = sha256({
    version: "shadow-prediction-input-v1",
    championOutcomeId,
    championDecisionRunId: championOutcome.decisionRunId,
    championEvidenceHash: championPrediction.evidenceHash,
    fixtureExternalId: match.id,
    market: championOutcome.market,
    selection: championOutcome.selection,
    championModelProbability: championOutcome.modelProbability,
    modelArtifactHash: artifact.artifactHash,
    kickoffAt: match.kickoffTime
  });
  return {
    status: "ready",
    draft: {
      championOutcomeId,
      championDecisionRunId: championOutcome.decisionRunId,
      fixtureExternalId: match.id,
      sport: artifact.sport,
      market: championOutcome.market,
      selection: championOutcome.selection,
      modelKey: artifact.modelKey,
      engineVersion: artifact.engineVersion,
      modelArtifactHash: artifact.artifactHash,
      inputHash,
      championModelProbability: championOutcome.modelProbability,
      modelProbability: challengerProbability,
      impliedProbability: championOutcome.impliedProbability ?? null,
      odds: championOutcome.odds ?? null,
      kickoffAt: match.kickoffTime,
      generatedAt,
      metadata: {
        paperOnly: true,
        privateShadow: true,
        championEvidenceHash: championPrediction.evidenceHash,
        baseModelKey: artifact.baseModelKey,
        sourceBacktestId: artifact.sourceBacktestId,
        sourceBacktestCreatedAt: artifact.sourceBacktestCreatedAt,
        frozenWindowEnd: artifact.frozenWindowEnd,
        baselineMarketPriorWeightScale: artifact.baselineMarketPriorWeightScale,
        candidateMarketPriorWeightScale: artifact.candidateMarketPriorWeightScale,
        historicalVerdict: artifact.validation.historicalVerdict,
        pairingPolicy: "exact-champion-fixture-market-selection",
        publicExposure: false,
        automaticPromotion: false
      }
    }
  };
}

function artifactConfig(artifact: ShadowModelArtifact): Record<string, unknown> {
  return {
    shadowArtifact: {
      version: artifact.version,
      artifactHash: artifact.artifactHash,
      baseModelKey: artifact.baseModelKey,
      engineVersion: artifact.engineVersion,
      sourceBacktestId: artifact.sourceBacktestId,
      sourceBacktestCreatedAt: artifact.sourceBacktestCreatedAt,
      frozenWindowEnd: artifact.frozenWindowEnd,
      baselineMarketPriorWeightScale: artifact.baselineMarketPriorWeightScale,
      candidateMarketPriorWeightScale: artifact.candidateMarketPriorWeightScale,
      validation: artifact.validation,
      controls: artifact.controls
    }
  };
}

async function resolveModelVersion(artifact: ShadowModelArtifact): Promise<{ id?: string; reason?: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { reason: "Supabase client could not be created." };
  const existing = await client.from("op_model_versions").select("id,config").eq("model_key", artifact.modelKey).maybeSingle();
  if (existing.error) return { reason: existing.error.message };
  if (existing.data?.id) {
    const storedHash = record(record(existing.data.config).shadowArtifact).artifactHash;
    return storedHash === artifact.artifactHash
      ? { id: String(existing.data.id) }
      : { reason: "Stored model key resolves to a different immutable shadow artifact hash." };
  }
  const inserted = await client.from("op_model_versions").insert({
    model_key: artifact.modelKey,
    sport: artifact.sport,
    model_type: "private-shadow-market-prior-challenger",
    version_label: artifact.modelKey,
    description: "Frozen private challenger evaluated only against exact champion selections.",
    metrics: artifact.validation,
    config: artifactConfig(artifact),
    is_active: false
  }).select("id").single();
  if (!inserted.error && inserted.data?.id) return { id: String(inserted.data.id) };
  const raced = await client.from("op_model_versions").select("id,config").eq("model_key", artifact.modelKey).maybeSingle();
  const racedHash = record(record(raced.data?.config).shadowArtifact).artifactHash;
  if (raced.data?.id && racedHash === artifact.artifactHash) return { id: String(raced.data.id) };
  return { reason: inserted.error?.message ?? raced.error?.message ?? "Shadow model registration failed." };
}

export async function storeShadowPrediction({
  match,
  championPrediction,
  championOutcome,
  championOutcomeId,
  artifact,
  now = new Date()
}: {
  match: Match;
  championPrediction: Prediction;
  championOutcome: PredictionOutcomeInput;
  championOutcomeId: string;
  artifact: ShadowModelArtifact;
  now?: Date;
}): Promise<ShadowPredictionStoreResult> {
  const built = buildShadowPredictionDraft({ match, championPrediction, championOutcome, championOutcomeId, artifact, now });
  if (built.status !== "ready") {
    return { status: built.status, configured: true, table: "op_shadow_predictions", modelKey: artifact.modelKey, reason: built.reason };
  }
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return { status: "not-configured", configured: false, table: "op_shadow_predictions", modelKey: artifact.modelKey, reason: `Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.` };
  }
  const client = getSupabaseServerClient();
  if (!client) return { status: "failed", configured: true, table: "op_shadow_predictions", modelKey: artifact.modelKey, reason: "Supabase client could not be created." };
  const draft = built.draft;
  const existing = await client.from("op_shadow_predictions")
    .select("id,input_hash,model_probability")
    .eq("champion_outcome_id", draft.championOutcomeId)
    .eq("model_artifact_hash", draft.modelArtifactHash)
    .maybeSingle();
  if (existing.error) {
    return { status: tableMissing(existing.error.message, "op_shadow_predictions") ? "pending-migration" : "failed", configured: true, table: "op_shadow_predictions", modelKey: artifact.modelKey, reason: existing.error.message };
  }
  if (existing.data?.id) {
    const same = existing.data.input_hash === draft.inputHash && Math.abs(Number(existing.data.model_probability) - draft.modelProbability) < 0.000001;
    return same
      ? { status: "reused", configured: true, table: "op_shadow_predictions", id: String(existing.data.id), modelKey: artifact.modelKey, modelProbability: draft.modelProbability }
      : { status: "failed", configured: true, table: "op_shadow_predictions", id: String(existing.data.id), modelKey: artifact.modelKey, reason: "An immutable shadow prediction already exists with different evidence or probability." };
  }
  const modelVersion = await resolveModelVersion(artifact);
  if (!modelVersion.id) return { status: "failed", configured: true, table: "op_shadow_predictions", modelKey: artifact.modelKey, reason: modelVersion.reason };
  const inserted = await client.from("op_shadow_predictions").insert({
    model_version_id: modelVersion.id,
    champion_outcome_id: draft.championOutcomeId,
    champion_decision_run_id: draft.championDecisionRunId,
    fixture_external_id: draft.fixtureExternalId,
    sport: draft.sport,
    market: draft.market,
    selection: draft.selection,
    model_key: draft.modelKey,
    engine_version: draft.engineVersion,
    model_artifact_hash: draft.modelArtifactHash,
    input_hash: draft.inputHash,
    champion_model_probability: draft.championModelProbability,
    model_probability: draft.modelProbability,
    implied_probability: draft.impliedProbability,
    odds: draft.odds,
    closing_odds: null,
    result: "pending",
    kickoff_at: draft.kickoffAt,
    generated_at: draft.generatedAt,
    settled_at: null,
    metadata: draft.metadata,
    updated_at: draft.generatedAt
  }).select("id").single();
  if (inserted.error) {
    if (idempotencyConflict(inserted.error)) {
      const raced = await client.from("op_shadow_predictions")
        .select("id,input_hash,model_probability")
        .eq("champion_outcome_id", draft.championOutcomeId)
        .eq("model_artifact_hash", draft.modelArtifactHash)
        .maybeSingle();
      if (raced.error) {
        return {
          status: "failed",
          configured: true,
          table: "op_shadow_predictions",
          modelKey: artifact.modelKey,
          reason: `Shadow insert conflicted and the winning row could not be read: ${raced.error.message}`
        };
      }
      if (raced.data?.id) {
        const same = raced.data.input_hash === draft.inputHash && Math.abs(Number(raced.data.model_probability) - draft.modelProbability) < 0.000001;
        return same
          ? { status: "reused", configured: true, table: "op_shadow_predictions", id: String(raced.data.id), modelKey: artifact.modelKey, modelProbability: draft.modelProbability, reason: "A concurrent worker stored the identical immutable shadow prediction." }
          : { status: "failed", configured: true, table: "op_shadow_predictions", id: String(raced.data.id), modelKey: artifact.modelKey, reason: "A concurrent worker stored different immutable shadow evidence for the same champion and artifact." };
      }
    }
    return { status: tableMissing(inserted.error.message, "op_shadow_predictions") ? "pending-migration" : "failed", configured: true, table: "op_shadow_predictions", modelKey: artifact.modelKey, reason: inserted.error.message };
  }
  return { status: "stored", configured: true, table: "op_shadow_predictions", id: String(inserted.data.id), modelKey: artifact.modelKey, modelProbability: draft.modelProbability };
}

export async function settlePendingShadowPredictions({
  sport,
  limit = 500,
  now = new Date()
}: {
  sport: ShadowModelArtifact["sport"];
  limit?: number;
  now?: Date;
}): Promise<ShadowPredictionSettlementResult> {
  const empty = { pending: 0, settled: 0, reused: 0, waiting: 0, failed: 0 };
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) return { status: "not-configured", configured: false, table: "op_shadow_predictions", totals: empty, reason: `Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.` };
  const client = getSupabaseServerClient();
  if (!client) return { status: "failed", configured: true, table: "op_shadow_predictions", totals: empty, reason: "Supabase client could not be created." };
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.trunc(limit))) : 500;
  const pendingResult = await client.from("op_shadow_predictions")
    .select("id,champion_outcome_id,champion_decision_run_id,fixture_external_id,sport,market,selection,model_key,engine_version,model_artifact_hash,input_hash,model_probability,result,metadata")
    .eq("sport", sport).eq("result", "pending").order("created_at", { ascending: true }).limit(safeLimit);
  if (pendingResult.error) return { status: tableMissing(pendingResult.error.message, "op_shadow_predictions") ? "pending-migration" : "failed", configured: true, table: "op_shadow_predictions", totals: empty, reason: pendingResult.error.message };
  const pending = (pendingResult.data ?? []) as ShadowPredictionRow[];
  if (!pending.length) return { status: "no-pending", configured: true, table: "op_shadow_predictions", totals: empty };
  const championIds = [...new Set(pending.map((row) => row.champion_outcome_id))];
  const championRows: ChampionOutcomeRow[] = [];
  for (let offset = 0; offset < championIds.length; offset += 100) {
    const result = await client.from("op_prediction_outcomes")
      .select("id,decision_run_id,fixture_external_id,sport,market,selection,closing_odds,result,settled_at")
      .in("id", championIds.slice(offset, offset + 100));
    if (result.error) return { status: "failed", configured: true, table: "op_shadow_predictions", totals: { ...empty, pending: pending.length, failed: pending.length }, reason: result.error.message };
    championRows.push(...(result.data ?? []) as ChampionOutcomeRow[]);
  }
  const champions = new Map(championRows.map((row) => [row.id, row]));
  const totals = { ...empty, pending: pending.length };
  for (const row of pending) {
    const champion = champions.get(row.champion_outcome_id);
    if (!champion || champion.decision_run_id !== row.champion_decision_run_id || champion.fixture_external_id !== row.fixture_external_id || champion.sport !== row.sport || champion.market !== row.market || champion.selection !== row.selection) {
      totals.failed += 1;
      continue;
    }
    if (champion.result === "pending") {
      totals.waiting += 1;
      continue;
    }
    if (!champion.settled_at || !["won", "lost", "push", "void"].includes(champion.result)) {
      totals.failed += 1;
      continue;
    }
    const update = await client.from("op_shadow_predictions").update({
      result: champion.result,
      settled_at: champion.settled_at,
      closing_odds: champion.closing_odds,
      metadata: {
        ...record(row.metadata),
        settlement: {
          version: "shadow-settlement-v1",
          source: "exact-champion-outcome",
          championOutcomeId: champion.id,
          championResult: champion.result,
          championSettledAt: champion.settled_at,
          mirroredAt: now.toISOString()
        }
      },
      updated_at: now.toISOString()
    }).eq("id", row.id).eq("result", "pending").select("id").maybeSingle();
    if (update.error) totals.failed += 1;
    else if (update.data?.id) totals.settled += 1;
    else totals.reused += 1;
  }
  const status = totals.failed ? (totals.settled || totals.reused || totals.waiting ? "partial" : "failed") : totals.settled ? "settled" : totals.reused ? "reused" : "waiting";
  return { status, configured: true, table: "op_shadow_predictions", totals };
}
