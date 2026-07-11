import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { buildFootballDataCsvCorpusProbe } from "@/lib/sports/training/footballDataCsvCorpusProbe";

export const dynamic = "force-dynamic";

function parsePositiveInteger(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun");
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") return apiError("football-data-csv-probe is read-only; use dryRun=1.", 400);

  const result = await buildFootballDataCsvCorpusProbe({
    seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")),
    seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")),
    maxSeasons: parsePositiveInteger(url.searchParams.get("maxSeasons"))
  });

  return apiSuccess(result, { status: result.status === "invalid-request" ? 400 : result.status === "failed" ? 502 : 200 });
}
