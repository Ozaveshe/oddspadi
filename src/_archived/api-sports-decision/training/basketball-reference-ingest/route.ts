import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildBasketballReferenceIngestion } from "@/lib/sports/training/basketballReferenceIngestion";

export const dynamic = "force-dynamic";

function enabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function parsePositiveInteger(value: string | null, max: number): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : undefined;
}

function parseNonNegativeInteger(value: string | null, max: number): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, max) : undefined;
}

function statusCodeFor(status: Awaited<ReturnType<typeof buildBasketballReferenceIngestion>>["status"]): number {
  if (status === "stored" || status === "dry-run") return 200;
  if (status === "partial") return 207;
  if (status === "invalid-request") return 400;
  return 502;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dryRun = !enabled(url.searchParams.get("write")) && url.searchParams.get("dryRun") !== "0";
  if (!dryRun && !isDecisionAdminAuthorized(request)) {
    return apiError("Basketball-Reference ingestion writes require ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const result = await buildBasketballReferenceIngestion({
    seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom"), 2026),
    seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo"), 2026),
    maxSeasons: parsePositiveInteger(url.searchParams.get("maxSeasons"), 10),
    offset: parseNonNegativeInteger(url.searchParams.get("offset"), 100000) ?? 0,
    limit: parsePositiveInteger(url.searchParams.get("limit"), 15000),
    dryRun
  });

  return apiSuccess(result, { status: statusCodeFor(result.status) });
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Basketball-Reference ingestion requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  return GET(request);
}
