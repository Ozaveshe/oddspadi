import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildDecisionProviderCredentialProbe } from "@/lib/sports/prediction/decisionProviderCredentialProbe";

export const dynamic = "force-dynamic";

function shouldRun(url: URL): boolean {
  const value = url.searchParams.get("run");
  return value === "1" || value === "true" || value === "yes";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runRequested = shouldRun(url);
  const adminAuthorized = isDecisionAdminAuthorized(request);

  if (runRequested && !adminAuthorized) {
    const preview = await buildDecisionProviderCredentialProbe({
      date: query.date,
      sport: query.sport,
      env: process.env,
      runRequested,
      adminAuthorized: false
    });
    return apiSuccess(preview, { status: 401 });
  }

  const probe = await buildDecisionProviderCredentialProbe({
    date: query.date,
    sport: query.sport,
    env: process.env,
    runRequested,
    adminAuthorized
  });

  return apiSuccess(probe, { status: probe.status === "provider-error" ? 502 : 200 });
}
