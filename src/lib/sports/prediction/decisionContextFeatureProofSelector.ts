import type { DecisionHistoricalDiagnosisLadderReceipt } from "@/lib/sports/prediction/decisionHistoricalDiagnosisLadderReceipt";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { FootballProviderFeatureIntakeGapReceipt } from "@/lib/sports/training/footballProviderFeatureIntakeGapReceipt";
import type { FootballProviderFixtureFeatureReadiness } from "@/lib/sports/training/footballProviderFixtureFeatureReadiness";

export type DecisionContextFeatureProofSelectorStatus =
  | "waiting-ladder-proof"
  | "manual-context-selection"
  | "waiting-provider-keys"
  | "waiting-storage-evidence"
  | "ready-context-preview"
  | "blocked";

export type DecisionContextFeatureProofRequirementId =
  | "availability-lineups"
  | "news-context"
  | "weather-context"
  | "xg-team-strength"
  | "feature-materialization"
  | "feature-storage";

export type DecisionContextFeatureProofRequirement = {
  id: DecisionContextFeatureProofRequirementId;
  label: string;
  provider: string;
  state: "pass" | "watch" | "manual" | "block";
  priority: number;
  requiredKeys: string[];
  storageTargets: string[];
  modelImpact: string;
  evidence: string[];
  proofUrl: string;
  safeToInspect: boolean;
  nextAction: string;
};

