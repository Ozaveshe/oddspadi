import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { buildFootballProviderLiveSettlementLabelReceipt } from "@/lib/sports/training/footballProviderLiveSettlementLabelReceipt";

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

function intParam(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function fixtureIdsFromUrl(url: URL): string[] {
  const multi = cleanFilter(url.searchParams.get("fixtureExternalIds") ?? url.searchParams.get("fixtures"));
  const single = cleanFilter(url.searchParams.get("fixtureExternalId") ?? url.searchParams.get("fixture"));
  return Array.from(
    new Set(
      [multi, single]
        .flatMap((value) => value?.split(",") ?? [])
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).slice(0, 50);
}

function statusCodeFor(status: string, runRequested: boolean): number {
  if (status === "failed") return 500;
  if (runRequested && status === "waiting-admin") return 401;
  if (status === "waiting-supabase") return 503;
  return 200;
}

async function buildReceipt(request: Request, runRequested: boolean, adminAuthorized: boolean) {
  const url = new URL(request.url);
  return buildFootballProviderLiveSettlementLabelReceipt({
    runRequested,
    adminAuthorized,
    limit: intParam(url.searchParams.get("limit"), 50),
    source: cleanFilter(url.searchParams.get("source")),
    fixtureExternalIds: fixtureIdsFromUrl(url),
    env: process.env,
    origin: url.origin
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (isEnabled(url.searchParams.get("run")) || isWriteMode(url.searchParams.get("dryRun"))) {
    return apiError("Settlement label writes require POST with dryRun=0, run=1, and x-oddspadi-admin-token. GET is read-only preview.", 405);
  }

  const receipt = await buildReceipt(request, false, false);
  return apiSuccess(receipt, { status: statusCodeFor(receipt.status, false) });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const runRequested = isEnabled(url.searchParams.get("run"));
  const writeMode = isWriteMode(url.searchParams.get("dryRun"));
  if (!runRequested || !writeMode) {
    return apiError("Settlement label writes require POST with dryRun=0 and run=1.", 400);
  }
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Settlement label writes require ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const receipt = await buildReceipt(request, true, true);
  return apiSuccess(receipt, { status: statusCodeFor(receipt.status, true) });
}
