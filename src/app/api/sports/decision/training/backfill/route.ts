import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import {
  runHistoricalProviderBackfill,
  type HistoricalProviderBackfillRequest,
  type HistoricalProviderBackfillResult
} from "@/lib/sports/training/historicalBackfill";
import type { ProviderName } from "@/lib/sports/training/providerSync";

export const dynamic = "force-dynamic";

type BackfillBody = Partial<HistoricalProviderBackfillRequest> & {
  provider?: string;
  dryRun?: boolean | string;
  includeEvents?: boolean | string;
  includeNews?: boolean | string;
  includeContext?: boolean | string;
  includeStandings?: boolean | string;
  includeAvailability?: boolean | string;
  includeLineups?: boolean | string;
  includeWeather?: boolean | string;
  maxEventFixtures?: number | string;
  maxContextFixtures?: number | string;
  stopOnError?: boolean | string;
  limit?: number | string;
  maxJobs?: number | string;
  intervalDays?: number | string;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseProvider(value: unknown): ProviderName | null {
  const provider = cleanText(value);
  if (provider === "api-football" || provider === "api-basketball" || provider === "api-tennis" || provider === "the-odds-api") return provider;
  return null;
}

function pickText(url: URL, body: BackfillBody | null, key: keyof BackfillBody): string | undefined {
  const queryValue = url.searchParams.get(String(key));
  if (queryValue !== null) return queryValue.trim() || undefined;
  const bodyValue = body?.[key];
  return typeof bodyValue === "string" ? bodyValue.trim() || undefined : undefined;
}

function parseBooleanFlag(url: URL, body: BackfillBody | null, key: keyof BackfillBody, fallback = false): boolean {
  const queryValue = url.searchParams.get(String(key));
  if (queryValue !== null) return queryValue !== "0" && queryValue.toLowerCase() !== "false";
  const bodyValue = body?.[key];
  if (typeof bodyValue === "boolean") return bodyValue;
  if (typeof bodyValue === "string") return bodyValue !== "0" && bodyValue.toLowerCase() !== "false";
  return fallback;
}

function parseInteger(url: URL, body: BackfillBody | null, key: keyof BackfillBody, max: number): number | undefined {
  const raw = url.searchParams.get(String(key)) ?? body?.[key];
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : undefined;
}

function parseCsv(url: URL, body: BackfillBody | null, key: "seasons" | "dates"): string[] | undefined {
  const queryValue = url.searchParams.get(key);
  if (queryValue !== null) return queryValue.split(",").map((item) => item.trim()).filter(Boolean);
  const bodyValue = body?.[key];
  if (Array.isArray(bodyValue)) return bodyValue.map((item) => String(item).trim()).filter(Boolean);
  return undefined;
}

function statusForResult(result: HistoricalProviderBackfillResult): number {
  if (result.status === "stored" || result.status === "dry-run") return 200;
  if (result.status === "partial") return 207;
  if (result.status === "not-configured") return 503;
  if (result.status === "invalid-request") return 400;
  return 500;
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Historical backfill requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as BackfillBody | null;
  const provider = parseProvider(url.searchParams.get("provider") ?? body?.provider);
  if (!provider) return apiError("provider must be api-football, api-basketball, api-tennis, or the-odds-api.");

  const result = await runHistoricalProviderBackfill({
    request: {
      provider,
      dryRun: parseBooleanFlag(url, body, "dryRun", true),
      league: pickText(url, body, "league"),
      seasons: parseCsv(url, body, "seasons"),
      seasonFrom: pickText(url, body, "seasonFrom"),
      seasonTo: pickText(url, body, "seasonTo"),
      dates: parseCsv(url, body, "dates"),
      from: pickText(url, body, "from"),
      to: pickText(url, body, "to"),
      intervalDays: parseInteger(url, body, "intervalDays", 365),
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
      limit: parseInteger(url, body, "limit", 5000),
      maxJobs: parseInteger(url, body, "maxJobs", 120),
      stopOnError: parseBooleanFlag(url, body, "stopOnError")
    }
  });

  return apiSuccess(result, { status: statusForResult(result) });
}
