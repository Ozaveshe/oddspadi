import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import { buildDecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const aiReviewReadiness = buildDecisionAIReviewReadiness({
    date: query.date,
    sport: query.sport,
    env: process.env,
    baseUrl: url.origin
  });

  return apiSuccess(
    buildDecisionOpenAIKeyDiagnostic({
      aiReviewReadiness,
      env: process.env
    })
  );
}
