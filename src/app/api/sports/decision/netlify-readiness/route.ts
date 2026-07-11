import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionNetlifyDeployment } from "@/lib/sports/prediction/decisionNetlifyDeployment";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionSupabaseBootstrap } from "@/lib/sports/prediction/decisionSupabaseBootstrap";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import { buildTenYearFootballCorpusBackfillPlan } from "@/lib/sports/training/corpusBackfillPlan";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const [readiness, corpusPlan] = await Promise.all([
    verifyDecisionEngineReadiness(),
    buildTenYearFootballCorpusBackfillPlan({ baseUrl: decisionSiteOrigin() })
  ]);
  const supabaseBootstrap = buildDecisionSupabaseBootstrap({ readiness, corpusPlan });

  return apiSuccess(buildDecisionNetlifyDeployment({ readiness, supabaseBootstrap }));
}
