import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { getCalibrationSnapshot, runAndStoreCalibration } from "@/lib/sports/prediction/decisionCalibration";
import { isSupportedSport } from "@/lib/sports/service";
import { isTrainingAdminAuthorized } from "@/lib/sports/training/adminAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function parseSport(request: Request) {
  const sport = new URL(request.url).searchParams.get("sport") ?? "football";
  return isSupportedSport(sport) ? sport : null;
}

export const GET = withApiHandler(async (request: Request) => {
  const sport = parseSport(request);
  if (!sport) return apiError("Invalid sport.");
  return apiSuccess(await getCalibrationSnapshot(sport));
});

export const POST = withApiHandler(async (request: Request) => {
  if (!isTrainingAdminAuthorized(request)) return apiError("Calibration runs require a valid x-oddspadi-admin-token.", 401);
  const sport = parseSport(request);
  if (!sport) return apiError("Invalid sport.");
  const result = await runAndStoreCalibration(sport);
  const status = result.status === "stored" ? 200 : result.status === "not-configured" ? 503 : 500;
  return apiSuccess(result, { status });
});
