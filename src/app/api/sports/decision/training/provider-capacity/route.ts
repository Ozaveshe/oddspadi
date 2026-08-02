import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isTrainingAdminAuthorized, requireTrainingAdmin, trainingUnauthorized } from "@/lib/sports/training/adminAuth";
import { buildProviderCapacityProbe } from "@/lib/sports/training/providerCapacityProbe";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Operator-only. The anonymous response used to name every provider and its
 * configured env var (`API_FOOTBALL_KEY`, `API_BASKETBALL_KEY`), which maps
 * both the commercial suppliers and the secret names to anyone who asked.
 */
export const GET = withApiHandler(async (request: Request) => {
  const denied = requireTrainingAdmin(request);
  if (denied) return denied;
  return apiSuccess(await buildProviderCapacityProbe(), { headers: { "Cache-Control": "no-store" } });
});

export const POST = withApiHandler(async (request: Request) => {
  // Authorise before validating. Answering an anonymous caller with a 400
  // about a `run=1` parameter confirms the route and teaches its interface.
  if (!isTrainingAdminAuthorized(request)) return trainingUnauthorized();
  const runRequested = new URL(request.url).searchParams.get("run") === "1";
  if (!runRequested) return apiError("Provider capacity proof requires POST with run=1.", 400);
  return apiSuccess(await buildProviderCapacityProbe({ runRequested: true }), {
    headers: { "Cache-Control": "no-store" }
  });
});
