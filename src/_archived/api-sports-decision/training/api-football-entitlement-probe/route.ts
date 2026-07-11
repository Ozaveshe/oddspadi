import { apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildApiFootballEntitlementProbe } from "@/lib/sports/training/apiFootballEntitlementProbe";

export const dynamic = "force-dynamic";

function enabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runRequested = enabled(url.searchParams.get("run"));
  const probe = await buildApiFootballEntitlementProbe({
    env: process.env,
    runRequested,
    adminAuthorized: isDecisionAdminAuthorized(request),
    origin: url.origin
  });

  return apiSuccess(probe, { status: runRequested && !probe.adminAuthorized ? 401 : probe.status === "provider-error" ? 502 : 200 });
}
