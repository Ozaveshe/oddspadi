import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import {
  buildDecisionAIExperimentObserver,
  resolveDecisionAIExperimentTarget,
  summarizeDecisionAIExperimentPayload,
  type DecisionAIExperimentObservation
} from "@/lib/sports/prediction/decisionAIExperimentObserver";
import type { DecisionAIExperimentPlanner } from "@/lib/sports/prediction/decisionAIExperimentPlanner";

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

function plannerUrl(origin: string, date: string, sport: string, limit: string | null): URL {
  const target = new URL("/api/sports/decision/ai-experiment-planner", origin);
  target.searchParams.set("date", date);
  target.searchParams.set("sport", sport);
  if (limit) target.searchParams.set("limit", limit);
  return target;
}

async function fetchPlanner(url: URL): Promise<DecisionAIExperimentPlanner | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.success && payload.data) return payload.data as DecisionAIExperimentPlanner;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function fetchJsonText(url: string): Promise<DecisionAIExperimentObservation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    let lastObservation: DecisionAIExperimentObservation | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
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
      const summary = summarizeDecisionAIExperimentPayload(parsed);
      lastObservation = {
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
      if (response.ok || attempt === 1) return lastObservation;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return (
      lastObservation ?? {
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
        error: "Experiment proof fetch produced no response"
      }
    );
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
      error: error instanceof Error ? error.message : "Experiment proof fetch failed"
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
  const planner = await fetchPlanner(plannerUrl(url.origin, query.date, query.sport, url.searchParams.get("limit")));
  if (!planner) return apiError("Unable to build the AI experiment planner before observation.", 502);

  const target = resolveDecisionAIExperimentTarget({ planner, origin: url.origin });
  const observation = runRequested && target.allowed && target.url ? await fetchJsonText(target.url) : undefined;

  return apiSuccess(
    buildDecisionAIExperimentObserver({
      planner,
      runRequested,
      observation,
      origin: url.origin
    })
  );
}
