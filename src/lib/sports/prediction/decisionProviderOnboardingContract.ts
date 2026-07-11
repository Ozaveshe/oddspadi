import type { DecisionDataAcquisitionContract } from "@/lib/sports/prediction/decisionDataAcquisitionContract";
import type { DecisionProviderKeyPlan, DecisionProviderKeyPlanLane } from "@/lib/sports/prediction/decisionProviderKeyPlan";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { FirstCorpusImportQueue } from "@/lib/sports/training/firstCorpusImportQueue";

export type DecisionProviderOnboardingStatus = "waiting-critical-keys" | "partial" | "ready-provider-dry-run" | "blocked";

export type DecisionProviderOnboardingProvider = {
  id: DecisionProviderKeyPlanLane["id"];
  label: string;
  status: DecisionProviderKeyPlanLane["status"];
  priority: number;
  critical: boolean;
  recommendedEnvName: string;
  acceptedEnvNames: string[];
  missingEnvNames: string[];
  source: {
    provider: string;
    getKeyUrl: string;
    docsUrl: string;
    accountAction: string;
  };
  unlocksFeeds: string[];
  unlocksModelFeatures: string[];
  firstMilestone: string;
  riskIfMissing: string;
  localSaveTarget: ".env.local";
  netlifyEnvNames: string[];
  firstProof: {
    label: string;
    url: string;
    command: string;
    expectedEvidence: string;
    canRunNow: boolean;
  };
  setupRecipe: {
    order: number;
    localEnvLine: string;
    localTarget: ".env.local";
    netlifyEnvNames: string[];
    getKeyUrl: string;
    docsUrl: string;
    verificationCommand: string;
    secretHandling: string;
    afterSave: string[];
  };
};

