import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { runDecisionEngineSelfTest } from "@/lib/sports/prediction/decisionReadiness";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const matchId = url.searchParams.get("matchId") ?? "epl-001";
  if (matchId.length > 80) return apiError("Invalid matchId.");

  const enhance = url.searchParams.get("enhance") === "1";
  const persist = url.searchParams.get("persist") === "1";
  if (enhance && !isDecisionAdminAuthorized(request)) {
    return apiError("Decision self-test OpenAI enhancement requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  if (persist && !isDecisionAdminAuthorized(request)) {
    return apiError("Decision self-test persistence requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  return apiSuccess(await runDecisionEngineSelfTest({ matchId, enhance, persist }));
}
