import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { getCalibrationSnapshot, runAndStoreCalibration } from "@/lib/sports/prediction/decisionCalibration";
import { isSupportedSport } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

function parseSport(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get("sport") ?? "football";
  return isSupportedSport(sport) ? sport : null;
}

export async function GET(request: Request) {
  const sport = parseSport(request);
  if (!sport) return apiError("Invalid sport.");

  return apiSuccess(await getCalibrationSnapshot(sport));
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Calibration runs require ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const sport = parseSport(request);
  if (!sport) return apiError("Invalid sport.");

  const result = await runAndStoreCalibration(sport);
  const status = result.status === "stored" ? 200 : result.status === "not-configured" ? 503 : 500;
  return apiSuccess(result, { status });
}
