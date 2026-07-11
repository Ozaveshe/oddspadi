import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { observeDecisionOddsSnapshotWriteReceipt } from "@/lib/sports/prediction/decisionOddsSnapshotWriteReceipt";

export const dynamic = "force-dynamic";

function isEnabled(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: "football",
    baseUrl: url.origin,
    env: process.env
  });

  return apiSuccess(
    await observeDecisionOddsSnapshotWriteReceipt({
      oddsMap: context.eplOddsMarketMap,
      storageReadiness: context.oddsSnapshotStorageReadiness,
      runRequested: isEnabled(url.searchParams.get("run")),
      adminAuthorized: isDecisionAdminAuthorized(request),
      env: process.env,
      origin: url.origin
    })
  );
}
