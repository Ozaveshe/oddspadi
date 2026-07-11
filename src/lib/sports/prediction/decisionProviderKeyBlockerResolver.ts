import type { DecisionContextFeatureProofReceipt } from "@/lib/sports/prediction/decisionContextFeatureProofReceipt";
import type { DecisionProviderKeyPlan, DecisionProviderKeyPlanLane } from "@/lib/sports/prediction/decisionProviderKeyPlan";

export type DecisionProviderKeyBlockerResolverStatus = "waiting-provider-keys" | "partial" | "ready-to-retry-context-proof" | "not-provider-key-blocked";

export type DecisionProviderKeyBlockerResolverLane = {
  id: DecisionProviderKeyPlanLane["id"];
  label: string;
  status: DecisionProviderKeyPlanLane["status"];
  priority: number;
  relevant: boolean;
  recommendedEnvName: string;
  acceptedEnvNames: string[];
  missingEnvNames: string[];
  localTarget: ".env.local";
  netlifyEnvNames: string[];
  source: {
    provider: string;
    getKeyUrl: string;
    docsUrl: string;
  };
  proofUrl: string;
  unlocks: string[];
  riskIfMissing: string;
  nextAction: string;
};

export type DecisionProviderKeyBlockerResolver = {
  generatedAt: string;
  date: string;
  sport: DecisionContextFeatureProofReceipt["sport"];
  mode: "decision-provider-key-blocker-resolver";
  status: DecisionProviderKeyBlockerResolverStatus;
  resolverHash: string;
  summary: string;
  input: {
    contextReceiptHash: string;
    contextReceiptStatus: DecisionContextFeatureProofReceipt["status"];
    contextBlocker: DecisionContextFeatureProofReceipt["interpretation"]["blocker"];
    selectedRequirement: string | null;
    providerKeyPlanStatus: DecisionProviderKeyPlan["status"];
  };
  selectedLane: DecisionProviderKeyBlockerResolverLane | null;
  lanes: DecisionProviderKeyBlockerResolverLane[];
  nextTurn: {
    label: string;
    verifyUrl: string;
    safeToRun: boolean;
    reason: string;
  };
  controls: {
    canInspectReadOnly: true;
    canShowProviderUrls: true;
    canWriteEnvFiles: false;
    canReadSecrets: false;
    canRetryContextProof: boolean;
    canRunProviderDryRun: false;
    canWriteProviderRows: false;
    canWriteFeatureSnapshots: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
  };
  proofUrls: string[];
  locks: string[];
};

const PROVIDER_SOURCES: Record<
  DecisionProviderKeyPlanLane["id"],
  {
    provider: string;
    getKeyUrl: string;
    docsUrl: string;
  }
> = {
  "football-core": {
    provider: "API-Sports / API-Football",
    getKeyUrl: "https://dashboard.api-football.com/",
    docsUrl: "https://www.api-football.com/documentation-v3"
  },
  "odds-markets": {
    provider: "The Odds API",
    getKeyUrl: "https://the-odds-api.com/",
    docsUrl: "https://the-odds-api.com/liveapi/guides/v4/"
  },
  "basketball-core": {
    provider: "API-Sports / API-Basketball",
    getKeyUrl: "https://dashboard.api-sports.io/",
    docsUrl: "https://www.api-basketball.com/documentation"
  },
  "tennis-core": {
    provider: "API-Sports / API-Tennis",
    getKeyUrl: "https://dashboard.api-sports.io/",
    docsUrl: "https://www.api-tennis.com/documentation"
  },
  "news-context": {
    provider: "News API or licensed sports-news feed",
    getKeyUrl: "https://newsapi.org/",
    docsUrl: "https://newsapi.org/docs"
  },
  "weather-context": {
    provider: "OpenWeather or weather API",
    getKeyUrl: "https://openweathermap.org/api",
    docsUrl: "https://openweathermap.org/current"
  }
};

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: Array<string | null | undefined>, limit = 36): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function relevantLaneIds(receipt: DecisionContextFeatureProofReceipt): Set<DecisionProviderKeyPlanLane["id"]> {
  const id = receipt.selectedRequirement.id;
  if (id === "availability-lineups") return new Set(["football-core", "odds-markets"]);
  if (id === "news-context") return new Set(["news-context"]);
  if (id === "weather-context") return new Set(["weather-context"]);
  if (id === "xg-team-strength" || id === "feature-materialization" || id === "feature-storage") return new Set(["football-core", "odds-markets"]);
  return new Set(["football-core", "odds-markets"]);
}

function laneFor(lane: DecisionProviderKeyPlanLane, relevant: boolean): DecisionProviderKeyBlockerResolverLane {
  const source = PROVIDER_SOURCES[lane.id];
  return {
    id: lane.id,
    label: lane.label,
    status: lane.status,
    priority: lane.priority,
    relevant,
    recommendedEnvName: lane.keys[0] ?? "",
    acceptedEnvNames: lane.keys,
    missingEnvNames: lane.missing,
    localTarget: ".env.local",
    netlifyEnvNames: lane.keys,
    source,
    proofUrl: lane.proofUrl,
    unlocks: lane.unlocks,
    riskIfMissing: lane.riskIfMissing,
    nextAction:
      lane.status === "configured"
        ? `Retry ${lane.label} proof through ${lane.proofUrl}.`
        : `Create or copy the ${source.provider} key, save it as ${lane.keys[0] ?? "the accepted env name"} in .env.local and Netlify, then restart localhost.`
  };
}

