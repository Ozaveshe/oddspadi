import { apiSuccess } from "@/app/api/sports/_utils";
import { buildTenYearFootballCorpusBackfillPlan } from "@/lib/sports/training/corpusBackfillPlan";

export const dynamic = "force-dynamic";

function parsePositiveInteger(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseBoolean(value: string | null, fallback = true): boolean {
  if (value === null) return fallback;
  return value !== "0" && value.toLowerCase() !== "false";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return apiSuccess(
    buildTenYearFootballCorpusBackfillPlan({
      baseUrl: url.origin,
      seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")),
      seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")),
      maxJobsPerLeague: parsePositiveInteger(url.searchParams.get("maxJobsPerLeague")),
      includeUefaChampionsLeague: parseBoolean(url.searchParams.get("includeUefaChampionsLeague"), true)
    })
  );
}
