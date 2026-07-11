import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import {
  syncHistoricalFootballProvider,
  type ProviderName,
  type ProviderSyncRequest,
  type ProviderSyncResult
} from "@/lib/sports/training/providerSync";

export const dynamic = "force-dynamic";

type SyncBody = Partial<Omit<ProviderSyncRequest, "provider" | "limit" | "dryRun">> & {
  provider?: string;
  limit?: number | string;
  dryRun?: boolean | string;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseProvider(value: unknown): ProviderName | null {
  const provider = cleanText(value);
  if (provider === "api-football" || provider === "api-basketball" || provider === "api-tennis" || provider === "the-odds-api") return provider;
  return null;
}

function pickText(url: URL, body: SyncBody | null, key: keyof SyncBody): string | undefined {
  const queryValue = url.searchParams.get(String(key));
  if (queryValue !== null) return queryValue.trim() || undefined;
  const bodyValue = body?.[key];
  return typeof bodyValue === "string" ? bodyValue.trim() || undefined : undefined;
}

function parseDryRun(url: URL, body: SyncBody | null): boolean {
  const queryValue = url.searchParams.get("dryRun");
  if (queryValue !== null) return queryValue !== "0" && queryValue.toLowerCase() !== "false";
  if (typeof body?.dryRun === "boolean") return body.dryRun;
  if (typeof body?.dryRun === "string") return body.dryRun !== "0" && body.dryRun.toLowerCase() !== "false";
  return true;
}

function parseBooleanFlag(url: URL, body: SyncBody | null, key: keyof SyncBody): boolean {
  const queryValue = url.searchParams.get(String(key));
  if (queryValue !== null) return queryValue !== "0" && queryValue.toLowerCase() !== "false";
  const bodyValue = body?.[key];
  if (typeof bodyValue === "boolean") return bodyValue;
  if (typeof bodyValue === "string") return bodyValue !== "0" && bodyValue.toLowerCase() !== "false";
  return false;
}

function parseLimit(url: URL, body: SyncBody | null): number | undefined {
  const raw = url.searchParams.get("limit") ?? body?.limit;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 5000) : undefined;
}

function parseInteger(url: URL, body: SyncBody | null, key: keyof SyncBody, max: number): number | undefined {
  const raw = url.searchParams.get(String(key)) ?? body?.[key];
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : undefined;
}

function statusForResult(result: ProviderSyncResult): number {
  if (result.status === "stored" || result.status === "dry-run") return 200;
  if (result.status === "not-configured") return 503;
  if (result.status === "provider-error") return 502;
  return 400;
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Provider sync requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as SyncBody | null;
  const provider = parseProvider(url.searchParams.get("provider") ?? body?.provider);
  if (!provider) return apiError("provider must be api-football, api-basketball, api-tennis, or the-odds-api.");

  try {
    const result = await syncHistoricalFootballProvider({
      request: {
        provider,
        dryRun: parseDryRun(url, body),
        league: pickText(url, body, "league"),
        season: pickText(url, body, "season"),
        date: pickText(url, body, "date"),
        from: pickText(url, body, "from"),
        to: pickText(url, body, "to"),
        sportKey: pickText(url, body, "sportKey"),
        regions: pickText(url, body, "regions"),
        bookmakers: pickText(url, body, "bookmakers"),
        includeEvents: parseBooleanFlag(url, body, "includeEvents"),
        includeNews: parseBooleanFlag(url, body, "includeNews"),
        includeContext: parseBooleanFlag(url, body, "includeContext"),
        includeStandings: parseBooleanFlag(url, body, "includeStandings"),
        includeAvailability: parseBooleanFlag(url, body, "includeAvailability"),
        includeLineups: parseBooleanFlag(url, body, "includeLineups"),
        includeWeather: parseBooleanFlag(url, body, "includeWeather"),
        maxEventFixtures: parseInteger(url, body, "maxEventFixtures", 50),
        maxContextFixtures: parseInteger(url, body, "maxContextFixtures", 120),
        limit: parseLimit(url, body)
      }
    });

    return apiSuccess(result, { status: statusForResult(result) });
  } catch (error) {
    return apiSuccess(
      {
        status: "failed",
        configured: true,
        provider,
        dryRun: parseDryRun(url, body),
        endpoint: null,
        fetched: 0,
        normalized: 0,
        reason: error instanceof Error ? error.message : "Provider sync failed."
      } satisfies ProviderSyncResult,
      { status: 500 }
    );
  }
}
