import { apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { observeDecisionEplOddsDryRunReceipt } from "@/lib/sports/prediction/decisionEplOddsDryRunReceipt";

export const dynamic = "force-dynamic";

function isEnabled(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const context = await buildDecisionLaunchContext({
    date,
    sport: "football",
    baseUrl: url.origin,
    env: process.env
  });

  return apiSuccess(
    await observeDecisionEplOddsDryRunReceipt({
      oddsMap: context.eplOddsMarketMap,
      runRequested: isEnabled(url.searchParams.get("run")),
      adminAuthorized: isDecisionAdminAuthorized(request),
      env: process.env,
      origin: url.origin
    })
  );
}
