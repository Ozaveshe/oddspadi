import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { observeDecisionContextFeatureProofReceipt } from "@/lib/sports/prediction/decisionContextFeatureProofReceipt";
import { buildDecisionContextFeatureProofSelector } from "@/lib/sports/prediction/decisionContextFeatureProofSelector";
import { buildDecisionHistoricalDiagnosisLadder } from "@/lib/sports/prediction/decisionHistoricalDiagnosisLadder";
import { observeDecisionHistoricalDiagnosisLadderReceipt } from "@/lib/sports/prediction/decisionHistoricalDiagnosisLadderReceipt";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { buildDecisionShadowNextCycleInterpreter } from "@/lib/sports/prediction/decisionShadowNextCycleInterpreter";
import { observeDecisionShadowNextCycleReceipt } from "@/lib/sports/prediction/decisionShadowNextCycleReceipt";
import { readFootballProviderFeatureIntakeGapReceipt } from "@/lib/sports/training/footballProviderFeatureIntakeGapReceipt";
import { buildFootballProviderFixtureFeatureReadiness } from "@/lib/sports/training/footballProviderFixtureFeatureReadiness";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("Decision context feature proof receipt currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const runRequested = url.searchParams.get("run") === "1";
  const targetDate = url.searchParams.get("targetDate") ?? "2026-08-21";
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport as DecisionMultiSport,
    baseUrl: url.origin,
    env: process.env
  });
  const shadowReceipt = await observeDecisionShadowNextCycleReceipt({
    planner: context.shadowNextCyclePlanner,
    runRequested,
    origin: url.origin,
    fetchImpl: fetch
  });
  const interpreter = buildDecisionShadowNextCycleInterpreter({
    planner: context.shadowNextCyclePlanner,
    receipt: shadowReceipt
  });
  const ladder = buildDecisionHistoricalDiagnosisLadder({
    publicHistoricalTrainingEvidence: context.publicHistoricalTrainingEvidence,
    interpreter,
    oddsSnapshotStorageReadiness: context.oddsSnapshotStorageReadiness
  });
  const ladderReceipt = await observeDecisionHistoricalDiagnosisLadderReceipt({
    ladder,
    runRequested,
    origin: url.origin,
    fetchImpl: fetch
  });
  const featureGap = await readFootballProviderFeatureIntakeGapReceipt({
    env: process.env,
    origin: url.origin,
    targetDate
  });
  const fixtureFeatureReadiness = buildFootballProviderFixtureFeatureReadiness({
    fixtureMap: context.eplProviderFixtureMap,
    featureGap
  });
  const selector = buildDecisionContextFeatureProofSelector({
    ladderReceipt,
    featureGap,
    fixtureFeatureReadiness
  });
  const receipt = await observeDecisionContextFeatureProofReceipt({
    selector,
    runRequested,
    origin: url.origin,
    fetchImpl: fetch
  });

  return apiSuccess(receipt, { status: receipt.status === "failed" ? 500 : 200 });
}
