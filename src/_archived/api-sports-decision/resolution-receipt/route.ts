import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { observeDecisionResolutionReceipt } from "@/lib/sports/prediction/decisionResolutionReceipt";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport,
    baseUrl: url.origin,
    env: process.env
  });
  const receipt = await observeDecisionResolutionReceipt({
    planner: context.resolutionPlanner,
    runRequested: url.searchParams.get("run") === "1",
    origin: url.origin,
    fetchImpl: fetch
  });

  return apiSuccess(receipt);
}
