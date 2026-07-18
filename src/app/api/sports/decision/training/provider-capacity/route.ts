import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isTrainingAdminAuthorized } from "@/lib/sports/training/adminAuth";
import { buildProviderCapacityProbe } from "@/lib/sports/training/providerCapacityProbe";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = withApiHandler(async () =>
  apiSuccess(await buildProviderCapacityProbe(), { headers: { "Cache-Control": "no-store" } })
);

export const POST = withApiHandler(async (request: Request) => {
  const runRequested = new URL(request.url).searchParams.get("run") === "1";
  if (!runRequested) return apiError("Provider capacity proof requires POST with run=1.", 400);
  if (!isTrainingAdminAuthorized(request)) {
    return apiError("Provider capacity proof requires a valid x-oddspadi-admin-token.", 401);
  }
  return apiSuccess(await buildProviderCapacityProbe({ runRequested: true }), {
    headers: { "Cache-Control": "no-store" }
  });
});
