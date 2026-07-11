import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { fetchDecisionApiData } from "@/lib/sports/prediction/decisionInternalFetch";
import {
  buildDecisionOperatorReceipt,
  resolveDecisionOperatorProofTarget,
  type DecisionOperatorProofObservation
} from "@/lib/sports/prediction/decisionOperatorReceipt";
import type { DecisionOperatorTurn } from "@/lib/sports/prediction/decisionOperatorTurn";

export const dynamic = "force-dynamic";

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function summarizePayload(payload: unknown): Pick<DecisionOperatorProofObservation, "success" | "statusLabel" | "summary" | "signals"> {
  if (!payload || typeof payload !== "object") {
    return {
      success: null,
      statusLabel: null,
      summary: null,
      signals: ["Response was not a JSON object."]
    };
  }

  const record = payload as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : {};
  const counts = data.counts && typeof data.counts === "object" ? (data.counts as Record<string, unknown>) : null;
  const operation = data.nextOperation && typeof data.nextOperation === "object" ? (data.nextOperation as Record<string, unknown>) : null;
  const nextTransition = data.nextTransition && typeof data.nextTransition === "object" ? (data.nextTransition as Record<string, unknown>) : null;

  const statusLabel = stringValue(data.status) ?? stringValue(data.verdict) ?? stringValue(data.trustStatus) ?? stringValue(record.status);
  const summary = stringValue(data.summary) ?? stringValue(data.reason) ?? stringValue(record.error);
  const signals = [
    typeof record.success === "boolean" ? `success:${record.success}` : null,
    statusLabel ? `status:${statusLabel}` : null,
    stringValue(data.mode) ? `mode:${stringValue(data.mode)}` : null,
    typeof data.trustScore === "number" ? `trustScore:${data.trustScore}` : null,
    typeof data.liveReadinessScore === "number" ? `liveReadiness:${data.liveReadinessScore}` : null,
    operation ? `operation:${stringValue(operation.label) ?? "selected"}` : null,
    nextTransition ? `next:${stringValue(nextTransition.label) ?? stringValue(nextTransition.status) ?? "transition"}` : null,
    counts ? `counts:${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(",")}` : null
  ].filter((item): item is string => Boolean(item));

  return {
    success: typeof record.success === "boolean" ? record.success : null,
    statusLabel,
    summary: summary ? compact(summary) : null,
    signals
  };
}

async function fetchJsonText(url: string): Promise<DecisionOperatorProofObservation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    const summary = summarizePayload(parsed);

    return {
      attempted: true,
      ok: response.ok,
      statusCode: response.status,
      contentType: response.headers.get("content-type"),
      responseHash: stableHash(text),
      bodyBytes: text.length,
      success: summary.success,
      statusLabel: summary.statusLabel,
      summary: summary.summary,
      signals: summary.signals,
      error: response.ok ? null : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      statusCode: null,
      contentType: null,
      responseHash: null,
      bodyBytes: 0,
      success: null,
      statusLabel: null,
      summary: null,
      signals: [],
      error: error instanceof Error ? error.message : "Proof fetch failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runRequested = url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true";
  const operatorTurnUrl = new URL("/api/sports/decision/operator-turn", url.origin);
  operatorTurnUrl.searchParams.set("date", query.date);
  operatorTurnUrl.searchParams.set("sport", query.sport);

  const turn = await fetchDecisionApiData<DecisionOperatorTurn>(operatorTurnUrl, { timeoutMs: 45000, maxAttempts: 2 });
  if (!turn) {
    return apiError("Unable to build operator turn before receipt.", 502);
  }

  const target = resolveDecisionOperatorProofTarget({ turn, origin: url.origin });
  const observation = runRequested && target.allowed && target.url ? await fetchJsonText(target.url) : undefined;

  return apiSuccess(
    buildDecisionOperatorReceipt({
      turn,
      runRequested,
      observation,
      origin: url.origin
    })
  );
}
