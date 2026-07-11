import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionCognitionScorecard } from "@/lib/sports/prediction/decisionCognitionScorecard";
import type { DecisionCognitiveKernel } from "@/lib/sports/prediction/decisionCognitiveKernel";
import { fetchDecisionApiData } from "@/lib/sports/prediction/decisionInternalFetch";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";

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
    return apiError("Cognition scorecard currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const params = new URLSearchParams({
    date: query.date,
    sport: query.sport,
    limit: String(limit)
  });
  if (url.searchParams.get("providerRun") === "1" || url.searchParams.get("providerRun") === "true") {
    params.set("providerRun", "1");
  }
  if (url.searchParams.get("corpusRun") !== "0" && url.searchParams.get("runCorpusMemory") !== "0") {
    params.set("corpusRun", "1");
  }

  const cognitiveKernel = await fetchDecisionApiData<DecisionCognitiveKernel>(
    new URL(`/api/sports/decision/cognitive-kernel?${params.toString()}`, url.origin),
    {
      timeoutMs: 180000,
      maxAttempts: 2
    }
  );

  if (!cognitiveKernel) return apiError("Unable to build cognitive kernel before cognition scorecard.", 502);
  return apiSuccess(buildDecisionCognitionScorecard({ cognitiveKernel }));
}
