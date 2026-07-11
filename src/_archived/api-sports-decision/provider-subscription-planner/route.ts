import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { buildDecisionProviderSubscriptionPlanner } from "@/lib/sports/prediction/decisionProviderSubscriptionPlanner";

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

  return apiSuccess(
    buildDecisionProviderSubscriptionPlanner({
      date: query.date,
      sport: query.sport,
      providerActivationQueue: context.providerActivationQueue,
      providerKeyPlan: context.providerActivationQueue.providerKeyPlan,
      apiFootballPlan: url.searchParams.get("apiFootballPlan"),
      oddsApiPlan: url.searchParams.get("oddsApiPlan"),
      env: process.env
    })
  );
}
