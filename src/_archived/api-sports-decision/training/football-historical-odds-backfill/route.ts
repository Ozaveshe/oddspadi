import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import {
  runFootballHistoricalOddsBackfill,
  type FootballHistoricalOddsBackfillMode,
  type FootballHistoricalOddsBackfillRequest,
  type FootballHistoricalOddsBackfillResult
} from "@/lib/sports/training/footballHistoricalOddsBackfill";

export const dynamic = "force-dynamic";

type BackfillBody = Partial<Record<keyof FootballHistoricalOddsBackfillRequest | "run", unknown>>;

function textValue(url: URL, body: BackfillBody | null, key: keyof FootballHistoricalOddsBackfillRequest): string | undefined {
  const value = url.searchParams.get(String(key)) ?? body?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanValue(url: URL, body: BackfillBody | null, key: keyof BackfillBody, fallback: boolean): boolean {
  const value = url.searchParams.get(String(key)) ?? body?.[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value !== "0" && value.toLowerCase() !== "false";
  return fallback;
}

function integerValue(
  url: URL,
  body: BackfillBody | null,
  key: keyof FootballHistoricalOddsBackfillRequest,
  min: number,
  max: number
): number | undefined {
  const value = url.searchParams.get(String(key)) ?? body?.[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= min ? Math.min(parsed, max) : undefined;
}

function modeValue(url: URL, body: BackfillBody | null): FootballHistoricalOddsBackfillMode {
  const value = textValue(url, body, "mode");
  return value === "opening" || value === "closing" || value === "both" ? value : "both";
}

function statusFor(result: FootballHistoricalOddsBackfillResult): number {
  if (result.status === "planned" || result.status === "dry-run" || result.status === "stored" || result.status === "no-matches") return 200;
  if (result.status === "partial") return 207;
  if (result.status === "not-configured") return 503;
  if (result.status === "invalid-request") return 400;
  return 502;
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Football historical odds backfill requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as BackfillBody | null;
  const result = await runFootballHistoricalOddsBackfill({
    request: {
      execute: booleanValue(url, body, "execute", false) || booleanValue(url, body, "run", false),
      dryRun: booleanValue(url, body, "dryRun", true),
      fixtureProvider: textValue(url, body, "fixtureProvider"),
      season: textValue(url, body, "season"),
      leagueExternalId: textValue(url, body, "leagueExternalId"),
      sportKey: textValue(url, body, "sportKey"),
      regions: textValue(url, body, "regions"),
      bookmakers: textValue(url, body, "bookmakers"),
      mode: modeValue(url, body),
      fixtureLimit: integerValue(url, body, "fixtureLimit", 1, 500),
      batchLimit: integerValue(url, body, "batchLimit", 1, 1000),
      eventLimit: integerValue(url, body, "eventLimit", 1, 200),
      maxJobs: integerValue(url, body, "maxJobs", 1, 100),
      offset: integerValue(url, body, "offset", 0, 100_000),
      openingLeadHours: integerValue(url, body, "openingLeadHours", 1, 168),
      closingLeadMinutes: integerValue(url, body, "closingLeadMinutes", 5, 90),
      closingWindowMinutes: integerValue(url, body, "closingWindowMinutes", 5, 360),
      stopOnError: booleanValue(url, body, "stopOnError", false)
    }
  });

  return apiSuccess(result, { status: statusFor(result) });
}
