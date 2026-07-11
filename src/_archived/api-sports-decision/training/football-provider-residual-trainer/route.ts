import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { trainStoredFootballProviderResidualModel } from "@/lib/sports/training/footballProviderResidualTrainer";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(1000, parsed) : undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun");
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") {
    return apiError("football-provider-residual-trainer is read-only; use dryRun=1.", 400);
  }
  const receipt = await trainStoredFootballProviderResidualModel({ limit: parseLimit(url.searchParams.get("limit")) });
  return apiSuccess(receipt, { status: receipt.status === "failed" ? 502 : 200 });
}
