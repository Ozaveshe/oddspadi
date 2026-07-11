import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { parsePredictionOutcomeInput, storePredictionOutcome } from "@/lib/sports/prediction/decisionOutcomes";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Outcome writes require ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.");
  }

  const input = parsePredictionOutcomeInput(body);
  if ("error" in input) return apiError(input.error);

  const write = await storePredictionOutcome(input);
  const status = write.status === "stored" || write.status === "reused" ? 200 : write.status === "not-configured" ? 503 : 500;
  return apiSuccess(write, { status });
}
