import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import type { Sport } from "@/lib/sports/types";

export type PredictionOutcomeResult = "pending" | "won" | "lost" | "push" | "void";

export type PredictionOutcomeInput = {
  decisionRunId?: string | null;
  fixtureExternalId: string;
  sport: Sport;
  market: string;
  selection: string;
  modelProbability?: number | null;
  impliedProbability?: number | null;
  valueEdge?: number | null;
  odds?: number | null;
  closingOdds?: number | null;
  result: PredictionOutcomeResult;
  settledAt?: string | null;
  source?: string;
  metadata?: Record<string, unknown>;
};

export type PredictionOutcomeWriteResult = {
  status: "stored" | "reused" | "not-configured" | "failed";
  configured: boolean;
  table: "op_prediction_outcomes";
  id?: string;
  reason?: string;
};

export type PredictionOutcomeClosingLineInput = {
  outcomeId: string;
  closingOdds: number;
  capturedAt: string;
  metadata?: Record<string, unknown>;
};

const validSports = new Set(["football", "basketball", "tennis", "cricket", "rugby", "handball"]);
const validResults = new Set(["pending", "won", "lost", "push", "void"]);

export function classifyPredictionOutcomeTransition(
  existingResult: PredictionOutcomeResult | null | undefined,
  requestedResult: PredictionOutcomeResult
): "insert" | "reuse" | "settle" | "reject" {
  if (!existingResult) return "insert";
  if (existingResult === "pending") return requestedResult === "pending" ? "reuse" : "settle";
  return existingResult === requestedResult ? "reuse" : "reject";
}

