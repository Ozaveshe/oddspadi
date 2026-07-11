import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import {
  buildDemoHistoricalFootballFixtures,
  ingestHistoricalFootballFixtures,
  type HistoricalFootballIngestPayload
} from "@/lib/sports/training/historicalIngestion";

export const dynamic = "force-dynamic";

function parsePositiveInteger(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Historical ingestion requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  const dryRun = url.searchParams.get("dryRun") !== "0";
  let payload: HistoricalFootballIngestPayload;

  if (mode === "demo") {
    const days = parsePositiveInteger(url.searchParams.get("days"), 2, 30);
    const startDate = url.searchParams.get("startDate") ?? "2025-08-01";
    const fixtures = await buildDemoHistoricalFootballFixtures({ days, startDate });
    payload = {
      provider: "demo_seed",
      sourceKind: "demo",
      dryRun,
      fixtures
    };
  } else {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return apiError("Request body must be a JSON ingestion payload.");
    payload = {
      ...(body as HistoricalFootballIngestPayload),
      dryRun: typeof (body as HistoricalFootballIngestPayload).dryRun === "boolean" ? (body as HistoricalFootballIngestPayload).dryRun : dryRun
    };
  }

  const result = await ingestHistoricalFootballFixtures(payload);
  const status =
    result.status === "stored" || result.status === "dry-run"
      ? 200
      : result.status === "not-configured"
        ? 503
        : 400;

  return apiSuccess(result, { status });
}