export type DecisionProviderOnboardingContract = {
  mode: "decision-provider-onboarding-contract";
  generatedAt: string;
  status: DecisionProviderOnboardingStatus;
  onboardingHash: string;
  summary: string;
  progress: {
    providers: number;
    configured: number;
    criticalProviders: number;
    configuredCriticalProviders: number;
    missingCriticalKeys: number;
    unlockedFeeds: number;
    totalFeeds: number;
  };
  footballMvpMinimum: {
    status: "waiting" | "partial" | "ready";
    requiredProviders: Array<{
      id: "football-core" | "odds-markets";
      label: string;
      provider: string;
      configured: boolean;
      recommendedEnvName: string;
      acceptedEnvNames: string[];
      localEnvLine: string;
      netlifyEnvNames: string[];
      getKeyUrl: string;
      docsUrl: string;
      firstProofUrl: string;
    }>;
    localEnvLines: string[];
    netlifyEnvNames: string[];
    nextMissingEnvName: string | null;
    firstProofUrl: string;
    afterSave: string[];
  };
  providers: DecisionProviderOnboardingProvider[];
  nextProvider: DecisionProviderOnboardingProvider | null;
  nextAction: {
    label: string;
    detail: string;
    proofUrl: string;
  };
  controls: {
    canInspectReadOnly: true;
    canShowProviderUrls: true;
    canWriteEnvFiles: false;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  blockers: string[];
  proofUrls: string[];
  locks: string[];
};

const CRITICAL_LANE_IDS = new Set<DecisionProviderKeyPlanLane["id"]>(["football-core", "odds-markets", "basketball-core", "tennis-core"]);

const PROVIDER_SOURCES: Record<
  DecisionProviderKeyPlanLane["id"],
  {
    provider: string;
    getKeyUrl: string;
    docsUrl: string;
    accountAction: string;
  }
> = {
  "football-core": {
    provider: "API-Sports / API-Football",
    getKeyUrl: "https://dashboard.api-football.com/",
    docsUrl: "https://www.api-football.com/documentation-v3",
    accountAction: "Create an API-Football/API-Sports account, open the API-Football dashboard, copy the football key, then save it as API_FOOTBALL_KEY or APISPORTS_KEY."
  },
  "odds-markets": {
    provider: "The Odds API",
    getKeyUrl: "https://the-odds-api.com/",
    docsUrl: "https://the-odds-api.com/liveapi/guides/v4/",
    accountAction: "Create a The Odds API account, get the API key, then save it as THE_ODDS_API_KEY."
  },
  "basketball-core": {
    provider: "API-Sports / API-Basketball",
    getKeyUrl: "https://dashboard.api-sports.io/",
    docsUrl: "https://www.api-basketball.com/documentation",
    accountAction: "Enable API-Basketball in API-Sports, then save the key as API_BASKETBALL_KEY or APISPORTS_KEY."
  },
  "tennis-core": {
    provider: "API-Sports / API-Tennis",
    getKeyUrl: "https://dashboard.api-sports.io/",
    docsUrl: "https://www.api-tennis.com/documentation",
    accountAction: "Enable API-Tennis in API-Sports, then save the key as API_TENNIS_KEY."
  },
  "news-context": {
    provider: "News API or licensed sports-news feed",
    getKeyUrl: "https://newsapi.org/",
    docsUrl: "https://newsapi.org/docs",
    accountAction: "Create a news provider key only after core sports and odds feeds are working, then save it as NEWS_API_KEY."
  },
  "weather-context": {
    provider: "OpenWeather or weather API",
    getKeyUrl: "https://openweathermap.org/api",
    docsUrl: "https://openweathermap.org/current",
    accountAction: "Create a weather provider key for outdoor football context, then save it as OPENWEATHER_API_KEY or WEATHER_API_KEY."
  }
};

type DecisionProviderOnboardingProviderBase = Omit<DecisionProviderOnboardingProvider, "setupRecipe">;

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function statusFor({
  providerKeyPlan,
  firstCorpusImportQueue
}: {
  providerKeyPlan: DecisionProviderKeyPlan;
  firstCorpusImportQueue: FirstCorpusImportQueue;
}): DecisionProviderOnboardingStatus {
  if (firstCorpusImportQueue.status === "failed") return "blocked";
  if (firstCorpusImportQueue.controls.canRunProviderDryRun && providerKeyPlan.status === "ready") return "ready-provider-dry-run";
  if (providerKeyPlan.status === "partial") return "partial";
  return "waiting-critical-keys";
}

function summaryFor(status: DecisionProviderOnboardingStatus): string {
  if (status === "blocked") return "Provider onboarding has a failing dependency and should be inspected before any provider run.";
  if (status === "ready-provider-dry-run") return "Critical provider keys are configured; the next safe step is a supervised provider dry-run.";
  if (status === "partial") return "Some provider keys are configured; continue with the next missing critical provider before corpus import.";
  return "Provider onboarding is waiting for critical sports and odds keys before real data can enter the engine.";
}

function firstProofFor({
  lane,
  feeds,
  firstCorpusImportQueue
}: {
  lane: DecisionProviderKeyPlanLane;
  feeds: DecisionDataAcquisitionContract["feeds"];
  firstCorpusImportQueue: FirstCorpusImportQueue;
}): DecisionProviderOnboardingProviderBase["firstProof"] {
  const feed = feeds.find((item) => item.providerLanes.includes(lane.id));
  const targetSport =
    lane.id === "football-core" ? "football" : lane.id === "basketball-core" ? "basketball" : lane.id === "tennis-core" ? "tennis" : null;
  const queueStep =
    lane.id === "odds-markets"
      ? firstCorpusImportQueue.steps.find((step) => step.kind === "provider-odds-dry-run")
      : firstCorpusImportQueue.steps.find((step) => step.kind === "provider-fixture-dry-run" && (targetSport ? step.sport === targetSport : step.sport === "all"));
  const url = queueStep?.verifyUrl ?? lane.proofUrl ?? feed?.nextProofUrl;
  return {
    label: queueStep?.label ?? lane.label ?? feed?.label,
    url,
    command: queueStep?.command ?? decisionCurlCommand(url),
    expectedEvidence:
      queueStep?.expectedEvidence ??
      `Read-only proof that ${lane.label} can unlock ${feed?.label ?? lane.unlocks[0] ?? "provider evidence"} without writing rows.`,
    canRunNow: lane.status === "configured" && Boolean(queueStep?.canRunNow ?? firstCorpusImportQueue.controls.canRunProviderDryRun)
  };
}

function footballMvpMinimumFor(providers: DecisionProviderOnboardingProvider[]): DecisionProviderOnboardingContract["footballMvpMinimum"] {
  const requiredProviders = providers
    .filter((provider): provider is DecisionProviderOnboardingProvider & { id: "football-core" | "odds-markets" } =>
      provider.id === "football-core" || provider.id === "odds-markets"
    )
    .map((provider) => ({
      id: provider.id,
      label: provider.label,
      provider: provider.source.provider,
      configured: provider.status === "configured",
      recommendedEnvName: provider.recommendedEnvName,
      acceptedEnvNames: provider.acceptedEnvNames,
      localEnvLine: provider.setupRecipe.localEnvLine,
      netlifyEnvNames: provider.setupRecipe.netlifyEnvNames,
      getKeyUrl: provider.setupRecipe.getKeyUrl,
      docsUrl: provider.setupRecipe.docsUrl,
      firstProofUrl: provider.firstProof.url
    }));
  const configured = requiredProviders.filter((provider) => provider.configured).length;
  const nextMissing = requiredProviders.find((provider) => !provider.configured) ?? null;

  return {
    status: configured === requiredProviders.length ? "ready" : configured > 0 ? "partial" : "waiting",
    requiredProviders,
    localEnvLines: requiredProviders.map((provider) => provider.localEnvLine),
    netlifyEnvNames: unique(requiredProviders.flatMap((provider) => provider.netlifyEnvNames), 12),
    nextMissingEnvName: nextMissing?.recommendedEnvName ?? null,
    firstProofUrl:
      requiredProviders.find((provider) => provider.id === "football-core")?.firstProofUrl ??
      requiredProviders[0]?.firstProofUrl ??
      "/api/sports/decision/first-provider-proof-run",
    afterSave: [
      "Restart localhost so Next.js reloads process.env.",
      "Open the provider key activation receipt and confirm the env names are present.",
      "Run only dry-run/admin-gated provider proof before any storage import."
    ]
  };
}

export function buildDecisionProviderOnboardingContract({
  providerKeyPlan,
  dataAcquisitionContract,
  firstCorpusImportQueue,
  now = new Date()
}: {
  providerKeyPlan: DecisionProviderKeyPlan;
  dataAcquisitionContract: DecisionDataAcquisitionContract;
  firstCorpusImportQueue: FirstCorpusImportQueue;
  now?: Date;
}): DecisionProviderOnboardingContract {
  const providers = providerKeyPlan.lanes.map((lane): DecisionProviderOnboardingProviderBase => {
    const unlockFeeds = dataAcquisitionContract.feeds.filter((feed) => feed.providerLanes.includes(lane.id));
    const source = PROVIDER_SOURCES[lane.id];
    return {
      id: lane.id,
      label: lane.label,
      status: lane.status,
      priority: lane.priority,
      critical: CRITICAL_LANE_IDS.has(lane.id),
      recommendedEnvName: lane.keys[0] ?? "",
      acceptedEnvNames: lane.keys,
      missingEnvNames: lane.missing,
      source,
      unlocksFeeds: unlockFeeds.map((feed) => feed.label),
      unlocksModelFeatures: unique(unlockFeeds.flatMap((feed) => feed.modelFeatures), 40),
      firstMilestone: lane.firstMilestone,
      riskIfMissing: lane.riskIfMissing,
      localSaveTarget: ".env.local",
      netlifyEnvNames: lane.keys,
      firstProof: firstProofFor({ lane, feeds: dataAcquisitionContract.feeds, firstCorpusImportQueue })
    };
  });
  const providersWithSetup = providers.map((provider): DecisionProviderOnboardingProvider => ({
    ...provider,
    setupRecipe: {
      order: provider.priority,
      localEnvLine: `${provider.recommendedEnvName}=paste_${provider.recommendedEnvName.toLowerCase()}_here`,
      localTarget: provider.localSaveTarget,
      netlifyEnvNames: provider.netlifyEnvNames,
      getKeyUrl: provider.source.getKeyUrl,
      docsUrl: provider.source.docsUrl,
      verificationCommand: provider.firstProof.command,
      secretHandling:
        "Keep the real value only in .env.local or Netlify environment variables; this API only returns placeholder names and never echoes secrets.",
      afterSave: [
        "Restart the local Next.js server so process.env reloads.",
        `Open ${provider.firstProof.url} to verify the provider gate.`,
        "Keep dryRun=1 until the first provider receipt is reviewed."
      ]
    }
  }));
  const status = statusFor({ providerKeyPlan, firstCorpusImportQueue });
  const footballMvpMinimum = footballMvpMinimumFor(providersWithSetup);
  const nextProvider =
    providersWithSetup.find((provider) => provider.critical && provider.status === "missing") ??
    providersWithSetup.find((provider) => provider.status === "missing") ??
    providersWithSetup.find((provider) => provider.firstProof.canRunNow) ??
    null;
  const configuredCriticalProviders = providersWithSetup.filter((provider) => provider.critical && provider.status === "configured").length;
  const configured = providersWithSetup.filter((provider) => provider.status === "configured").length;
  const blockers = unique([
    ...providersWithSetup.filter((provider) => provider.critical && provider.status === "missing").flatMap((provider) => provider.missingEnvNames),
    firstCorpusImportQueue.status === "waiting-supabase" ? "Supabase read proof is missing." : null,
    firstCorpusImportQueue.nextStep?.blocker ?? null
  ]);

  return {
    mode: "decision-provider-onboarding-contract",
    generatedAt: now.toISOString(),
    status,
    onboardingHash: stableHash({
      status,
      providerPlan: [providerKeyPlan.status, providerKeyPlan.configuredCriticalLanes, providerKeyPlan.missingCriticalKeys],
      acquisition: [dataAcquisitionContract.contractHash, dataAcquisitionContract.status, dataAcquisitionContract.scope],
      queue: [firstCorpusImportQueue.queueHash, firstCorpusImportQueue.status],
      providers: providersWithSetup.map((provider) => [provider.id, provider.status, provider.firstProof.canRunNow, provider.setupRecipe.localEnvLine]),
      footballMvpMinimum: [
        footballMvpMinimum.status,
        footballMvpMinimum.nextMissingEnvName,
        footballMvpMinimum.localEnvLines,
        footballMvpMinimum.firstProofUrl
      ]
    }),
    summary: summaryFor(status),
    progress: {
      providers: providers.length,
      configured,
      criticalProviders: providerKeyPlan.totalCriticalLanes,
      configuredCriticalProviders,
      missingCriticalKeys: providerKeyPlan.missingCriticalKeys.length,
      unlockedFeeds: dataAcquisitionContract.scope.configuredFeeds,
      totalFeeds: dataAcquisitionContract.scope.feeds
    },
    footballMvpMinimum,
    providers: providersWithSetup,
    nextProvider,
    nextAction: {
      label: nextProvider
        ? nextProvider.status === "configured"
          ? `Run ${nextProvider.label} dry-run proof`
          : `Configure ${nextProvider.label}`
        : "Inspect provider onboarding",
      detail: nextProvider
        ? nextProvider.status === "configured"
          ? nextProvider.firstProof.expectedEvidence
          : nextProvider.source.accountAction
        : "Provider onboarding has no selected next provider.",
      proofUrl: nextProvider?.firstProof.url ?? "/api/sports/decision/provider-key-plan"
    },
    controls: {
      canInspectReadOnly: true,
      canShowProviderUrls: true,
      canWriteEnvFiles: false,
      canRunProviderDryRun: firstCorpusImportQueue.controls.canRunProviderDryRun,
      canWriteProviderRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    blockers,
    proofUrls: unique([
      "/api/sports/decision/provider-onboarding-contract",
      "/api/sports/decision/provider-key-plan",
      "/api/sports/decision/data-acquisition-contract",
      "/api/sports/decision/training/first-corpus-import-queue",
      ...providersWithSetup.map((provider) => provider.firstProof.url)
    ]),
    locks: [
      "Provider onboarding is read-only and never prints, writes, or validates plaintext provider keys.",
      "Save provider keys only in ignored local env files or trusted Netlify environment variables.",
      "Dry-runs require explicit run/admin gates; provider writes, training, public picks, and staking remain separately locked."
    ]
  };
}
