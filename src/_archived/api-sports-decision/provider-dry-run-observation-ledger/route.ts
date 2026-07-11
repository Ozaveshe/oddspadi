import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { observeDecisionEplOddsDryRunReceipt } from "@/lib/sports/prediction/decisionEplOddsDryRunReceipt";
import { observeDecisionEplProviderDryRunReceipt } from "@/lib/sports/prediction/decisionEplProviderDryRunReceipt";
import { buildDecisionProviderDryRunObservationLedger } from "@/lib/sports/prediction/decisionProviderDryRunObservationLedger";

export const dynamic = "force-dynamic";

function isEnabled(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  if (query.sport !== "football") return apiError("Provider dry-run observation ledger is currently available for football only.");

  const url = new URL(request.url);
  const runRequested = isEnabled(url.searchParams.get("run"));
  const adminAuthorized = isDecisionAdminAuthorized(request);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport,
    baseUrl: url.origin,
    env: process.env
  });

  const [eplProviderDryRunReceipt, eplOddsDryRunReceipt] = await Promise.all([
    observeDecisionEplProviderDryRunReceipt({
      intake: context.eplFixtureIntake,
      runRequested,
      adminAuthorized,
      env: process.env,
      origin: url.origin
    }),
    observeDecisionEplOddsDryRunReceipt({
      oddsMap: context.eplOddsMarketMap,
      runRequested,
      adminAuthorized,
      env: process.env,
      origin: url.origin
    })
  ]);

  return apiSuccess(
    buildDecisionProviderDryRunObservationLedger({
      eplProviderDryRunReceipt,
      eplOddsDryRunReceipt,
      runRequested,
      adminAuthorized
    })
  );
}
