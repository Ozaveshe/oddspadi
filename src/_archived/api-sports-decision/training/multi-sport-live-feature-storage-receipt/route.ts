import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { getPredictions, isSupportedSport } from "@/lib/sports/service";
import { buildMultiSportLiveFeatureMaterializer } from "@/lib/sports/training/multiSportLiveFeatureMaterializer";
import { observeMultiSportLiveFeatureStorageReceipt } from "@/lib/sports/training/multiSportLiveFeatureStorageReceipt";

export const dynamic = "force-dynamic";

function parseSport(value: string | null): "basketball" | "tennis" | null {
  if (!isSupportedSport(value)) return null;
  return value === "basketball" || value === "tennis" ? value : null;
}

function isEnabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(20, parsed)) : 12;
}

async function handle(request: Request) {
  const url = new URL(request.url);
  const sport = parseSport(url.searchParams.get("sport") ?? "basketball");
  if (!sport) return apiError("sport must be basketball or tennis for multi-sport live feature storage.");

  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const rows = (await getPredictions({ date, sport })).slice(0, parseLimit(url.searchParams.get("limit")));
  const provider = rows.find((row) => row.match.dataSource?.kind === "provider")?.match.dataSource?.fixtureProvider ?? rows[0]?.match.dataSource?.fixtureProvider ?? "mockSportsDataProvider";
  const materializer = buildMultiSportLiveFeatureMaterializer({
    provider,
    sport,
    rows,
    targetDate: date
  });
  const receipt = await observeMultiSportLiveFeatureStorageReceipt({
    materializer,
    runRequested: isEnabled(url.searchParams.get("run")),
    adminAuthorized: isDecisionAdminAuthorized(request),
    env: process.env,
    origin: url.origin
  });

  return apiSuccess({ ...receipt, materializerPreview: materializer }, { status: receipt.status === "failed" ? 500 : 200 });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