function statusFor({
  receipt,
  lanes
}: {
  receipt: DecisionContextFeatureProofReceipt;
  lanes: DecisionProviderKeyBlockerResolverLane[];
}): DecisionProviderKeyBlockerResolverStatus {
  if (receipt.interpretation.blocker !== "provider-keys") return "not-provider-key-blocked";
  if (lanes.every((lane) => lane.status === "configured")) return "ready-to-retry-context-proof";
  if (lanes.some((lane) => lane.status === "configured")) return "partial";
  return "waiting-provider-keys";
}

function summaryFor(status: DecisionProviderKeyBlockerResolverStatus, selectedLane: DecisionProviderKeyBlockerResolverLane | null): string {
  if (status === "ready-to-retry-context-proof") return "Provider keys for the selected context blocker are configured; retry the context proof receipt.";
  if (status === "partial") return `Provider key blocker is partially resolved; next missing lane is ${selectedLane?.label ?? "not selected"}.`;
  if (status === "waiting-provider-keys") return `Provider key blocker is waiting on ${selectedLane?.label ?? "football and odds provider keys"}.`;
  return "The selected context proof is not currently blocked by provider keys.";
}

export function buildDecisionProviderKeyBlockerResolver({
  contextProofReceipt,
  providerKeyPlan,
  now = new Date()
}: {
  contextProofReceipt: DecisionContextFeatureProofReceipt;
  providerKeyPlan: DecisionProviderKeyPlan;
  now?: Date;
}): DecisionProviderKeyBlockerResolver {
  const relevantIds = relevantLaneIds(contextProofReceipt);
  const lanes = providerKeyPlan.lanes
    .filter((lane) => relevantIds.has(lane.id))
    .map((lane) => laneFor(lane, true))
    .sort((a, b) => a.priority - b.priority);
  const selectedLane = lanes.find((lane) => lane.status === "missing") ?? lanes[0] ?? null;
  const status = statusFor({ receipt: contextProofReceipt, lanes });
  const canRetryContextProof = status === "ready-to-retry-context-proof";
  const verifyUrl = canRetryContextProof
    ? "/api/sports/decision/context-feature-proof-receipt?date=2026-07-04&sport=football&run=1&targetDate=2026-08-21"
    : (selectedLane?.proofUrl ?? "/api/sports/decision/provider-key-plan");
  const resolverHash = stableHash({
    receipt: contextProofReceipt.receiptHash,
    blocker: contextProofReceipt.interpretation.blocker,
    keyPlan: [providerKeyPlan.status, providerKeyPlan.missingCriticalKeys],
    lanes: lanes.map((lane) => [lane.id, lane.status, lane.missingEnvNames])
  });

  return {
    generatedAt: now.toISOString(),
    date: contextProofReceipt.date,
    sport: contextProofReceipt.sport,
    mode: "decision-provider-key-blocker-resolver",
    status,
    resolverHash,
    summary: summaryFor(status, selectedLane),
    input: {
      contextReceiptHash: contextProofReceipt.receiptHash,
      contextReceiptStatus: contextProofReceipt.status,
      contextBlocker: contextProofReceipt.interpretation.blocker,
      selectedRequirement: contextProofReceipt.selectedRequirement.label,
      providerKeyPlanStatus: providerKeyPlan.status
    },
    selectedLane,
    lanes,
    nextTurn: {
      label: canRetryContextProof ? "Retry context feature proof receipt" : `Configure ${selectedLane?.label ?? "provider key"}`,
      verifyUrl,
      safeToRun: true,
      reason: canRetryContextProof
        ? "Provider keys are configured for this blocker, so the next safe step is to re-run the read-only context proof receipt."
        : (selectedLane?.nextAction ?? "Inspect the provider key plan.")
    },
    controls: {
      canInspectReadOnly: true,
      canShowProviderUrls: true,
      canWriteEnvFiles: false,
      canReadSecrets: false,
      canRetryContextProof,
      canRunProviderDryRun: false,
      canWriteProviderRows: false,
      canWriteFeatureSnapshots: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/provider-key-blocker-resolver",
      "/api/sports/decision/provider-key-plan",
      verifyUrl,
      ...lanes.map((lane) => lane.proofUrl),
      ...contextProofReceipt.proofUrls
    ]),
    locks: unique([
      "Provider key blocker resolver never reads, prints, writes, or validates plaintext secrets.",
      "Provider keys must be saved manually in .env.local and Netlify environment variables, then localhost must be restarted.",
      "Resolving keys can only unlock read-only proof retries; provider writes, feature writes, training, public picks, and staking remain separately locked.",
      ...contextProofReceipt.locks
    ])
  };
}
