import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildFootballDataCsvIngestion } from "@/lib/sports/training/footballDataCsvIngestion";

export const dynamic = "force-dynamic";

function enabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function parsePositiveInteger(value: string | null, max: number): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : undefined;
}

function statusCodeFor(status: Awaited<ReturnType<typeof buildFootballDataCsvIngestion>>["status"]): number {
  if (status === "stored" || status === "dry-run") return 200;
  if (status === "partial") return 207;
  if (status === "invalid-request") return 400;
  return 502;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dryRun = !enabled(url.searchParams.get("write")) && url.searchParams.get("dryRun") !== "0";
  if (!dryRun && !isDecisionAdminAuthorized(request)) {
    return apiError("Football-Data CSV ingestion writes require ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const result = await buildFootballDataCsvIngestion({
    seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom"), 2025),
    seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo"), 2025),
    maxSeasons: parsePositiveInteger(url.searchParams.get("maxSeasons"), 10),
    limit: parsePositiveInteger(url.searchParams.get("limit"), 5000),
    dryRun
  });

  return apiSuccess(result, { status: statusCodeFor(result.status) });
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Football-Data CSV ingestion requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  return GET(request);
}
