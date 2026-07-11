import { apiError, apiSuccess, parsePredictionFilters, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { buildDecisionMarketCalibratedFusion } from "@/lib/sports/prediction/decisionMarketCalibratedFusion";
import { buildFootballDataMarketBenchmark } from "@/lib/sports/training/footballDataMarketBenchmark";
import {
  footballDataMarketBenchmarkFromMemory,
  readFootballDataMarketBenchmarkMemory
} from "@/lib/sports/training/footballDataMarketBenchmarkMemory";

export const dynamic = "force-dynamic";

function parsePositiveInteger(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNumber(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isEnabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const filters = parsePredictionFilters(request);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport,
    baseUrl: url.origin,
    env: process.env,
    league: filters.league,
    country: filters.country,
    query: filters.query,
    confidence: filters.confidence
  });
  const benchmark = isEnabled(url.searchParams.get("benchmark"))
    ? await buildFootballDataMarketBenchmark({
        seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")),
        seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")),
        maxSeasons: parsePositiveInteger(url.searchParams.get("maxSeasons")),
        trainRatio: parseNumber(url.searchParams.get("trainRatio")),
        minEdge: parseNumber(url.searchParams.get("minEdge")),
        minModelProbability: parseNumber(url.searchParams.get("minModelProbability"))
      })
    : isEnabled(url.searchParams.get("benchmarkMemory"))
      ? footballDataMarketBenchmarkFromMemory(await readFootballDataMarketBenchmarkMemory({ limit: 1 }))
    : null;

  return apiSuccess(
    buildDecisionMarketCalibratedFusion({
      date: query.date,
      sport: query.sport,
      probabilityFusionAudit: context.probabilityFusionAudit,
      benchmark
    })
  );
}
