import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionDataAcquisitionContract } from "@/lib/sports/prediction/decisionDataAcquisitionContract";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { buildFirstCorpusImportQueue } from "@/lib/sports/training/firstCorpusImportQueue";
import { buildMultiSportCorpusPlan, type TrainingCorpusSport } from "@/lib/sports/training/multiSportCorpusPlan";
import { buildProviderCorpusDryRunQueue } from "@/lib/sports/training/providerCorpusDryRunQueue";
import { readSupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";
import { buildTrainingDataBlueprint } from "@/lib/sports/training/trainingDataBlueprint";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

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

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const trainingSports = parseTrainingSports(url.searchParams.get("trainingSports") ?? url.searchParams.get("corpusSport") ?? url.searchParams.get("sport"));
  if (trainingSports?.length === 0) return apiError("sport must be football, basketball, tennis, a comma-separated subset, or all.");

  const corpusPlan = buildMultiSportCorpusPlan({
    env: process.env,
    baseUrl: url.origin,
    seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")) ?? 2025,
    seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")) ?? 2026,
    maxJobsPerLeague: parsePositiveInteger(url.searchParams.get("maxJobsPerLeague")) ?? 1,
    sports: trainingSports
  });
  const [context, supabaseTrainingCorpusCensus, providerQueue, trainingSnapshots] = await Promise.all([
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
    buildProviderCorpusDryRunQueue({
      corpusPlan,
      env: process.env,
      runRequested: false,
      adminAuthorized: false,
      origin: url.origin
    }),
    Promise.all(corpusPlan.sports.map((sportPlan) => getTrainingDataSnapshot(sportPlan.sport)))
  ]);
  const firstCorpusImportQueue = buildFirstCorpusImportQueue({
    census: supabaseTrainingCorpusCensus,
    providerQueue,
    origin: url.origin
  });
  const trainingDataBlueprint = buildTrainingDataBlueprint({ corpusPlan, trainingSnapshots });

  return apiSuccess(
    buildDecisionDataAcquisitionContract({
      providerKeyPlan: context.providerActivationQueue.providerKeyPlan,
      trainingDataBlueprint,
      supabaseTrainingCorpusCensus,
      firstCorpusImportQueue
    })
  );
}
