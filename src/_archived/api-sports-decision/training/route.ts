import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { getTrainingDataSnapshot, runAndStoreHistoricalBacktest } from "@/lib/sports/training/trainingRepository";
import type { Sport } from "@/lib/sports/types";

export const dynamic = "force-dynamic";

type TrainingRouteSport = Extract<Sport, "football" | "basketball" | "tennis">;

function parseSport(request: Request): TrainingRouteSport | null {
  const url = new URL(request.url);
  const sport = url.searchParams.get("sport") ?? "football";
  return sport === "football" || sport === "basketball" || sport === "tennis" ? sport : null;
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: Request) {
  const sport = parseSport(request);
  if (!sport) return apiError("Invalid sport.");

  return apiSuccess(await getTrainingDataSnapshot(sport));
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Training backtests require ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const sport = parseSport(request);
  if (!sport) return apiError("Invalid sport.");

  const url = new URL(request.url);
  const minSample = parsePositiveInteger(url.searchParams.get("minSample"), 30);
  const limit = parsePositiveInteger(url.searchParams.get("limit"), 5000);
  const includeDemo = url.searchParams.get("includeDemo") === "1";
  const result = await runAndStoreHistoricalBacktest({ sport, minSample, limit, includeDemo });
  const status = result.status === "stored" ? 200 : result.status === "no-data" ? 409 : result.status === "not-configured" ? 503 : 500;

  return apiSuccess(result, { status });
}
