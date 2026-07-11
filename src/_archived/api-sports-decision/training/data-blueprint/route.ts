import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { buildMultiSportCorpusPlan, type TrainingCorpusSport } from "@/lib/sports/training/multiSportCorpusPlan";
import { buildTrainingDataBlueprint } from "@/lib/sports/training/trainingDataBlueprint";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

function parsePositiveInteger(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sports = parseSport(url.searchParams.get("sport"));
  if (sports?.length === 0) return apiError("sport must be football, basketball, tennis, a comma-separated subset, or all.");

  const corpusPlan = buildMultiSportCorpusPlan({
    baseUrl: url.origin,
    seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")),
    seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")),
    maxJobsPerLeague: parsePositiveInteger(url.searchParams.get("maxJobsPerLeague")),
    sports
  });
  const trainingSnapshots = await Promise.all(corpusPlan.sports.map((sportPlan) => getTrainingDataSnapshot(sportPlan.sport)));

  return apiSuccess(buildTrainingDataBlueprint({ corpusPlan, trainingSnapshots }));
}
