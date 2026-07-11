import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { buildFirstCorpusImportQueue } from "@/lib/sports/training/firstCorpusImportQueue";
import { buildMultiSportCorpusPlan, type TrainingCorpusSport } from "@/lib/sports/training/multiSportCorpusPlan";
import { buildProviderCorpusDryRunQueue } from "@/lib/sports/training/providerCorpusDryRunQueue";
import { readSupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";

export const dynamic = "force-dynamic";

function parsePositiveInteger(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseSports(value: string | null): TrainingCorpusSport[] | undefined {
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
  const sports = parseSports(url.searchParams.get("sport"));
  if (sports?.length === 0) return apiError("sport must be football, basketball, tennis, a comma-separated subset, or all.");

  const [census, corpusPlan] = await Promise.all([
    readSupabaseTrainingCorpusCensus({
      env: process.env,
      origin: url.origin
    }),
    Promise.resolve(
      buildMultiSportCorpusPlan({
        env: process.env,
        baseUrl: url.origin,
        seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")),
        seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")),
        maxJobsPerLeague: parsePositiveInteger(url.searchParams.get("maxJobsPerLeague")),
        sports
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

  return apiSuccess(buildFirstCorpusImportQueue({ census, providerQueue, origin: url.origin }));
}
