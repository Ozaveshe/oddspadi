import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { buildDecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import { buildDecisionDataAuthority } from "@/lib/sports/prediction/decisionDataAuthority";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionModelCards } from "@/lib/sports/prediction/decisionModelCards";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { buildDecisionProviderIngestionEvidence } from "@/lib/sports/prediction/decisionProviderIngestionEvidence";
import { buildDecisionRequirementPulse } from "@/lib/sports/prediction/decisionRequirementPulse";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";
import { buildDecisionWorldModel } from "@/lib/sports/prediction/decisionWorldModel";
import { buildDecisionWorldModelCritic } from "@/lib/sports/prediction/decisionWorldModelCritic";
import { getPredictions, todayIsoDate } from "@/lib/sports/service";
import type { Sport } from "@/lib/sports/types";
import { buildTenYearFootballCorpusBackfillPlan } from "@/lib/sports/training/corpusBackfillPlan";
import { buildMultiSportCorpusPlan } from "@/lib/sports/training/multiSportCorpusPlan";
import { buildTrainingDataBlueprint } from "@/lib/sports/training/trainingDataBlueprint";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

type PulseSport = Extract<Sport, "football" | "basketball" | "tennis">;

const PULSE_SPORTS: PulseSport[] = ["football", "basketball", "tennis"];

function parseDate(value: string | null): string | { error: string } {
  const date = value ?? todayIsoDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Invalid date. Use YYYY-MM-DD." };
  return date;
}

function verdictRank(verdict: string) {
  if (verdict === "strong-value") return 5;
  if (verdict === "lean-value") return 4;
  if (verdict === "watchlist") return 3;
  if (verdict === "avoid") return 2;
  return 1;
}

function rankRows(rows: Awaited<ReturnType<typeof getPredictions>>) {
  return rows.slice().sort((a, b) => {
    const verdictDiff = verdictRank(b.prediction.decision.verdict) - verdictRank(a.prediction.decision.verdict);
    if (verdictDiff !== 0) return verdictDiff;
    const aEv = a.prediction.bestPick.hasValue ? a.prediction.bestPick.expectedValue : -1;
    const bEv = b.prediction.bestPick.hasValue ? b.prediction.bestPick.expectedValue : -1;
    if (bEv !== aEv) return bEv - aEv;
    return b.match.dataQualityScore - a.match.dataQualityScore;
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = parseDate(url.searchParams.get("date"));
  if (typeof date !== "string") return apiError(date.error);

  const [readiness, corpusPlan, multiSportCorpusPlan, sportRows, trainingSnapshots] = await Promise.all([
    verifyDecisionEngineReadiness(),
    buildTenYearFootballCorpusBackfillPlan({ baseUrl: url.origin }),
    buildMultiSportCorpusPlan({ baseUrl: url.origin }),
    Promise.all(PULSE_SPORTS.map(async (sport) => ({ sport, rows: rankRows(await getPredictions({ date, sport })) }))),
    Promise.all(PULSE_SPORTS.map(async (sport) => ({ sport, training: await getTrainingDataSnapshot(sport) })))
  ]);
  const trainingBySport = new Map(trainingSnapshots.map((item) => [item.sport, item.training]));
  const footballRows = sportRows.find((item) => item.sport === "football")?.rows ?? [];
  const footballTraining = trainingBySport.get("football") ?? (await getTrainingDataSnapshot("football"));
  const dataIntake = buildDecisionDataIntakeQueue({ rows: footballRows, date, sport: "football", readiness, limit: 8 });
  const providerIngestionEvidence = buildDecisionProviderIngestionEvidence({
    date,
    sport: "football",
    dataIntake,
    readiness,
    training: footballTraining,
    corpusPlan,
    baseUrl: url.origin
  });
  const footballMatrix = buildDecisionFeatureMatrix({ rows: footballRows, date, sport: "football", limit: 8 });
  const footballGovernance = buildDecisionModelGovernance({ matrix: footballMatrix, training: footballTraining, date, sport: "football" });
  const supabaseIsolation = buildDecisionSupabaseProjectIsolation({ readiness });
  const dataAuthority = buildDecisionDataAuthority({
    date,
    sport: "football",
    dataIntake,
    providerIngestionEvidence,
    modelGovernance: footballGovernance,
    supabaseIsolation,
    training: footballTraining,
    corpusPlan
  });
  const worldModel = buildDecisionWorldModel({ date, sport: "football", rows: footballRows, dataAuthority, limit: 8 });
  const worldModelCritic = buildDecisionWorldModelCritic({ worldModel, limit: 6 });
  const modelInputs = sportRows.map(({ sport, rows }) => {
    const training = trainingBySport.get(sport) ?? footballTraining;
    const matrix = buildDecisionFeatureMatrix({ rows, date, sport, limit: 8 });
    const governance = buildDecisionModelGovernance({ matrix, training, date, sport });
    return {
      sport,
      matrix,
      governance,
      training,
      predictions: rows.map((row) => row.prediction)
    };
  });
  const modelCards = buildDecisionModelCards({ date, inputs: modelInputs });
  const trainingBlueprint = buildTrainingDataBlueprint({
    corpusPlan: multiSportCorpusPlan,
    trainingSnapshots: trainingSnapshots.map((item) => item.training)
  });
  const aiReviewReadiness = buildDecisionAIReviewReadiness({ date, sport: "football", env: process.env, baseUrl: url.origin });

  return apiSuccess(
    buildDecisionRequirementPulse({
      date,
      rows: sportRows.flatMap((item) => item.rows),
      dataAuthority,
      modelCards,
      trainingBlueprint,
      worldModelCritic,
      aiReviewReadiness
    })
  );
}
