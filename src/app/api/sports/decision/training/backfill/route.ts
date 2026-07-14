import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isTrainingAdminAuthorized } from "@/lib/sports/training/adminAuth";
import {
  runHistoricalProviderBackfill,
  type HistoricalProviderBackfillRequest,
  type HistoricalProviderBackfillResult
} from "@/lib/sports/training/historicalBackfill";
import type { ProviderName } from "@/lib/sports/training/providerSync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type BackfillBody = Partial<HistoricalProviderBackfillRequest> & Record<string, unknown>;
function cleanText(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function parseProvider(value: unknown): ProviderName | null {
  const provider = cleanText(value);
  return provider === "api-football" || provider === "api-basketball" || provider === "api-tennis" || provider === "the-odds-api" ? provider : null;
}
function rawValue(url: URL, body: BackfillBody | null, key: string): unknown { return url.searchParams.get(key) ?? body?.[key]; }
function pickText(url: URL, body: BackfillBody | null, key: string): string | undefined { return cleanText(rawValue(url, body, key)) || undefined; }
function parseBoolean(url: URL, body: BackfillBody | null, key: string, fallback = false): boolean {
  const raw = rawValue(url, body, key);
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === "boolean") return raw;
  const value = String(raw).toLowerCase();
  return value !== "0" && value !== "false";
}
function parseInteger(url: URL, body: BackfillBody | null, key: string, max: number): number | undefined {
  const parsed = Number(rawValue(url, body, key));
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : undefined;
}
function parseCsv(url: URL, body: BackfillBody | null, key: "seasons" | "dates"): string[] | undefined {
  const raw = rawValue(url, body, key);
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const result = values.map((value) => String(value).trim()).filter(Boolean);
  return result.length ? result : undefined;
}
function statusFor(result: HistoricalProviderBackfillResult): number {
  if (result.status === "stored" || result.status === "dry-run") return 200;
  if (result.status === "partial") return 207;
  if (result.status === "not-configured") return 503;
  if (result.status === "invalid-request") return 400;
  return 500;
}

export const POST = withApiHandler(async (request: Request) => {
  if (!isTrainingAdminAuthorized(request)) return apiError("Historical backfill requires a valid x-oddspadi-admin-token.", 401);
  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as BackfillBody | null;
  const provider = parseProvider(url.searchParams.get("provider") ?? body?.provider);
  if (!provider) return apiError("provider must be api-football, api-basketball, api-tennis, or the-odds-api.");
  const result = await runHistoricalProviderBackfill({ request: {
    provider,
    dryRun: parseBoolean(url, body, "dryRun", true), league: pickText(url, body, "league"),
    seasons: parseCsv(url, body, "seasons"), seasonFrom: pickText(url, body, "seasonFrom"), seasonTo: pickText(url, body, "seasonTo"),
    dates: parseCsv(url, body, "dates"), from: pickText(url, body, "from"), to: pickText(url, body, "to"),
    intervalDays: parseInteger(url, body, "intervalDays", 365), sportKey: pickText(url, body, "sportKey"),
    regions: pickText(url, body, "regions"), bookmakers: pickText(url, body, "bookmakers"),
    includeEvents: parseBoolean(url, body, "includeEvents"), includeNews: parseBoolean(url, body, "includeNews"),
    includeContext: parseBoolean(url, body, "includeContext"), includeStandings: parseBoolean(url, body, "includeStandings"),
    includeAvailability: parseBoolean(url, body, "includeAvailability"), includeLineups: parseBoolean(url, body, "includeLineups"),
    includePlayerStats: parseBoolean(url, body, "includePlayerStats"), includeWeather: parseBoolean(url, body, "includeWeather"),
    maxEventFixtures: parseInteger(url, body, "maxEventFixtures", 50), maxContextFixtures: parseInteger(url, body, "maxContextFixtures", 120),
    limit: parseInteger(url, body, "limit", 5_000), maxJobs: parseInteger(url, body, "maxJobs", 120),
    stopOnError: parseBoolean(url, body, "stopOnError", true)
  } });
  return apiSuccess(result, { status: statusFor(result) });
});
