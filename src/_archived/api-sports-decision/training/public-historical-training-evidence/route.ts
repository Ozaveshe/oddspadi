import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { buildFootballDataHistoricalLearningDossier } from "@/lib/sports/training/footballDataHistoricalLearningDossier";
import { buildPublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";

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
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") {
    return apiError("public-historical-training-evidence is read-only; use dryRun=1.", 400);
  }

  const dossier = await buildFootballDataHistoricalLearningDossier({
    seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")),
    seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")),
    maxSeasons: parsePositiveInteger(url.searchParams.get("maxSeasons")),
    trainRatio: parseNumber(url.searchParams.get("trainRatio")),
    minEdge: parseNumber(url.searchParams.get("minEdge")),
    minModelProbability: parseNumber(url.searchParams.get("minModelProbability")),
    minPickCount: parsePositiveInteger(url.searchParams.get("minPickCount")),
    minTrainingSeasons: parsePositiveInteger(url.searchParams.get("minTrainingSeasons"))
  });
  const evidence = buildPublicHistoricalTrainingEvidence({ dossier });

  return apiSuccess(
    {
      ...evidence,
      historicalLearningDossier: dossier
    },
    { status: dossier.status === "failed" ? 502 : 200 }
  );
}
