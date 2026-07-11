import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import type { DecisionCognitionScorecard } from "@/lib/sports/prediction/decisionCognitionScorecard";
import { buildDecisionEngineNextActionController } from "@/lib/sports/prediction/decisionEngineNextActionController";
import { fetchDecisionApiData } from "@/lib/sports/prediction/decisionInternalFetch";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { readSupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return 8;
  return Math.min(parsed, 20);
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("Engine next-action controller currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const scorecard = await fetchDecisionApiData<DecisionCognitionScorecard>(
    new URL(`/api/sports/decision/cognition-scorecard?date=${query.date}&sport=${query.sport}&limit=${limit}&corpusRun=1`, url.origin),
    {
      timeoutMs: 240000,
      maxAttempts: 1
    }
  );
  if (!scorecard) return apiError("Unable to build corpus-aware cognition scorecard before next-action controller.", 502);

  const corpus = await readSupabaseTrainingCorpusCensus({
    env: process.env,
    origin: url.origin
  });

  return apiSuccess(buildDecisionEngineNextActionController({ scorecard, corpus }), { status: corpus.status === "failed" ? 502 : 200 });
}
