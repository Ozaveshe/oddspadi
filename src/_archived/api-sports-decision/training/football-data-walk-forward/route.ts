import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { buildFootballDataWalkForwardValidation } from "@/lib/sports/training/footballDataWalkForwardValidation";

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
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") return apiError("football-data-walk-forward is read-only; use dryRun=1.", 400);

  const result = await buildFootballDataWalkForwardValidation({
    seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")),
    seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")),
    maxSeasons: parsePositiveInteger(url.searchParams.get("maxSeasons")),
    minTrainingSeasons: parsePositiveInteger(url.searchParams.get("minTrainingSeasons")),
    minEdge: parseNumber(url.searchParams.get("minEdge")),
    minModelProbability: parseNumber(url.searchParams.get("minModelProbability"))
  });

  return apiSuccess(result, { status: result.status === "failed" ? 502 : 200 });
}
