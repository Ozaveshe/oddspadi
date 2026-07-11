import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { runDecisionProviderLearningBridge } from "@/lib/sports/prediction/decisionProviderLearningBridgeRunner";

export const dynamic = "force-dynamic";

function enabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  if (query.sport !== "football") return apiError("Provider learning bridge currently supports football.");

  const url = new URL(request.url);
  const runRequested = enabled(url.searchParams.get("run"));
  const adminAuthorized = isDecisionAdminAuthorized(request);
  const bridge = await runDecisionProviderLearningBridge({
    date: query.date,
    env: process.env,
    runRequested,
    adminAuthorized,
    origin: url.origin
  });

  return apiSuccess(bridge, { status: runRequested && !adminAuthorized ? 401 : bridge.status === "provider-error" ? 502 : 200 });
}
