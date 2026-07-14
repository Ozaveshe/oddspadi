import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isTrainingAdminAuthorized } from "@/lib/sports/training/adminAuth";
import type { HistoricalProviderBackfillRequest } from "@/lib/sports/training/historicalBackfill";
import { observeHistoricalProviderStorageReceipt } from "@/lib/sports/training/historicalProviderStorageReceipt";
import type { ProviderName } from "@/lib/sports/training/providerSync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function enabled(value: string | null): boolean { return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes"; }
function text(value: string | null): string | undefined { return value?.trim() || undefined; }
function parseProvider(value: string | null): ProviderName | undefined {
  const provider = text(value);
  return provider === "api-football" || provider === "api-basketball" || provider === "api-tennis" || provider === "the-odds-api" ? provider : undefined;
}
function bool(value: string | null, fallback = false): boolean { return value === null ? fallback : value !== "0" && value.toLowerCase() !== "false"; }
function integer(value: string | null, max: number): number | undefined { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : undefined; }
function csv(value: string | null): string[] | undefined { const values = value?.split(",").map((item) => item.trim()).filter(Boolean) ?? []; return values.length ? values : undefined; }
function requestFromUrl(url: URL): Partial<HistoricalProviderBackfillRequest> {
  return {
    provider: parseProvider(url.searchParams.get("provider")), dryRun: bool(url.searchParams.get("dryRun"), true),
    league: text(url.searchParams.get("league")), seasons: csv(url.searchParams.get("seasons")),
    seasonFrom: text(url.searchParams.get("seasonFrom")), seasonTo: text(url.searchParams.get("seasonTo")), dates: csv(url.searchParams.get("dates")),
    from: text(url.searchParams.get("from")), to: text(url.searchParams.get("to")), intervalDays: integer(url.searchParams.get("intervalDays"), 365),
    sportKey: text(url.searchParams.get("sportKey")), regions: text(url.searchParams.get("regions")), bookmakers: text(url.searchParams.get("bookmakers")),
    includeEvents: bool(url.searchParams.get("includeEvents")), includeNews: bool(url.searchParams.get("includeNews")),
    includeContext: bool(url.searchParams.get("includeContext")), includeStandings: bool(url.searchParams.get("includeStandings")),
    includeAvailability: bool(url.searchParams.get("includeAvailability")), includeLineups: bool(url.searchParams.get("includeLineups")),
    includePlayerStats: bool(url.searchParams.get("includePlayerStats")), includeWeather: bool(url.searchParams.get("includeWeather")),
    maxEventFixtures: integer(url.searchParams.get("maxEventFixtures"), 50), maxContextFixtures: integer(url.searchParams.get("maxContextFixtures"), 120),
    limit: integer(url.searchParams.get("limit"), 5_000), maxJobs: integer(url.searchParams.get("maxJobs"), 120),
    stopOnError: bool(url.searchParams.get("stopOnError"), true)
  };
}
function statusCode(status: string): number {
  if (status === "waiting-admin") return 401;
  if (status === "waiting-provider-env" || status === "waiting-supabase") return 503;
  if (status === "invalid-request") return 400;
  if (status === "provider-error") return 502;
  if (status === "partial") return 207;
  if (status === "failed") return 500;
  return 200;
}

export const GET = withApiHandler(async (request: Request) => {
  const url = new URL(request.url);
  const runRequested = enabled(url.searchParams.get("run"));
  const dryRun = bool(url.searchParams.get("dryRun"), true);
  const adminAuthorized = isTrainingAdminAuthorized(request);
  if (!dryRun && !runRequested) return apiError("Writes require dryRun=0 with run=1 and a valid admin token.", 400);
  if (runRequested && !adminAuthorized) return apiError("Execution requires run=1 plus a valid x-oddspadi-admin-token.", 401);
  const receipt = await observeHistoricalProviderStorageReceipt({ request: requestFromUrl(url), runRequested, adminAuthorized, env: process.env, origin: url.origin });
  return apiSuccess(receipt, { status: statusCode(receipt.status) });
});