export function isPredictionOutcomeIdempotencyConflict(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return error?.code === "23505" || message.includes("duplicate key") || message.includes("unique constraint");
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function parsePredictionOutcomeInput(value: unknown): PredictionOutcomeInput | { error: string } {
  if (!value || typeof value !== "object") return { error: "Body must be a JSON object." };
  const record = value as Record<string, unknown>;
  const fixtureExternalId = boundedText(record.fixtureExternalId, 120);
  const sport = boundedText(record.sport, 40);
  const market = boundedText(record.market, 120);
  const selection = boundedText(record.selection, 160);
  const result = boundedText(record.result, 20);
  const decisionRunId = record.decisionRunId === undefined || record.decisionRunId === null ? null : boundedText(record.decisionRunId, 80);
  const source = boundedText(record.source ?? "manual", 80) ?? "manual";

  if (!fixtureExternalId) return { error: "fixtureExternalId is required." };
  if (!sport || !validSports.has(sport)) return { error: "sport is invalid." };
  if (!market) return { error: "market is required." };
  if (!selection) return { error: "selection is required." };
  if (!result || !validResults.has(result)) return { error: "result is invalid." };
  if (record.decisionRunId && !decisionRunId) return { error: "decisionRunId is invalid." };

  const modelProbability = nullableNumber(record.modelProbability);
  const impliedProbability = nullableNumber(record.impliedProbability);
  const valueEdge = nullableNumber(record.valueEdge);
  const odds = nullableNumber(record.odds);
  const closingOdds = nullableNumber(record.closingOdds);
  if ([modelProbability, impliedProbability, valueEdge, odds, closingOdds].some((item) => item === undefined)) {
    return { error: "Numeric fields must be finite numbers, null, or omitted." };
  }

  return {
    decisionRunId,
    fixtureExternalId,
    sport: sport as Sport,
    market,
    selection,
    modelProbability,
    impliedProbability,
    valueEdge,
    odds,
    closingOdds,
    result: result as PredictionOutcomeResult,
    settledAt: typeof record.settledAt === "string" && record.settledAt.trim() ? record.settledAt.trim() : null,
    source,
    metadata: record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : {}
  };
}

export async function storePredictionOutcome(input: PredictionOutcomeInput): Promise<PredictionOutcomeWriteResult> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return {
      status: "not-configured",
      configured: false,
      table: "op_prediction_outcomes",
      reason: `Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return {
      status: "failed",
      configured: true,
      table: "op_prediction_outcomes",
      reason: "Supabase client could not be created."
    };
  }

  const payload = {
    decision_run_id: input.decisionRunId ?? null,
    fixture_external_id: input.fixtureExternalId,
    sport: input.sport,
    market: input.market,
    selection: input.selection,
    model_probability: input.modelProbability ?? null,
    implied_probability: input.impliedProbability ?? null,
    value_edge: input.valueEdge ?? null,
    odds: input.odds ?? null,
    closing_odds: input.closingOdds ?? null,
    result: input.result,
    settled_at: input.settledAt ?? null,
    source: input.source ?? "manual",
    metadata: input.metadata ?? {},
    updated_at: new Date().toISOString()
  };

  if (input.decisionRunId) {
    const { data: existing, error: lookupError } = await client
      .from("op_prediction_outcomes")
      .select("id,result")
      .eq("decision_run_id", input.decisionRunId)
      .eq("market", input.market)
      .eq("selection", input.selection)
      .limit(1)
      .maybeSingle();
    if (lookupError) {
      return { status: "failed", configured: true, table: "op_prediction_outcomes", reason: lookupError.message };
    }
    if (existing && typeof existing.id === "string") {
      const transition = classifyPredictionOutcomeTransition(existing.result as PredictionOutcomeResult, input.result);
      if (transition === "reject") {
        return {
          status: "failed",
          configured: true,
          table: "op_prediction_outcomes",
          id: existing.id,
          reason: "A settled outcome cannot be rewritten. Store a reviewed correction separately instead."
        };
      }
      if (transition === "reuse") {
        return {
          status: "reused",
          configured: true,
          table: "op_prediction_outcomes",
          id: existing.id,
          reason: existing.result === "pending" ? "The pending shadow outcome already exists for this decision run and selection." : "The immutable settled outcome already exists for this decision run and selection."
        };
      }

      const update = await client
        .from("op_prediction_outcomes")
        .update(payload)
        .eq("id", existing.id)
        .eq("result", "pending")
        .select("id")
        .maybeSingle();
      if (update.error) {
        return { status: "failed", configured: true, table: "op_prediction_outcomes", reason: update.error.message };
      }
      if (typeof update.data?.id === "string") {
        return { status: "stored", configured: true, table: "op_prediction_outcomes", id: update.data.id };
      }
      return {
        status: "failed",
        configured: true,
        table: "op_prediction_outcomes",
        id: existing.id,
        reason: "The pending outcome changed before its final result could be stored; retry after inspecting the stored settlement."
      };
    }
  }

  const { data, error } = await client
    .from("op_prediction_outcomes")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (input.decisionRunId && isPredictionOutcomeIdempotencyConflict(error)) {
      const { data: concurrent, error: concurrentLookupError } = await client
        .from("op_prediction_outcomes")
        .select("id,result")
        .eq("decision_run_id", input.decisionRunId)
        .eq("market", input.market)
        .eq("selection", input.selection)
        .limit(1)
        .maybeSingle();

      if (concurrentLookupError) {
        return {
          status: "failed",
          configured: true,
          table: "op_prediction_outcomes",
          reason: `Outcome insert conflicted and the winning row could not be read: ${concurrentLookupError.message}`
        };
      }

      if (concurrent && typeof concurrent.id === "string") {
        const transition = classifyPredictionOutcomeTransition(concurrent.result as PredictionOutcomeResult, input.result);
        if (transition === "reuse") {
          return {
            status: "reused",
            configured: true,
            table: "op_prediction_outcomes",
            id: concurrent.id,
            reason: "A concurrent worker already stored the same outcome state."
          };
        }
        if (transition === "reject") {
          return {
            status: "failed",
            configured: true,
            table: "op_prediction_outcomes",
            id: concurrent.id,
            reason: "A concurrent worker already stored a different immutable settlement. Store a reviewed correction separately instead."
          };
        }

        const update = await client
          .from("op_prediction_outcomes")
          .update(payload)
          .eq("id", concurrent.id)
          .eq("result", "pending")
          .select("id")
          .maybeSingle();
        if (update.error) {
          return { status: "failed", configured: true, table: "op_prediction_outcomes", id: concurrent.id, reason: update.error.message };
        }
        if (typeof update.data?.id === "string") {
          return { status: "stored", configured: true, table: "op_prediction_outcomes", id: update.data.id };
        }
        return {
          status: "failed",
          configured: true,
          table: "op_prediction_outcomes",
          id: concurrent.id,
          reason: "The concurrent pending outcome changed before its final result could be stored; inspect the stored settlement before retrying."
        };
      }
    }

    return {
      status: "failed",
      configured: true,
      table: "op_prediction_outcomes",
      reason: error.message
    };
  }

  return {
    status: "stored",
    configured: true,
    table: "op_prediction_outcomes",
    id: typeof data?.id === "string" ? data.id : undefined
  };
}

export async function refreshPredictionOutcomeClosingLine(
  input: PredictionOutcomeClosingLineInput
): Promise<PredictionOutcomeWriteResult> {
  const outcomeId = boundedText(input.outcomeId, 80);
  if (!outcomeId || !Number.isFinite(input.closingOdds) || input.closingOdds <= 1 || !Number.isFinite(Date.parse(input.capturedAt))) {
    return {
      status: "failed",
      configured: true,
      table: "op_prediction_outcomes",
      reason: "Closing-line refresh requires a valid outcome id, decimal odds above 1.0, and capture timestamp."
    };
  }

  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return {
      status: "not-configured",
      configured: false,
      table: "op_prediction_outcomes",
      reason: `Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return { status: "failed", configured: true, table: "op_prediction_outcomes", reason: "Supabase client could not be created." };
  }

  const { data: existing, error: lookupError } = await client
    .from("op_prediction_outcomes")
    .select("id,result,metadata")
    .eq("id", outcomeId)
    .limit(1)
    .maybeSingle();
  if (lookupError) return { status: "failed", configured: true, table: "op_prediction_outcomes", reason: lookupError.message };
  if (!existing || typeof existing.id !== "string") {
    return { status: "failed", configured: true, table: "op_prediction_outcomes", reason: "Pending outcome was not found." };
  }
  if (existing.result !== "pending") {
    return {
      status: "reused",
      configured: true,
      table: "op_prediction_outcomes",
      id: existing.id,
      reason: "Closing odds were not changed because the outcome is already settled."
    };
  }

  const existingMetadata = record(existing.metadata);
  const closingLineMetadata = {
    ...record(existingMetadata.closingLine),
    ...record(input.metadata),
    decimalOdds: input.closingOdds,
    capturedAt: input.capturedAt,
    preKickoff: true
  };
  const { data, error } = await client
    .from("op_prediction_outcomes")
    .update({
      closing_odds: input.closingOdds,
      metadata: { ...existingMetadata, closingLine: closingLineMetadata },
      updated_at: input.capturedAt
    })
    .eq("id", outcomeId)
    .eq("result", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { status: "failed", configured: true, table: "op_prediction_outcomes", reason: error.message };
  if (!data || typeof data.id !== "string") {
    return {
      status: "reused",
      configured: true,
      table: "op_prediction_outcomes",
      id: existing.id,
      reason: "The outcome changed state before the closing-line refresh could be stored."
    };
  }
  return { status: "stored", configured: true, table: "op_prediction_outcomes", id: data.id };
}
