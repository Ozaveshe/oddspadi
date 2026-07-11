import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import {
  buildDecisionMvpAIExperimentObserver,
  resolveDecisionMvpAIExperimentTarget,
  summarizeDecisionMvpAIExperimentPayload,
  type DecisionMvpAIExperimentObservation
} from "@/lib/sports/prediction/decisionMvpAIExperimentObserver";
import { fetchDecisionApiData } from "@/lib/sports/prediction/decisionInternalFetch";
import type { DecisionMvpAIDecisionTurn } from "@/lib/sports/prediction/decisionMvpAIDecisionTurn";

export const dynamic = "force-dynamic";

function shouldRun(url: URL): boolean {
  return url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true";
}

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function decisionTurnUrl(origin: string, date: string, sport: string, limit: string | null): URL {
  const target = new URL("/api/sports/decision/mvp-ai-decision-turn", origin);
  target.searchParams.set("date", date);
  target.searchParams.set("sport", sport);
  if (limit) target.searchParams.set("limit", limit);
  return target;
}

async function fetchJsonObservation(url: string): Promise<DecisionMvpAIExperimentObservation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

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
    const summary = summarizeDecisionMvpAIExperimentPayload(parsed);

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
      error: error instanceof Error ? error.message : "MVP experiment proof fetch failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runRequested = shouldRun(url);
  const limit = url.searchParams.get("limit");
  const decisionTurn = await fetchDecisionApiData<DecisionMvpAIDecisionTurn>(decisionTurnUrl(url.origin, query.date, query.sport, limit), {
    timeoutMs: 120000,
    maxAttempts: 2
  });
  if (!decisionTurn) return apiError("Unable to build the MVP AI decision turn before experiment observation.", 502);

  const target = resolveDecisionMvpAIExperimentTarget({ decisionTurn, origin: url.origin });
  const observation = runRequested && target.allowed && target.url ? await fetchJsonObservation(target.url) : undefined;

  return apiSuccess(
    buildDecisionMvpAIExperimentObserver({
      decisionTurn,
      observation,
      origin: url.origin
    })
  );
}
