import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionAIExperimentEpisode, type DecisionAIExperimentEpisodeStabilityInput } from "@/lib/sports/prediction/decisionAIExperimentEpisode";
import type { DecisionAIExperimentObserver } from "@/lib/sports/prediction/decisionAIExperimentObserver";
import { buildDecisionAIExperimentState } from "@/lib/sports/prediction/decisionAIExperimentState";

export const dynamic = "force-dynamic";

function shouldRun(url: URL): boolean {
  return url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true";
}

function decisionUrl(origin: string, path: string, date: string, sport: string, runRequested = false, limit: string | null = null): URL {
  const target = new URL(path, origin);
  target.searchParams.set("date", date);
  target.searchParams.set("sport", sport);
  if (runRequested) target.searchParams.set("run", "1");
  if (limit) target.searchParams.set("limit", limit);
  return target;
}

async function fetchData<T>(url: URL, timeoutMs = 150000, maxAttempts = 2): Promise<T | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.success && payload.data) return payload.data as T;
    } catch {
      // A timed-out observer attempt is handled by the stabilizer fallback below.
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < maxAttempts - 1) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

function observerScore(observer: DecisionAIExperimentObserver | null): number {
  if (!observer) return -1;
  const statusScore =
    observer.status === "observed"
      ? 8
      : observer.status === "observed-warning"
        ? 5
        : observer.status === "not-run"
          ? 3
          : observer.status === "failed"
            ? 1
            : 0;
  return statusScore + (observer.observation.responseHash ? 2 : 0) + (observer.observation.error ? -2 : 0);
}

function shouldRetryObserver(observer: DecisionAIExperimentObserver | null): boolean {
  if (!observer) return true;
  return observer.status === "failed" || observer.status === "observed-warning" || (observer.verification.requested && !observer.observation.responseHash);
}

async function fetchStableObserver(url: URL, runRequested: boolean): Promise<{
  observer: DecisionAIExperimentObserver | null;
  stability: DecisionAIExperimentEpisodeStabilityInput | undefined;
}> {
  const attempts: DecisionAIExperimentObserver[] = [];
  const first = await fetchData<DecisionAIExperimentObserver>(url, runRequested ? 155000 : 150000, runRequested ? 1 : 2);
  if (first) attempts.push(first);

  if (runRequested && first && shouldRetryObserver(first)) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    const second = await fetchData<DecisionAIExperimentObserver>(url, 155000, 1);
    if (second) attempts.push(second);
  }

  if (runRequested && !attempts.length) {
    const fallbackUrl = new URL(url);
    fallbackUrl.searchParams.delete("run");
    const fallback = await fetchData<DecisionAIExperimentObserver>(fallbackUrl, 170000, 1);
    if (fallback) {
      return {
        observer: fallback,
        stability: {
          attempts: 1,
          selectedAttempt: 1,
          observedStatuses: ["observer-timeout", fallback.status],
          responseHashes: [null, fallback.observation.responseHash],
          reason: "The observed replay exceeded the bounded timeout, so the episode fell back to the approved no-run observer receipt."
        }
      };
    }
  }

  const observer = attempts.slice().sort((a, b) => observerScore(b) - observerScore(a))[0] ?? null;
  if (!observer) return { observer: null, stability: undefined };

  const selectedAttempt = Math.max(1, attempts.findIndex((item) => item.observerHash === observer.observerHash) + 1);
  return {
    observer,
    stability: {
      attempts: attempts.length,
      selectedAttempt,
      observedStatuses: attempts.map((item) => item.status),
      responseHashes: attempts.map((item) => item.observation.responseHash),
      reason:
        attempts.length > 1
          ? `Selected attempt ${selectedAttempt} after ${attempts.length} observer attempt(s); statuses were ${attempts.map((item) => item.status).join(", ")}.`
          : "Only one observer attempt was needed for the episode."
    }
  };
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runRequested = shouldRun(url);
  const observerUrl = decisionUrl(url.origin, "/api/sports/decision/ai-experiment-observer", query.date, query.sport, runRequested, url.searchParams.get("limit"));
  const { observer, stability } = await fetchStableObserver(observerUrl, runRequested);
  if (!observer) return apiError("Unable to build the AI experiment observer before episode replay.", 502);

  const state = buildDecisionAIExperimentState({
    planner: {
      date: observer.date,
      sport: observer.sport,
      plannerHash: observer.plannerHash,
      selectedExperiment: observer.selectedExperiment,
      proofUrls: observer.proofUrls
    },
    observer
  });

  return apiSuccess(buildDecisionAIExperimentEpisode({ observer, state, stability }));
}
