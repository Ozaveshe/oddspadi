import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { buildFootballDataMarketConsensus } from "@/lib/sports/training/footballDataMarketConsensus";

export const dynamic = "force-dynamic";

function parsePositiveInteger(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun");
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") return apiError("football-data-market-consensus is read-only; use dryRun=1.", 400);

  const result = await buildFootballDataMarketConsensus({
    seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")),
    seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")),
    maxSeasons: parsePositiveInteger(url.searchParams.get("maxSeasons"))
  });

  return apiSuccess(result, { status: result.status === "failed" ? 502 : 200 });
}
