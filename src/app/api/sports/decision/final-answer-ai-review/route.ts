import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { runDecisionFinalAnswerAIReview } from "@/lib/sports/prediction/decisionFinalAnswerAIReview";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";

export const dynamic = "force-dynamic";

function shouldRun(url: URL): boolean {
  return url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runRequested = shouldRun(url);
  if (runRequested && !isDecisionAdminAuthorized(request)) {
    return apiError("Final-answer OpenAI review requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport,
    baseUrl: url.origin,
    env: process.env
  });

  if (!runRequested) return apiSuccess(context.finalAnswerAIReview);

  return apiSuccess(
    await runDecisionFinalAnswerAIReview({
      date: query.date,
      sport: query.sport,
      finalAnswer: context.finalAnswerContract,
      changeMindLedger: context.changeMindLedger,
      trustFirewall: context.trustFirewall,
      portfolioRisk: context.portfolioRisk,
      openAiKeyDiagnostic: context.openAiKeyDiagnostic,
      runRequested: true,
      apiKey: process.env.OPENAI_API_KEY
    })
  );
}
