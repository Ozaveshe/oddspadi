import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildDecisionAIDeliberation } from "@/lib/sports/prediction/decisionAIDeliberation";
import type { DecisionAISession } from "@/lib/sports/prediction/decisionAISession";
import type { DecisionAISessionShadowEvaluation } from "@/lib/sports/prediction/decisionAISessionShadowEvaluation";

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
    return apiError("OpenAI deliberation requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const adminHeaders = runRequested ? { "x-oddspadi-admin-token": request.headers.get("x-oddspadi-admin-token") ?? "" } : undefined;
  const sessionUrl = decisionUrl(url.origin, "/api/sports/decision/ai-decision-session", query.date, query.sport);
  const evaluationUrl = decisionUrl(url.origin, "/api/sports/decision/ai-session-evaluation", query.date, query.sport);

  if (runRequested) {
    sessionUrl.searchParams.set("run", "1");
    evaluationUrl.searchParams.set("run", "1");
  }

  const [session, evaluation] = await Promise.all([
    fetchData<DecisionAISession>(sessionUrl, adminHeaders),
    fetchData<DecisionAISessionShadowEvaluation>(evaluationUrl, adminHeaders)
  ]);

  if (!session || !evaluation) {
    return apiError("Unable to build the AI deliberation packet.", 502);
  }

  return apiSuccess(buildDecisionAIDeliberation({ session, evaluation }));
}