export type DecisionContextFeatureProofSelector = {
  generatedAt: string;
  date: string;
  sport: DecisionHistoricalDiagnosisLadderReceipt["sport"];
  mode: "decision-context-feature-proof-selector";
  status: DecisionContextFeatureProofSelectorStatus;
  selectorHash: string;
  summary: string;
  input: {
    ladderReceiptHash: string;
    ladderReceiptStatus: DecisionHistoricalDiagnosisLadderReceipt["status"];
    ladderNextStep: string | null;
    featureGapHash: string;
    featureGapStatus: FootballProviderFeatureIntakeGapReceipt["status"];
    fixtureFeatureReadinessHash: string;
    fixtureFeatureReadinessStatus: FootballProviderFixtureFeatureReadiness["status"];
  };
  selectedRequirement: DecisionContextFeatureProofRequirement | null;
  requirements: DecisionContextFeatureProofRequirement[];
  nextTurn: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    reason: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunSelectedReadOnlyProof: boolean;
    canRequestManualProviderProof: boolean;
    canWriteFixtures: false;
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

function compact(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function requirement(input: DecisionContextFeatureProofRequirement): DecisionContextFeatureProofRequirement {
  return {
    ...input,
    evidence: unique(input.evidence, 8),
    nextAction: compact(input.nextAction)
  };
}

function statusFor({
  ladderReceipt,
  featureGap,
  requirements
}: {
  ladderReceipt: DecisionHistoricalDiagnosisLadderReceipt;
  featureGap: FootballProviderFeatureIntakeGapReceipt;
  requirements: DecisionContextFeatureProofRequirement[];
}): DecisionContextFeatureProofSelectorStatus {
  if (ladderReceipt.status === "blocked" || ladderReceipt.status === "failed" || featureGap.status === "failed") return "blocked";
  if (ladderReceipt.advanced.nextStep.id !== "context-features") return "waiting-ladder-proof";
  if (!featureGap.providerKeys.apiFootballConfigured || !featureGap.providerKeys.oddsConfigured) return "waiting-provider-keys";
  if (requirements.some((item) => item.state === "block")) return "waiting-storage-evidence";
  if (requirements.every((item) => item.state === "pass")) return "ready-context-preview";
  return "manual-context-selection";
}

function summaryFor(status: DecisionContextFeatureProofSelectorStatus, selected: DecisionContextFeatureProofRequirement | null): string {
  if (status === "ready-context-preview") return "Context feature proof selector has enough read-only evidence for provider context preview; training and picks remain locked.";
  if (status === "manual-context-selection" && selected) {
    return `Context feature proof selector is waiting on manual proof for ${selected.label}; no model authority is unlocked.`;
  }
  if (status === "waiting-provider-keys" && selected) return `Context feature proof selector needs provider key proof for ${selected.label}.`;
  if (status === "waiting-storage-evidence" && selected) return `Context feature proof selector needs stored evidence for ${selected.label}.`;
  if (status === "blocked") return "Context feature proof selector is blocked by an unsafe or failed prerequisite receipt.";
  return "Context feature proof selector is waiting for the historical diagnosis ladder to reach context features.";
}

function nextTurnFor(selected: DecisionContextFeatureProofRequirement | null): DecisionContextFeatureProofSelector["nextTurn"] {
  if (!selected) {
    return {
      label: "Wait for context feature selection",
      command: null,
      verifyUrl: "/api/sports/decision/context-feature-proof-selector",
      safeToRun: false,
      reason: "No context feature proof is selected yet."
    };
  }
  return {
    label: `Inspect ${selected.label}`,
    command: selected.safeToInspect ? decisionCurlCommand(selected.proofUrl) : null,
    verifyUrl: selected.proofUrl,
    safeToRun: selected.safeToInspect,
    reason: selected.nextAction
  };
}

export function buildDecisionContextFeatureProofSelector({
  ladderReceipt,
  featureGap,
  fixtureFeatureReadiness,
  now = new Date()
}: {
  ladderReceipt: DecisionHistoricalDiagnosisLadderReceipt;
  featureGap: FootballProviderFeatureIntakeGapReceipt;
  fixtureFeatureReadiness: FootballProviderFixtureFeatureReadiness;
  now?: Date;
}): DecisionContextFeatureProofSelector {
  const hasCoreKeys = featureGap.providerKeys.apiFootballConfigured && featureGap.providerKeys.oddsConfigured;
  const featureStorageReady = featureGap.storage.providerRetestFeatureSnapshots > 0;
  const rawPayloadReady = featureGap.storage.rawProviderPayloads > 0;
  const oddsReady = featureGap.storage.matchWinnerOddsSnapshots > 0;
  const liveWatchlistReady = featureGap.lanes.eplLiveWatchlist.status === "ready";

  const requirements = [
    requirement({
      id: "availability-lineups",
      label: "Lineups, injuries, and suspensions",
      provider: "API-Football / API-SPORTS",
      state: featureGap.providerKeys.apiFootballConfigured ? (fixtureFeatureReadiness.controls.canRunProviderDryRun ? "manual" : "watch") : "block",
      priority: 1,
      requiredKeys: ["API_FOOTBALL_KEY or APISPORTS_KEY or SPORTS_API_KEY"],
      storageTargets: ["op_player_availability_snapshots", "op_lineup_snapshots", "op_raw_provider_payloads"],
      modelImpact: "Bounds football expected-goals and abstention risk when starting XI or key absences change.",
      evidence: [
        `apiFootballConfigured:${featureGap.providerKeys.apiFootballConfigured}`,
        `fixtureMap:${fixtureFeatureReadiness.fixtureMap.status}`,
        `rawProviderPayloads:${featureGap.storage.rawProviderPayloads}`,
        ...fixtureFeatureReadiness.featureIntake.missingLiveEvidence
      ],
      proofUrl: "/api/sports/decision/training/football-provider-fixture-feature-readiness?date=2026-08-21",
      safeToInspect: true,
      nextAction: fixtureFeatureReadiness.nextAction.expectedEvidence
    }),
    requirement({
      id: "news-context",
      label: "Team news and injury narrative",
      provider: "News API or licensed sports-news feed",
      state: featureGap.providerKeys.newsConfigured ? "manual" : "watch",
      priority: 2,
      requiredKeys: ["NEWS_API_KEY"],
      storageTargets: ["op_news_signals", "op_raw_provider_payloads"],
      modelImpact: "Gives the AI reviewer source-stamped team-news risk and blocks unsupported availability claims.",
      evidence: [`newsConfigured:${featureGap.providerKeys.newsConfigured}`, `rawProviderPayloads:${featureGap.storage.rawProviderPayloads}`],
      proofUrl: "/api/sports/decision/provider-key-plan?date=2026-07-04&sport=football",
      safeToInspect: true,
      nextAction: featureGap.providerKeys.newsConfigured
        ? "Select a read-only news normalization proof with source URLs before using news as context."
        : "Configure NEWS_API_KEY or select a licensed sports-news feed before claiming team-news context."
    }),
    requirement({
      id: "weather-context",
      label: "Kickoff weather",
      provider: "OpenWeather or compatible weather API",
      state: featureGap.providerKeys.weatherConfigured ? "manual" : "watch",
      priority: 3,
      requiredKeys: ["WEATHER_API_KEY or OPENWEATHER_API_KEY"],
      storageTargets: ["op_weather_snapshots", "op_raw_provider_payloads"],
      modelImpact: "Adjusts football totals, tempo, match quality, and avoid rules for outdoor fixtures.",
      evidence: [`weatherConfigured:${featureGap.providerKeys.weatherConfigured}`, `targetDate:${featureGap.request.targetDate}`],
      proofUrl: "/api/sports/decision/provider-key-plan?date=2026-07-04&sport=football",
      safeToInspect: true,
      nextAction: featureGap.providerKeys.weatherConfigured
        ? "Select a read-only weather normalization proof for venue and kickoff-time forecasts."
        : "Configure WEATHER_API_KEY or OPENWEATHER_API_KEY before claiming weather context."
    }),
    requirement({
      id: "xg-team-strength",
      label: "xG and team-strength context",
      provider: "Provider stats / normalized feature materializer",
      state: hasCoreKeys ? (featureGap.controls.canMaterializeFeaturePreview ? "manual" : "watch") : "block",
      priority: 4,
      requiredKeys: ["API_FOOTBALL_KEY", "THE_ODDS_API_KEY"],
      storageTargets: ["op_training_feature_snapshots", "op_raw_provider_payloads"],
      modelImpact: "Lets the Poisson model blend provider xG where available instead of relying only on rating/form proxies.",
      evidence: [
        `featureMaterializerPreview:${featureGap.controls.canMaterializeFeaturePreview}`,
        `trainingFeatureSnapshots:${featureGap.storage.trainingFeatureSnapshots}`,
        `providerRetestFeatureSnapshots:${featureGap.storage.providerRetestFeatureSnapshots}`
      ],
      proofUrl: "/api/sports/decision/training/football-provider-feature-materializer?demo=1&dryRun=1",
      safeToInspect: true,
      nextAction: "Preview provider feature rows with xG/team-strength slots before any storage or training action."
    }),
    requirement({
      id: "feature-materialization",
      label: "Provider context feature preview",
      provider: "OddsPadi feature materializer",
      state: liveWatchlistReady || featureGap.controls.canMaterializeFeaturePreview ? "manual" : "block",
      priority: 5,
      requiredKeys: ["API_FOOTBALL_KEY", "THE_ODDS_API_KEY"],
      storageTargets: ["op_training_feature_snapshots"],
      modelImpact: "Combines fixture identity, odds, availability, news, weather, and model probabilities into auditable feature rows.",
      evidence: [
        `liveWatchlist:${featureGap.lanes.eplLiveWatchlist.status}`,
        `settledTraining:${featureGap.lanes.settledTraining.status}`,
        `matchWinnerOddsSnapshots:${featureGap.storage.matchWinnerOddsSnapshots}`
      ],
      proofUrl: "/api/sports/decision/training/football-provider-feature-materializer?demo=1&dryRun=1",
      safeToInspect: true,
      nextAction: "Run only a dry-run feature materializer preview until storage and admin approval are explicit."
    }),
    requirement({
      id: "feature-storage",
      label: "Stored provider feature rows",
      provider: "OddsPadi Supabase",
      state: featureStorageReady && rawPayloadReady && oddsReady ? "pass" : "block",
      priority: 6,
      requiredKeys: ["SUPABASE_SERVICE_ROLE_KEY", "ODDSPADI_ADMIN_TOKEN"],
      storageTargets: ["op_training_feature_snapshots", "op_raw_provider_payloads", "op_odds_snapshots"],
      modelImpact: "Creates the auditable training corpus needed for provider-enriched retests and promotion gates.",
      evidence: [
        `providerRetestFeatureSnapshots:${featureGap.storage.providerRetestFeatureSnapshots}`,
        `rawProviderPayloads:${featureGap.storage.rawProviderPayloads}`,
        `matchWinnerOddsSnapshots:${featureGap.storage.matchWinnerOddsSnapshots}`
      ],
      proofUrl: "/api/sports/decision/training/football-provider-feature-storage-receipt?demo=1&dryRun=1",
      safeToInspect: true,
      nextAction: "Inspect storage readiness only; writes still require admin token, service-role readiness, and run=1."
    })
  ];
  const selectedRequirement =
    requirements.find((item) => item.state === "block") ??
    requirements.find((item) => item.state === "manual") ??
    requirements.find((item) => item.state === "watch") ??
    null;
  const status = statusFor({ ladderReceipt, featureGap, requirements });
  const nextTurn = nextTurnFor(selectedRequirement);
  const selectorHash = stableHash({
    ladderReceipt: ladderReceipt.receiptHash,
    featureGap: featureGap.gapHash,
    fixtureFeatureReadiness: fixtureFeatureReadiness.readinessHash,
    status,
    requirements: requirements.map((item) => [item.id, item.state])
  });

  return {
    generatedAt: now.toISOString(),
    date: ladderReceipt.date,
    sport: ladderReceipt.sport,
    mode: "decision-context-feature-proof-selector",
    status,
    selectorHash,
    summary: summaryFor(status, selectedRequirement),
    input: {
      ladderReceiptHash: ladderReceipt.receiptHash,
      ladderReceiptStatus: ladderReceipt.status,
      ladderNextStep: ladderReceipt.advanced.nextStep.label,
      featureGapHash: featureGap.gapHash,
      featureGapStatus: featureGap.status,
      fixtureFeatureReadinessHash: fixtureFeatureReadiness.readinessHash,
      fixtureFeatureReadinessStatus: fixtureFeatureReadiness.status
    },
    selectedRequirement,
    requirements,
    nextTurn,
    controls: {
      canInspectReadOnly: true,
      canRunSelectedReadOnlyProof: nextTurn.safeToRun,
      canRequestManualProviderProof: status === "manual-context-selection" || status === "waiting-provider-keys" || status === "waiting-storage-evidence",
      canWriteFixtures: false,
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
      "/api/sports/decision/context-feature-proof-selector",
      nextTurn.verifyUrl,
      ...requirements.map((item) => item.proofUrl),
      ...ladderReceipt.proofUrls,
      ...featureGap.proofUrls,
      ...fixtureFeatureReadiness.proofUrls
    ]),
    locks: unique([
      "Context feature proof selector is read-only and cannot fetch secret data in the browser.",
      "It selects evidence requirements only; it cannot write fixtures, provider rows, feature snapshots, training rows, decisions, picks, or stakes.",
      "News, weather, injury, lineup, and xG claims require source-stamped provider proof before they can influence model trust.",
      "Training and learned weights remain locked until provider-enriched storage, retests, backtests, and promotion gates pass.",
      ...ladderReceipt.locks,
      ...featureGap.locks,
      ...fixtureFeatureReadiness.locks
    ])
  };
}
