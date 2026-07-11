import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { buildDecisionMarketPriorGovernor } from "@/lib/sports/prediction/decisionMarketPriorGovernor";
import { buildFootballDataMarketBenchmark } from "@/lib/sports/training/footballDataMarketBenchmark";

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
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport,
    baseUrl: url.origin,
    env: process.env
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
    : null;
  const governor = buildDecisionMarketPriorGovernor({
    date: query.date,
    sport: query.sport,
    probabilityFusionAudit: context.probabilityFusionAudit,
    marketAlternativeArbiter: context.marketAlternativeArbiter,
    benchmark
  });

  return apiSuccess(governor);
}
