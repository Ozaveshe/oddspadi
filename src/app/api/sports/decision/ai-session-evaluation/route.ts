import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import type { CalibrationSnapshot } from "@/lib/sports/prediction/decisionCalibration";
import type { DecisionAISession } from "@/lib/sports/prediction/decisionAISession";
import { buildDecisionAISessionShadowEvaluation } from "@/lib/sports/prediction/decisionAISessionShadowEvaluation";
import type { DecisionLearningQueue } from "@/lib/sports/prediction/decisionLearningQueue";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

function shouldRun(url: URL): boolean {
  return url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true" || url.searchParams.get("ai") === "1";
}

function decisionUrl(origin: string, path: string, date: string, sport: string): URL {
  const url = new URL(path, origin);
  url.searchParams.set("date", date);
  url.searchParams.set("sport", sport);
  return url;
}

async function fetchData<T>(url: URL, headers?: HeadersInit): Promise<T | null> {
  const response = await fetch(url, { cache: "no-store", headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !payload.data) return null;
  return payload.data as T;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runRequested = shouldRun(url);
  if (runRequested && !isDecisionAdminAuthorized(request)) {
    return apiError("OpenAI session evaluation requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const adminHeaders = runRequested ? { "x-oddspadi-admin-token": request.headers.get("x-oddspadi-admin-token") ?? "" } : undefined;
  const sessionUrl = decisionUrl(url.origin, "/api/sports/decision/ai-decision-session", query.date, query.sport);
  const learningUrl = decisionUrl(url.origin, "/api/sports/decision/learning-queue", query.date, query.sport);
  const calibrationUrl = new URL("/api/sports/decision/calibration", url.origin);
  const trainingUrl = new URL("/api/sports/decision/training", url.origin);
  calibrationUrl.searchParams.set("sport", query.sport);
  trainingUrl.searchParams.set("sport", query.sport);

  if (runRequested) {
    sessionUrl.searchParams.set("run", "1");
  }

  const [session, learningQueue, calibration, training] = await Promise.all([
    fetchData<DecisionAISession>(sessionUrl, adminHeaders),
    fetchData<DecisionLearningQueue>(learningUrl),
    fetchData<CalibrationSnapshot>(calibrationUrl),
    fetchData<TrainingDataSnapshot>(trainingUrl)
  ]);

  if (!session || !learningQueue || !calibration || !training) {
    return apiError("Unable to build the AI session shadow evaluation.", 502);
  }

  return apiSuccess(buildDecisionAISessionShadowEvaluation({ session, learningQueue, calibration, training }));
}
