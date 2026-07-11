import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import type { DecisionAgentRuntime } from "@/lib/sports/prediction/decisionAgentRuntime";
import { buildDecisionAIControlPacket } from "@/lib/sports/prediction/decisionAIControlPacket";
import type { DecisionAIDeliberation } from "@/lib/sports/prediction/decisionAIDeliberation";
import type { DecisionCapabilityContract } from "@/lib/sports/prediction/decisionCapabilityContract";
import type { DecisionOperatorTurn } from "@/lib/sports/prediction/decisionOperatorTurn";

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
    return apiError("OpenAI control execution requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const adminHeaders = runRequested ? { "x-oddspadi-admin-token": request.headers.get("x-oddspadi-admin-token") ?? "" } : undefined;
  const deliberationUrl = decisionUrl(url.origin, "/api/sports/decision/ai-deliberation", query.date, query.sport);
  const runtimeUrl = decisionUrl(url.origin, "/api/sports/decision/agent-runtime", query.date, query.sport);
  const capabilityUrl = decisionUrl(url.origin, "/api/sports/decision/capability-contract", query.date, query.sport);
  const operatorTurnUrl = decisionUrl(url.origin, "/api/sports/decision/operator-turn", query.date, query.sport);

  if (runRequested) {
    deliberationUrl.searchParams.set("run", "1");
    runtimeUrl.searchParams.set("run", "all");
    capabilityUrl.searchParams.set("run", "all");
    operatorTurnUrl.searchParams.set("run", "all");
  }

  const [deliberation, runtime, capabilityContract, operatorTurn] = await Promise.all([
    fetchData<DecisionAIDeliberation>(deliberationUrl, adminHeaders),
    fetchData<DecisionAgentRuntime>(runtimeUrl, adminHeaders),
    fetchData<DecisionCapabilityContract>(capabilityUrl, adminHeaders),
    fetchData<DecisionOperatorTurn>(operatorTurnUrl, adminHeaders)
  ]);

  if (!deliberation || !runtime || !capabilityContract || !operatorTurn) {
    return apiError("Unable to build the AI control packet.", 502);
  }

  return apiSuccess(buildDecisionAIControlPacket({ deliberation, runtime, capabilityContract, operatorTurn }));
}
