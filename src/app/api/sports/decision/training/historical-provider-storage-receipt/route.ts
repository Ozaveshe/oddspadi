import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { observeHistoricalProviderStorageReceipt } from "@/lib/sports/training/historicalProviderStorageReceipt";
import type { HistoricalProviderBackfillRequest } from "@/lib/sports/training/historicalBackfill";
import type { ProviderName } from "@/lib/sports/training/providerSync";

export const dynamic = "force-dynamic";

function enabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function cleanText(value: string | null): string | undefined {
  return value?.trim() || undefined;
}

function parseProvider(value: string | null): ProviderName | null {
  const provider = cleanText(value);
  if (provider === "api-football" || provider === "api-basketball" || provider === "api-tennis" || provider === "the-odds-api") return provider;
  return null;
}

function parseBoolean(value: string | null, fallback = false): boolean {
  if (value === null) return fallback;
  return value !== "0" && value.toLowerCase() !== "false";
}

function parseInteger(value: string | null, max: number): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : undefined;
}

function parseCsv(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const rows = value.split(",").map((item) => item.trim()).filter(Boolean);
  return rows.length ? rows : undefined;
}

function requestFromUrl(url: URL): Partial<HistoricalProviderBackfillRequest> {
  return {
    provider: parseProvider(url.searchParams.get("provider")) ?? undefined,
    dryRun: parseBoolean(url.searchParams.get("dryRun"), true),
    league: cleanText(url.searchParams.get("league")),
    seasons: parseCsv(url.searchParams.get("seasons")),
    seasonFrom: cleanText(url.searchParams.get("seasonFrom")),
    seasonTo: cleanText(url.searchParams.get("seasonTo")),
    dates: parseCsv(url.searchParams.get("dates")),
    from: cleanText(url.searchParams.get("from")),
    to: cleanText(url.searchParams.get("to")),
    intervalDays: parseInteger(url.searchParams.get("intervalDays"), 365),
    sportKey: cleanText(url.searchParams.get("sportKey")),
    regions: cleanText(url.searchParams.get("regions")),
    bookmakers: cleanText(url.searchParams.get("bookmakers")),
    includeEvents: parseBoolean(url.searchParams.get("includeEvents")),
    includeNews: parseBoolean(url.searchParams.get("includeNews")),
    includeContext: parseBoolean(url.searchParams.get("includeContext")),
    includeStandings: parseBoolean(url.searchParams.get("includeStandings")),
    includeAvailability: parseBoolean(url.searchParams.get("includeAvailability")),
    includeLineups: parseBoolean(url.searchParams.get("includeLineups")),
    includeWeather: parseBoolean(url.searchParams.get("includeWeather")),
    maxEventFixtures: parseInteger(url.searchParams.get("maxEventFixtures"), 50),
    maxContextFixtures: parseInteger(url.searchParams.get("maxContextFixtures"), 120),
    limit: parseInteger(url.searchParams.get("limit"), 5000),
    maxJobs: parseInteger(url.searchParams.get("maxJobs"), 120),
    stopOnError: parseBoolean(url.searchParams.get("stopOnError"), true)
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runRequested = enabled(url.searchParams.get("run"));
  const requestedDryRun = parseBoolean(url.searchParams.get("dryRun"), true);
  const adminAuthorized = isDecisionAdminAuthorized(request);

  if (!requestedDryRun && !runRequested) {
    return apiError("Historical provider storage writes require dryRun=0 with run=1 and x-oddspadi-admin-token. Use dryRun=1 without run=1 for preview.", 400);
  }
  if (runRequested && !adminAuthorized) {
    return apiError("Historical provider storage execution requires run=1 plus x-oddspadi-admin-token.", 401);
  }

  const receipt = await observeHistoricalProviderStorageReceipt({
    request: requestFromUrl(url),
    runRequested,
    adminAuthorized,
    env: process.env,
    origin: url.origin
  });

  return apiSuccess(receipt, { status: statusCode(receipt.status) });
}
