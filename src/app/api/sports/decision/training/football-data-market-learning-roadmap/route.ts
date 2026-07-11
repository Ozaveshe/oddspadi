import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { buildFootballDataMarketBenchmark } from "@/lib/sports/training/footballDataMarketBenchmark";
import { buildFootballDataMarketLearningRoadmap } from "@/lib/sports/training/footballDataMarketLearningRoadmap";
import { buildFootballDataMarketSegmentRetest } from "@/lib/sports/training/footballDataMarketSegmentRetest";
import { buildFootballDataThresholdSweep } from "@/lib/sports/training/footballDataThresholdSweep";

export const dynamic = "force-dynamic";

function parsePositiveInteger(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNumber(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun");
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") return apiError("football-data-market-learning-roadmap is read-only; use dryRun=1.", 400);

  const seasonFrom = parsePositiveInteger(url.searchParams.get("seasonFrom"));
  const seasonTo = parsePositiveInteger(url.searchParams.get("seasonTo"));
  const maxSeasons = parsePositiveInteger(url.searchParams.get("maxSeasons"));
  const trainRatio = parseNumber(url.searchParams.get("trainRatio"));
  const minPickCount = parsePositiveInteger(url.searchParams.get("minPickCount"));

  const [benchmark, thresholdSweep] = await Promise.all([
    buildFootballDataMarketBenchmark({
      seasonFrom,
      seasonTo,
      maxSeasons,
      trainRatio,
      minEdge: parseNumber(url.searchParams.get("minEdge")),
      minModelProbability: parseNumber(url.searchParams.get("minModelProbability"))
    }),
    buildFootballDataThresholdSweep({
      seasonFrom,
      seasonTo,
      maxSeasons,
      trainRatio,
      minPickCount
    })
  ]);
  const segmentRetest = buildFootballDataMarketSegmentRetest({ benchmark, thresholdSweep });
  const roadmap = buildFootballDataMarketLearningRoadmap({ benchmark, thresholdSweep, segmentRetest });

  return apiSuccess(roadmap, { status: benchmark.status === "failed" || thresholdSweep.status === "failed" ? 502 : 200 });
}
