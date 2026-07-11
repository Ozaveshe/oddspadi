import { apiSuccess } from "@/app/api/sports/_utils";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { buildFootballProviderFixtureFeatureReadiness } from "@/lib/sports/training/footballProviderFixtureFeatureReadiness";
import { readFootballProviderFeatureIntakeGapReceipt } from "@/lib/sports/training/footballProviderFeatureIntakeGapReceipt";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "2026-08-21";
  const context = await buildDecisionLaunchContext({
    date,
    sport: "football",
    baseUrl: url.origin,
    env: process.env
  });
  const featureGap = await readFootballProviderFeatureIntakeGapReceipt({
    env: process.env,
    origin: url.origin,
    targetDate: date
  });
  const receipt = buildFootballProviderFixtureFeatureReadiness({
    fixtureMap: context.eplProviderFixtureMap,
    featureGap
  });

  return apiSuccess(receipt, { status: receipt.status === "failed" ? 500 : 200 });
}
