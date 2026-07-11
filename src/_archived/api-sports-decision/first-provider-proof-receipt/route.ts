import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildDecisionFirstProviderProofReceipt } from "@/lib/sports/prediction/decisionFirstProviderProofReceipt";
import { buildDecisionFirstProviderProofRun } from "@/lib/sports/prediction/decisionFirstProviderProofRun";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { observeDecisionEplOddsDryRunReceipt } from "@/lib/sports/prediction/decisionEplOddsDryRunReceipt";
import { observeDecisionEplProviderDryRunReceipt } from "@/lib/sports/prediction/decisionEplProviderDryRunReceipt";

export const dynamic = "force-dynamic";

function isEnabled(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runRequested = isEnabled(url.searchParams.get("run"));
  const adminAuthorized = isDecisionAdminAuthorized(request);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport,
    baseUrl: url.origin,
    env: process.env
  });

  let eplProviderDryRunReceipt = context.eplProviderDryRunReceipt;
  let eplOddsDryRunReceipt = context.eplOddsDryRunReceipt;
  const selectedCandidateId = context.firstProviderProofRun.selectedCandidate?.id ?? null;

  if (selectedCandidateId === "football-fixtures") {
    eplProviderDryRunReceipt = await observeDecisionEplProviderDryRunReceipt({
      intake: context.eplFixtureIntake,
      runRequested,
      adminAuthorized,
      env: process.env,
      origin: url.origin
    });
  } else if (selectedCandidateId === "odds-markets") {
    eplOddsDryRunReceipt = await observeDecisionEplOddsDryRunReceipt({
      oddsMap: context.eplOddsMarketMap,
      runRequested,
      adminAuthorized,
      env: process.env,
      origin: url.origin
    });
  }

  const run = buildDecisionFirstProviderProofRun({
    keyActivationReceipt: context.providerKeyActivationReceipt,
    eplProviderDryRunReceipt,
    eplOddsDryRunReceipt,
    providerActivationQueueReceipt: context.providerActivationQueueReceipt
  });

  return apiSuccess(
    buildDecisionFirstProviderProofReceipt({
      run,
      eplProviderDryRunReceipt,
      eplOddsDryRunReceipt,
      selectedCandidateId,
      runRequested
    })
  );
}
