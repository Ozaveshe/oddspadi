import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isTrainingAdminAuthorized } from "@/lib/sports/training/adminAuth";
import {
  syncHistoricalFootballProvider,
  type ProviderName,
  type ProviderSyncRequest,
  type ProviderSyncResult
} from "@/lib/sports/training/providerSync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SyncBody = Partial<Omit<ProviderSyncRequest, "provider" | "limit" | "dryRun">> & {
  provider?: string;
  limit?: number | string;
  dryRun?: boolean | string;
};

function cleanText(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function parseProvider(value: unknown): ProviderName | null {
  const provider = cleanText(value);
  return provider === "api-football" || provider === "api-basketball" || provider === "api-tennis" || provider === "the-odds-api" ? provider : null;
}
function pickText(url: URL, body: SyncBody | null, key: keyof SyncBody): string | undefined {
  const queryValue = url.searchParams.get(String(key));
  if (queryValue !== null) return queryValue.trim() || undefined;
  const bodyValue = body?.[key];
  return typeof bodyValue === "string" ? bodyValue.trim() || undefined : undefined;
}
function parseBoolean(url: URL, body: SyncBody | null, key: keyof SyncBody, fallback = false): boolean {
  const raw = url.searchParams.get(String(key)) ?? body?.[key];
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === "boolean") return raw;
  const value = String(raw).toLowerCase();
  return value !== "0" && value !== "false";
}
function parseInteger(url: URL, body: SyncBody | null, key: keyof SyncBody, max: number): number | undefined {
  const parsed = Number(url.searchParams.get(String(key)) ?? body?.[key]);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : undefined;
}
function statusFor(result: ProviderSyncResult): number {
  if (result.status === "stored" || result.status === "dry-run") return 200;
  if (result.status === "not-configured") return 503;
  if (result.status === "provider-error") return 502;
  return result.status === "failed" ? 500 : 400;
}

export const POST = withApiHandler(async (request: Request) => {
  if (!isTrainingAdminAuthorized(request)) return apiError("Provider sync requires a valid x-oddspadi-admin-token.", 401);
  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as SyncBody | null;
  const provider = parseProvider(url.searchParams.get("provider") ?? body?.provider);
  if (!provider) return apiError("provider must be api-football, api-basketball, api-tennis, or the-odds-api.");
  const result = await syncHistoricalFootballProvider({
    request: {
      provider,
      dryRun: parseBoolean(url, body, "dryRun", true),
      league: pickText(url, body, "league"), season: pickText(url, body, "season"), date: pickText(url, body, "date"),
      from: pickText(url, body, "from"), to: pickText(url, body, "to"), sportKey: pickText(url, body, "sportKey"),
      regions: pickText(url, body, "regions"), bookmakers: pickText(url, body, "bookmakers"),
      includeEvents: parseBoolean(url, body, "includeEvents"), includeNews: parseBoolean(url, body, "includeNews"),
      includeContext: parseBoolean(url, body, "includeContext"), includeStandings: parseBoolean(url, body, "includeStandings"),
      includeAvailability: parseBoolean(url, body, "includeAvailability"), includeLineups: parseBoolean(url, body, "includeLineups"),
      includePlayerStats: parseBoolean(url, body, "includePlayerStats"), includeWeather: parseBoolean(url, body, "includeWeather"),
      maxEventFixtures: parseInteger(url, body, "maxEventFixtures", 50),
      maxContextFixtures: parseInteger(url, body, "maxContextFixtures", 120),
      limit: parseInteger(url, body, "limit", 5_000)
    }
  });
  return apiSuccess(result, { status: statusFor(result) });
});
