import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { buildDecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import { runDecisionAIContextDossierReview } from "@/lib/sports/prediction/decisionAIContextDossier";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { buildDecisionEngineCapacityState } from "@/lib/sports/prediction/decisionEngineCapacityState";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { buildDecisionModelEnsemble } from "@/lib/sports/prediction/decisionModelEnsemble";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { buildDecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import { buildDecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { getPredictions } from "@/lib/sports/service";
import { buildFirstCorpusImportQueue } from "@/lib/sports/training/firstCorpusImportQueue";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import { buildMultiSportCorpusPlan, type TrainingCorpusSport } from "@/lib/sports/training/multiSportCorpusPlan";
import { buildProviderCorpusDryRunQueue } from "@/lib/sports/training/providerCorpusDryRunQueue";
import { readSupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";

export const dynamic = "force-dynamic";

function parsePositiveInteger(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseTrainingSports(value: string | null): TrainingCorpusSport[] | undefined {
  if (!value || value === "all") return undefined;
  const sports = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!sports.length) return undefined;
  if (sports.every((sport): sport is TrainingCorpusSport => sport === "football" || sport === "basketball" || sport === "tennis")) return sports;
  return [];
}

function isEnabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const trainingSports = parseTrainingSports(url.searchParams.get("trainingSports") ?? url.searchParams.get("corpusSport"));
  if (trainingSports?.length === 0) return apiError("trainingSports must be football, basketball, tennis, a comma-separated subset, or all.");
  const openAiRunRequested = isEnabled(url.searchParams.get("openAiRun")) || isEnabled(url.searchParams.get("runOpenAI"));
  if (openAiRunRequested && !isDecisionAdminAuthorized(request)) {
    return apiError("OpenAI capacity review requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const openAiLimit = Math.min(parsePositiveInteger(url.searchParams.get("limit")) ?? 1, 6);

  const [context, supabaseTrainingCorpusCensus, corpusPlan] = await Promise.all([
    buildDecisionLaunchContext({
      date: query.date,
      sport: query.sport,
      baseUrl: url.origin,
      env: process.env
    }),
    readSupabaseTrainingCorpusCensus({
      env: process.env,
      origin: url.origin
    }),
    Promise.resolve(
      buildMultiSportCorpusPlan({
        env: process.env,
        baseUrl: url.origin,
        seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")) ?? 2025,
        seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")) ?? 2026,
        maxJobsPerLeague: parsePositiveInteger(url.searchParams.get("maxJobsPerLeague")) ?? 1,
        sports: trainingSports
      })
    )
  ]);
  const providerQueue = await buildProviderCorpusDryRunQueue({
    corpusPlan,
    env: process.env,
    runRequested: false,
    adminAuthorized: false,
    origin: url.origin
  });
  const firstCorpusImportQueue = buildFirstCorpusImportQueue({
    census: supabaseTrainingCorpusCensus,
    providerQueue,
    origin: url.origin
  });
  const openAiLiveReviewReceipt = openAiRunRequested
    ? await (async () => {
        const [readiness, rows, training] = await Promise.all([
          verifyDecisionEngineReadiness(),
          getPredictions({ date: query.date, sport: query.sport }),
          getTrainingDataSnapshot(query.sport)
        ]);
        const aiReviewReadiness = buildDecisionAIReviewReadiness({
          date: query.date,
          sport: query.sport,
          env: process.env,
          baseUrl: url.origin
        });
        const openAiKeyDiagnostic = buildDecisionOpenAIKeyDiagnostic({ aiReviewReadiness, env: process.env });
        const modelEnsemble = buildDecisionModelEnsemble({ rows, date: query.date, sport: query.sport, limit: openAiLimit });
        const featureMatrix = buildDecisionFeatureMatrix({ rows, date: query.date, sport: query.sport, limit: openAiLimit });
        const modelGovernance = buildDecisionModelGovernance({ matrix: featureMatrix, training, date: query.date, sport: query.sport });
        const dataIntake = buildDecisionDataIntakeQueue({ rows, date: query.date, sport: query.sport, readiness, limit: openAiLimit });
        const dossier = await runDecisionAIContextDossierReview({
          rows,
          date: query.date,
          sport: query.sport,
          modelEnsemble,
          featureMatrix,
          modelGovernance,
          dataIntake,
          runRequested: true,
          env: process.env
        });

        return buildDecisionOpenAILiveReviewReceipt({
          aiReviewReadiness,
          openAiKeyDiagnostic,
          dossier
        });
      })()
    : context.openAiLiveReviewReceipt;

  return apiSuccess(
    buildDecisionEngineCapacityState({
      openAiKeyDiagnostic: context.openAiKeyDiagnostic,
      openAiLiveReviewReceipt,
      supabaseTrainingCorpusCensus,
      firstCorpusImportQueue,
      providerKeyPlan: context.providerActivationQueue.providerKeyPlan,
      mvpProgressReceipt: context.mvpProgressReceipt
    })
  );
}
