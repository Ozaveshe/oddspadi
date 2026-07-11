import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionModelCards } from "@/lib/sports/prediction/decisionModelCards";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import { buildDecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";
import { getPredictions, todayIsoDate } from "@/lib/sports/service";
import type { Sport } from "@/lib/sports/types";
import { buildLearnedWeightPromotionGovernor } from "@/lib/sports/training/learnedWeightPromotionGovernor";
import { buildMultiSportCorpusPlan, type TrainingCorpusSport } from "@/lib/sports/training/multiSportCorpusPlan";
import { buildShadowTrainingCandidates } from "@/lib/sports/training/shadowTrainingCandidates";
import { readSupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";
import { buildTrainingCorpusProof } from "@/lib/sports/training/trainingCorpusProof";
import { buildTrainingDataBlueprint } from "@/lib/sports/training/trainingDataBlueprint";
import { buildTrainingMemoryGate } from "@/lib/sports/training/trainingMemoryGate";
import { buildTrainingReadiness } from "@/lib/sports/training/trainingReadiness";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

type MemoryGateSport = Extract<Sport, "football" | "basketball" | "tennis">;

function parseDate(value: string | null): string | { error: string } {
  const date = value ?? todayIsoDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Invalid date. Use YYYY-MM-DD." };
  return date;
}

function parsePositiveInteger(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 20) : 8;
}

function parseSport(value: string | null): TrainingCorpusSport[] | undefined {
  if (!value || value === "all") return undefined;
  const sports = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!sports.length) return undefined;
  if (sports.every((sport): sport is TrainingCorpusSport => sport === "football" || sport === "basketball" || sport === "tennis")) return sports;
  return [];
}

function verdictRank(verdict: string) {
  if (verdict === "strong-value") return 5;
  if (verdict === "lean-value") return 4;
  if (verdict === "watchlist") return 3;
  if (verdict === "avoid") return 2;
  return 1;
}

async function buildModelCardInput({ date, sport, limit }: { date: string; sport: MemoryGateSport; limit: number }) {
  const [rows, training] = await Promise.all([getPredictions({ date, sport }), getTrainingDataSnapshot(sport)]);
  const rankedRows = rows.slice().sort((a, b) => {
    const verdictDiff = verdictRank(b.prediction.decision.verdict) - verdictRank(a.prediction.decision.verdict);
    if (verdictDiff !== 0) return verdictDiff;
    const aEv = a.prediction.bestPick.hasValue ? a.prediction.bestPick.expectedValue : -1;
    const bEv = b.prediction.bestPick.hasValue ? b.prediction.bestPick.expectedValue : -1;
    if (bEv !== aEv) return bEv - aEv;
    return b.match.dataQualityScore - a.match.dataQualityScore;
  });
  const matrix = buildDecisionFeatureMatrix({ rows: rankedRows, date, sport, limit });
  const governance = buildDecisionModelGovernance({ matrix, training, date, sport });
  return { sport, matrix, governance, training, predictions: rankedRows.map((row) => row.prediction) };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = parseDate(url.searchParams.get("date"));
  if (typeof date !== "string") return apiError(date.error);
  const sports = parseSport(url.searchParams.get("sport"));
  if (sports?.length === 0) return apiError("sport must be football, basketball, tennis, a comma-separated subset, or all.");
  const selectedSports = sports ?? (["football", "basketball", "tennis"] satisfies MemoryGateSport[]);
  const limit = parseLimit(url.searchParams.get("limit"));

  const [readiness, corpusPlan, supabaseTrainingCorpusCensus, modelInputs] = await Promise.all([
    verifyDecisionEngineReadiness(),
    buildMultiSportCorpusPlan({
      baseUrl: url.origin,
      seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")),
      seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")),
      maxJobsPerLeague: parsePositiveInteger(url.searchParams.get("maxJobsPerLeague")),
      sports: selectedSports
    }),
    readSupabaseTrainingCorpusCensus({ env: process.env, origin: url.origin }),
    Promise.all(selectedSports.map((sport) => buildModelCardInput({ date, sport, limit })))
  ]);
  const trainingSnapshots = await Promise.all(corpusPlan.sports.map((sportPlan) => getTrainingDataSnapshot(sportPlan.sport)));
  const trainingBlueprint = buildTrainingDataBlueprint({ corpusPlan, trainingSnapshots });
  const isolation = buildDecisionSupabaseProjectIsolation({ readiness });
  const supabaseProofBinder = buildDecisionSupabaseProofBinder({ readiness, isolation });
  const trainingCorpusProof = buildTrainingCorpusProof({ corpusPlan, trainingBlueprint, supabaseProofBinder });
  const trainingReadiness = buildTrainingReadiness({ trainingBlueprint, trainingCorpusProof });
  const shadowCandidates = buildShadowTrainingCandidates({ date, trainingReadiness, trainingSnapshots });
  const modelCards = buildDecisionModelCards({ date, inputs: modelInputs });
  const learnedWeightPromotionGovernor = buildLearnedWeightPromotionGovernor({ date, shadowCandidates, modelCards });

  return apiSuccess(
    buildTrainingMemoryGate({
      trainingReadiness,
      supabaseTrainingCorpusCensus,
      learnedWeightPromotionGovernor
    }),
    { status: supabaseTrainingCorpusCensus.status === "failed" ? 500 : 200 }
  );
}
