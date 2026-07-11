import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import {
  buildFootballProviderLiveOpeningRoundStorageReceipt,
  epl2026OpeningRoundDates
} from "@/lib/sports/training/footballProviderLiveOpeningRoundStorageReceipt";

export const dynamic = "force-dynamic";

function isEnabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function isWriteMode(value: string | null): boolean {
  return value === "0" || value?.toLowerCase() === "false" || value?.toLowerCase() === "no";
}

function cleanFilter(value: string | null): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function datesBetween(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (start.getTime() > end.getTime()) return [];
  const dates: string[] = [];
  for (const cursor = new Date(start); cursor.getTime() <= end.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

function parseDateWindow(url: URL): string[] | { error: string } {
  const explicitDates = cleanFilter(url.searchParams.get("dates"));
  if (explicitDates) {
    const dates = Array.from(new Set(explicitDates.split(",").map((value) => value.trim()).filter(Boolean))).sort();
    if (!dates.length || dates.some((date) => !isIsoDate(date))) return { error: "dates must be a comma-separated list of YYYY-MM-DD values." };
    if (dates.length > 7) return { error: "Opening-round storage is capped at 7 dates per request." };
    return dates;
  }

  const singleDate = cleanFilter(url.searchParams.get("date"));
  if (singleDate) {
    if (!isIsoDate(singleDate)) return { error: "date must be YYYY-MM-DD." };
    return [singleDate];
  }

  const from = cleanFilter(url.searchParams.get("from"));
  const to = cleanFilter(url.searchParams.get("to"));
  if (from || to) {
    const start = from ?? to;
    const end = to ?? from;
    if (!start || !end || !isIsoDate(start) || !isIsoDate(end)) return { error: "from and to must be YYYY-MM-DD values." };
    const dates = datesBetween(start, end);
    if (!dates.length) return { error: "from must be before or equal to to." };
    if (dates.length > 7) return { error: "Opening-round storage is capped at 7 dates per request." };
    return dates;
  }

  return epl2026OpeningRoundDates();
}

function statusCodeFor(status: string, runRequested: boolean): number {
  if (status === "failed") return 500;
  if (runRequested && status === "waiting-admin") return 401;
  if (status === "waiting-supabase") return 503;
  return 200;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runRequested = isEnabled(url.searchParams.get("run"));
  const writeMode = isWriteMode(url.searchParams.get("dryRun"));
  if (runRequested && !writeMode) {
    return apiError("Opening-round storage writes require dryRun=0 with run=1 and x-oddspadi-admin-token. Use dryRun=1 without run=1 for preview.", 400);
  }
  if (writeMode && !runRequested) {
    return apiError("dryRun=0 is reserved for opening-round write attempts and requires run=1 plus x-oddspadi-admin-token.", 400);
  }

  const dates = parseDateWindow(url);
  if ("error" in dates) return apiError(dates.error, 400);

  const receipt = await buildFootballProviderLiveOpeningRoundStorageReceipt({
    dates,
    runRequested: runRequested && writeMode,
    adminAuthorized: isDecisionAdminAuthorized(request),
    filters: {
      league: cleanFilter(url.searchParams.get("league")) ?? "Premier League",
      country: cleanFilter(url.searchParams.get("country")) ?? "England",
      query: cleanFilter(url.searchParams.get("query") ?? url.searchParams.get("q"))
    },
    env: process.env,
    origin: url.origin
  });

  return apiSuccess(receipt, { status: statusCodeFor(receipt.status, runRequested) });
}
