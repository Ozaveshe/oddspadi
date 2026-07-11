import { apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildFootballDataMarketBenchmark } from "@/lib/sports/training/footballDataMarketBenchmark";
import { observeFootballDataMarketBenchmarkPersistenceReceipt } from "@/lib/sports/training/footballDataMarketBenchmarkPersistenceReceipt";

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
  const url = new URL(request.url);
  const benchmark = await buildFootballDataMarketBenchmark({
    seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")),
    seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")),
    maxSeasons: parsePositiveInteger(url.searchParams.get("maxSeasons")),
    trainRatio: parseNumber(url.searchParams.get("trainRatio")),
    minEdge: parseNumber(url.searchParams.get("minEdge")),
    minModelProbability: parseNumber(url.searchParams.get("minModelProbability"))
  });
  const receipt = await observeFootballDataMarketBenchmarkPersistenceReceipt({
    benchmark,
    runRequested: isEnabled(url.searchParams.get("run")),
    adminAuthorized: isDecisionAdminAuthorized(request),
    env: process.env,
    origin: url.origin
  });

  return apiSuccess(receipt, { status: receipt.status === "failed" ? 500 : 200 });
}
