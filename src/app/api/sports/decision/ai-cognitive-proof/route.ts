import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { buildDecisionAICognitiveProofFromExecutive, type DecisionAIExecutiveWithGovernor } from "@/lib/sports/prediction/decisionAICognitiveProof";

export const dynamic = "force-dynamic";

function shouldRun(url: URL): boolean {
  return url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true" || url.searchParams.get("ai") === "1";
}

function shouldObserve(url: URL): boolean {
  return shouldRun(url) || url.searchParams.get("observe") === "1" || url.searchParams.get("observe") === "true" || url.searchParams.get("proof") === "1";
}

async function fetchExecutive(url: URL, date: string, sport: string, headers?: HeadersInit): Promise<DecisionAIExecutiveWithGovernor | null> {
  const target = new URL("/api/sports/decision/ai-executive", url.origin);
  target.searchParams.set("date", date);
  target.searchParams.set("sport", sport);
  if (shouldRun(url)) target.searchParams.set("run", "1");
  else if (shouldObserve(url)) target.searchParams.set("observe", "1");

  const response = await fetch(target, { cache: "no-store", headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !payload.data) return null;
  return payload.data as DecisionAIExecutiveWithGovernor;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runRequested = shouldRun(url);
  if (runRequested && !isDecisionAdminAuthorized(request)) {
    return apiError("OpenAI cognitive proof requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const adminHeaders = runRequested ? { "x-oddspadi-admin-token": request.headers.get("x-oddspadi-admin-token") ?? "" } : undefined;
  const executive = await fetchExecutive(url, query.date, query.sport, adminHeaders);
  if (!executive) return apiError("Unable to build the AI executive packet before cognitive proof.", 502);

  return apiSuccess(buildDecisionAICognitiveProofFromExecutive({ executive }));
}
