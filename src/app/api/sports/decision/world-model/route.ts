import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionDataAuthority } from "@/lib/sports/prediction/decisionDataAuthority";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { buildDecisionProviderIngestionEvidence } from "@/lib/sports/prediction/decisionProviderIngestionEvidence";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";
import { buildDecisionWorldModel } from "@/lib/sports/prediction/decisionWorldModel";
import { getPredictions } from "@/lib/sports/service";
import { buildTenYearFootballCorpusBackfillPlan } from "@/lib/sports/training/corpusBackfillPlan";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 20) : 10;
}

function verdictRank(verdict: string) {
  if (verdict === "strong-value") return 5;
  if (verdict === "lean-value") return 4;
  if (verdict === "watchlist") return 3;
  if (verdict === "avoid") return 2;
  return 1;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const [rows, readiness, training, corpusPlan] = await Promise.all([
    getPredictions({ date: query.date, sport: query.sport }),
    verifyDecisionEngineReadiness(),
    getTrainingDataSnapshot(query.sport),
    buildTenYearFootballCorpusBackfillPlan({ baseUrl: url.origin })
  ]);
  const rankedRows = rows.slice().sort((a, b) => {
    const verdictDiff = verdictRank(b.prediction.decision.verdict) - verdictRank(a.prediction.decision.verdict);
    if (verdictDiff !== 0) return verdictDiff;
    const aEv = a.prediction.bestPick.hasValue ? a.prediction.bestPick.expectedValue : -1;
    const bEv = b.prediction.bestPick.hasValue ? b.prediction.bestPick.expectedValue : -1;
    if (bEv !== aEv) return bEv - aEv;
    return b.match.dataQualityScore - a.match.dataQualityScore;
  });
  const dataIntake = buildDecisionDataIntakeQueue({ rows: rankedRows, date: query.date, sport: query.sport, readiness, limit: 12 });
  const providerIngestionEvidence = buildDecisionProviderIngestionEvidence({
    date: query.date,
    sport: query.sport,
    dataIntake,
    readiness,
    training,
    corpusPlan,
    baseUrl: url.origin
  });
  const featureMatrix = buildDecisionFeatureMatrix({ rows: rankedRows, date: query.date, sport: query.sport, limit: 8 });
  const modelGovernance = buildDecisionModelGovernance({ matrix: featureMatrix, training, date: query.date, sport: query.sport });
  const supabaseIsolation = buildDecisionSupabaseProjectIsolation({ readiness });
  const dataAuthority = buildDecisionDataAuthority({
    date: query.date,
    sport: query.sport,
    dataIntake,
    providerIngestionEvidence,
    modelGovernance,
    supabaseIsolation,
    training,
    corpusPlan
  });

  return apiSuccess(
    buildDecisionWorldModel({
      date: query.date,
      sport: query.sport,
      rows: rankedRows,
      dataAuthority,
      limit: parseLimit(url.searchParams.get("limit"))
    })
  );
}
