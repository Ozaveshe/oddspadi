import { buildDecisionProviderLearningBridge, type DecisionProviderLearningBridge } from "@/lib/sports/prediction/decisionProviderLearningBridge";
import { buildApiFootballEntitlementProbe } from "@/lib/sports/training/apiFootballEntitlementProbe";
import { buildMultiSportCorpusPlan } from "@/lib/sports/training/multiSportCorpusPlan";
import { buildProviderCorpusDryRunQueue } from "@/lib/sports/training/providerCorpusDryRunQueue";
import { syncHistoricalFootballProvider, type ProviderSyncRequest, type ProviderSyncResult } from "@/lib/sports/training/providerSync";

type EnvMap = Record<string, string | undefined>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type SyncImpl = (input: { request: ProviderSyncRequest; env?: EnvMap; fetchImpl?: FetchLike }) => Promise<ProviderSyncResult>;

export async function runDecisionProviderLearningBridge({
  date,
  env = process.env,
  runRequested = false,
  adminAuthorized = false,
  origin = "http://127.0.0.1:3025",
  syncImpl = syncHistoricalFootballProvider
}: {
  date: string;
  env?: EnvMap;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  origin?: string;
  syncImpl?: SyncImpl;
}): Promise<DecisionProviderLearningBridge> {
  const entitlementProbe = await buildApiFootballEntitlementProbe({
    env,
    runRequested,
    adminAuthorized,
    origin,
    syncImpl
  });
  const season = entitlementProbe.providerCorpusDryRun.season;
  const jobId = entitlementProbe.providerCorpusDryRun.jobId;
  const providerQueue =
    runRequested && adminAuthorized && season && jobId
      ? await buildProviderCorpusDryRunQueue({
          corpusPlan: buildMultiSportCorpusPlan({
            env,
            baseUrl: origin,
            seasonFrom: Number(season),
            seasonTo: Number(season),
            maxJobsPerLeague: 1,
            sports: ["football"]
          }),
          env,
          runRequested,
          adminAuthorized,
          selectedJobId: jobId,
          origin,
          syncImpl
        })
      : null;

  return buildDecisionProviderLearningBridge({
    date,
    sport: "football",
    entitlementProbe,
    providerQueue
  });
}
