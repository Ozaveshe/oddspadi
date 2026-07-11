import { apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { buildDecisionEplProviderDryRunInterpreter } from "@/lib/sports/prediction/decisionEplProviderDryRunInterpreter";
import { observeDecisionEplProviderDryRunReceipt } from "@/lib/sports/prediction/decisionEplProviderDryRunReceipt";
import { buildDecisionEplProviderFixtureMap } from "@/lib/sports/prediction/decisionEplProviderFixtureMap";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";

export const dynamic = "force-dynamic";

function isEnabled(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const runRequested = isEnabled(url.searchParams.get("run"));
  const context = await buildDecisionLaunchContext({
    date,
    sport: "football",
    baseUrl: url.origin,
    env: process.env
  });

  if (!runRequested) return apiSuccess(context.eplProviderFixtureMap);

  const receipt = await observeDecisionEplProviderDryRunReceipt({
    intake: context.eplFixtureIntake,
    runRequested,
    adminAuthorized: isDecisionAdminAuthorized(request),
    env: process.env,
    origin: url.origin
  });
  const interpreter = buildDecisionEplProviderDryRunInterpreter({ receipt });
  return apiSuccess(
    buildDecisionEplProviderFixtureMap({
      intake: context.eplFixtureIntake,
      receipt,
      interpreter,
      predictionRows: context.rankedRows,
      env: process.env
    })
  );
}
