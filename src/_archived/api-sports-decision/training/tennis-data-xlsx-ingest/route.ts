import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildTennisDataXlsxIngestion } from "@/lib/sports/training/tennisDataXlsxIngestion";

export const dynamic = "force-dynamic";

function enabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function parsePositiveInteger(value: string | null, max: number): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : undefined;
}

function statusCodeFor(status: Awaited<ReturnType<typeof buildTennisDataXlsxIngestion>>["status"]): number {
  if (status === "stored" || status === "dry-run") return 200;
  if (status === "partial") return 207;
  if (status === "invalid-request") return 400;
  return 502;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dryRun = !enabled(url.searchParams.get("write")) && url.searchParams.get("dryRun") !== "0";
  if (!dryRun && !isDecisionAdminAuthorized(request)) {
    return apiError("Tennis-Data XLSX ingestion writes require ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const result = await buildTennisDataXlsxIngestion({
    yearFrom: parsePositiveInteger(url.searchParams.get("yearFrom"), 2026),
    yearTo: parsePositiveInteger(url.searchParams.get("yearTo"), 2026),
    maxYears: parsePositiveInteger(url.searchParams.get("maxYears"), 10),
    offset: parsePositiveInteger(url.searchParams.get("offset"), 100000) ?? 0,
    limit: parsePositiveInteger(url.searchParams.get("limit"), 10000),
    dryRun
  });

  return apiSuccess(result, { status: statusCodeFor(result.status) });
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Tennis-Data XLSX ingestion requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  return GET(request);
}
