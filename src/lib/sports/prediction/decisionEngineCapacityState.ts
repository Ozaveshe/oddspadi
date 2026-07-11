import type { DecisionMvpProgressReceipt } from "@/lib/sports/prediction/decisionMvpProgressReceipt";
import type { DecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import type { DecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import type { DecisionProviderKeyPlan } from "@/lib/sports/prediction/decisionProviderKeyPlan";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { FirstCorpusImportQueue } from "@/lib/sports/training/firstCorpusImportQueue";
import type { SupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";

export type DecisionEngineCapacityStateStatus =
  | "ready-shadow-review"
  | "ai-review-ready"
  | "deterministic-safe-mode"
  | "waiting-provider-keys"
  | "waiting-corpus"
  | "waiting-openai-quota"
  | "blocked";

export type DecisionEngineCapacityGateStatus = "pass" | "watch" | "block";

export type DecisionEngineCapacityGate = {
  id: string;
  label: string;
  status: DecisionEngineCapacityGateStatus;
  detail: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionEngineCapacityState = {
  mode: "decision-engine-capacity-state";
  generatedAt: string;
  status: DecisionEngineCapacityStateStatus;
  capacityHash: string;
  summary: string;
  percentages: {
    technicalMvp: number;
    liveProductionMvp: number;
    dataReadiness: number;
    aiReadiness: number;
  };
  operatingMode: {
    label: string;
    canUseDeterministicReasoning: boolean;
    canRequestOpenAIReview: boolean;
    canRunProviderDryRun: boolean;
    canUseSupabaseCorpusForTraining: boolean;
    canPublishPicks: false;
    canStake: false;
  };
  gates: DecisionEngineCapacityGate[];
  providerDataPlan: {
    status: DecisionProviderKeyPlan["status"];
    configuredCriticalLanes: number;
    totalCriticalLanes: number;
    missingCriticalKeys: string[];
    nextLane: string | null;
    nextFeed: string | null;
    feeds: {
      total: number;
      configured: number;
      missingCritical: number;
      optionalMissing: number;
      modelFeatures: number;
    };
    topMissingFeeds: Array<{
      id: DecisionProviderKeyPlan["feedMatrix"]["rows"][number]["id"];
      label: string;
      missingKeys: string[];
      modelFeatures: string[];
      proofUrl: string;
    }>;
  };
  footballMvpMinimum: {
    status: "waiting" | "partial" | "ready";
    requiredEnvLines: string[];
    missingEnvNames: string[];
    nextMissingEnvName: string | null;
    firstProofUrl: string;
    afterSave: string[];
  };
  nextStep: DecisionEngineCapacityGate;
  blockers: string[];
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

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function gate(input: DecisionEngineCapacityGate): DecisionEngineCapacityGate {
  return {
    ...input,
    detail: compact(input.detail),
    nextAction: compact(input.nextAction)
  };
}

function statusFor({
  openAiLiveReviewReceipt,
  firstCorpusImportQueue,
  supabaseTrainingCorpusCensus
}: {
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  firstCorpusImportQueue: FirstCorpusImportQueue;
  supabaseTrainingCorpusCensus: SupabaseTrainingCorpusCensus;
}): DecisionEngineCapacityStateStatus {
  if (openAiLiveReviewReceipt.status === "quota-or-billing-blocked" || openAiLiveReviewReceipt.status === "rate-or-quota-limited") {
    return "waiting-openai-quota";
  }
  if (firstCorpusImportQueue.status === "failed" || supabaseTrainingCorpusCensus.status === "failed") return "blocked";
  if (firstCorpusImportQueue.status === "waiting-provider-keys") return "waiting-provider-keys";
  if (supabaseTrainingCorpusCensus.status === "empty-corpus" || firstCorpusImportQueue.status === "ready-provider-dry-run") return "waiting-corpus";
  if (supabaseTrainingCorpusCensus.status === "ready-shadow-backtest" || firstCorpusImportQueue.status === "ready-shadow-backtest") return "ready-shadow-review";
  if (openAiLiveReviewReceipt.status === "ready-to-request" || openAiLiveReviewReceipt.status === "reviewed") return "ai-review-ready";
  return "deterministic-safe-mode";
}

function summaryFor(status: DecisionEngineCapacityStateStatus): string {
  if (status === "ready-shadow-review") return "Decision engine has enough stored corpus evidence for shadow review; public picks remain separately locked.";
  if (status === "ai-review-ready") return "Decision engine can request a guarded OpenAI review, but live data and training authority still decide trust.";
  if (status === "waiting-openai-quota") return "Decision engine reached OpenAI, but the selected project needs billing, quota, or rate-limit capacity.";
  if (status === "waiting-provider-keys") return "Decision engine is waiting for sports and odds provider keys before it can ingest real corpus data.";
  if (status === "waiting-corpus") return "Decision engine is waiting for provider dry-runs, storage receipts, feature rows, and backtests to populate Supabase.";
  if (status === "blocked") return "Decision engine has a failing Supabase, provider, or review dependency that must be inspected before progress continues.";
  return "Decision engine is operating in deterministic safe mode while live evidence gates remain closed.";
}

function operatingLabel(status: DecisionEngineCapacityStateStatus): string {
  if (status === "ready-shadow-review") return "shadow review";
  if (status === "ai-review-ready") return "guarded AI review";
  if (status === "waiting-openai-quota") return "AI quota waiting";
  if (status === "waiting-provider-keys") return "provider key waiting";
  if (status === "waiting-corpus") return "corpus import waiting";
  if (status === "blocked") return "blocked inspection";
  return "deterministic safe mode";
}

function placeholderFor(envName: string): string {
  return `${envName}=paste_${envName.toLowerCase()}_here`;
}

function footballMvpMinimumFor(providerKeyPlan: DecisionProviderKeyPlan): DecisionEngineCapacityState["footballMvpMinimum"] {
  const football = providerKeyPlan.lanes.find((lane) => lane.id === "football-core") ?? null;
  const odds = providerKeyPlan.lanes.find((lane) => lane.id === "odds-markets") ?? null;
  const required = [football, odds].filter((lane): lane is NonNullable<typeof lane> => Boolean(lane));
  const configured = required.filter((lane) => lane.status === "configured").length;
  const missingEnvNames = unique(required.flatMap((lane) => lane.missing));

  return {
    status: configured === required.length ? "ready" : configured > 0 ? "partial" : "waiting",
    requiredEnvLines: required.map((lane) => placeholderFor(lane.keys[0] ?? lane.id)),
    missingEnvNames,
    nextMissingEnvName: missingEnvNames[0] ?? null,
    firstProofUrl: football?.proofUrl ?? providerKeyPlan.nextLane?.proofUrl ?? "/api/sports/decision/provider-key-plan",
    afterSave: [
      "Restart localhost so Next.js reloads process.env.",
      "Open provider-key-activation-receipt to confirm env names are present.",
      "Run provider proof only as a dry-run/admin-gated receipt before storage writes."
    ]
  };
}

export function buildDecisionEngineCapacityState({
  openAiKeyDiagnostic,
  openAiLiveReviewReceipt,
  supabaseTrainingCorpusCensus,
  firstCorpusImportQueue,
  providerKeyPlan,
  mvpProgressReceipt,
  now = new Date()
}: {
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  supabaseTrainingCorpusCensus: SupabaseTrainingCorpusCensus;
  firstCorpusImportQueue: FirstCorpusImportQueue;
  providerKeyPlan: DecisionProviderKeyPlan;
  mvpProgressReceipt: DecisionMvpProgressReceipt;
  now?: Date;
}): DecisionEngineCapacityState {
  const openAiQuotaBlocked =
    openAiLiveReviewReceipt.status === "quota-or-billing-blocked" || openAiLiveReviewReceipt.status === "rate-or-quota-limited";
  const providerKeysMissing = firstCorpusImportQueue.status === "waiting-provider-keys";
  const corpusEmpty = supabaseTrainingCorpusCensus.status === "empty-corpus";
  const trainingReady = supabaseTrainingCorpusCensus.controls.canUseForShadowBacktest && firstCorpusImportQueue.controls.canTrainModels;
  const status = statusFor({ openAiLiveReviewReceipt, firstCorpusImportQueue, supabaseTrainingCorpusCensus });
  const footballMvpMinimum = footballMvpMinimumFor(providerKeyPlan);
  const gates = [
    gate({
      id: "openai-capacity",
      label: "OpenAI capacity",
      status: openAiQuotaBlocked ? "block" : openAiKeyDiagnostic.status === "ready-to-request" ? "pass" : "watch",
      detail: openAiQuotaBlocked ? openAiLiveReviewReceipt.providerDiagnostic.operatorMessage : openAiKeyDiagnostic.summary,
      nextAction: openAiQuotaBlocked ? "Add billing or quota to the selected OpenAI project, then rerun the guarded live review proof." : openAiKeyDiagnostic.nextStep.label,
      proofUrl: "/api/sports/decision/openai-live-review-receipt"
    }),
    gate({
      id: "sports-provider-keys",
      label: "Sports provider keys",
      status: providerKeysMissing ? "block" : firstCorpusImportQueue.controls.canRunProviderDryRun ? "pass" : "watch",
      detail:
        providerKeyPlan.feedMatrix.nextFeed?.blockedReason ??
        (firstCorpusImportQueue.nextStep?.blocker
          ? `Provider dry-run is blocked by ${firstCorpusImportQueue.nextStep.blocker}.`
          : firstCorpusImportQueue.summary),
      nextAction: providerKeyPlan.nextLane
        ? `Configure ${providerKeyPlan.nextLane.label}.`
        : firstCorpusImportQueue.nextStep?.label ?? "Inspect the first corpus import queue.",
      proofUrl: "/api/sports/decision/provider-key-plan"
    }),
    gate({
      id: "supabase-corpus",
      label: "Supabase corpus",
      status: corpusEmpty ? "block" : supabaseTrainingCorpusCensus.controls.canUseForShadowBacktest ? "pass" : "watch",
      detail: supabaseTrainingCorpusCensus.summary,
      nextAction: supabaseTrainingCorpusCensus.nextAction.label,
      proofUrl: "/api/sports/decision/training/supabase-training-corpus-census"
    }),
    gate({
      id: "training-authority",
      label: "Training authority",
      status: trainingReady ? "pass" : "block",
      detail: trainingReady
        ? "Stored feature rows, labels, and completed backtests can be reviewed for shadow training."
        : "Training remains locked until stored feature rows, labels, backtests, and promotion gates pass.",
      nextAction: firstCorpusImportQueue.steps.find((step) => step.kind === "feature-materialization" || step.kind === "backtest-persistence")?.label ?? "Inspect training readiness.",
      proofUrl: "/api/sports/decision/training/readiness"
    }),
    gate({
      id: "public-safety",
      label: "Public safety",
      status: "pass",
      detail: "Public picks, persistence, training, and staking stay locked from this capacity receipt.",
      nextAction: "Keep public authority behind final answer, trust firewall, and promotion gates.",
      proofUrl: "/api/sports/decision/trust-firewall"
    })
  ];
  const nextStep = gates.find((item) => item.status === "block") ?? gates.find((item) => item.status === "watch") ?? gates[gates.length - 1];
  const blockers = unique([
    openAiQuotaBlocked ? openAiLiveReviewReceipt.providerDiagnostic.operatorMessage : null,
    providerKeysMissing ? firstCorpusImportQueue.nextStep?.blocker ?? "Sports or odds provider keys are missing." : null,
    corpusEmpty ? "Supabase training corpus has zero fixture, odds, feature, and backtest rows." : null,
    trainingReady ? null : "Training authority is locked until corpus and backtest evidence exist.",
    ...mvpProgressReceipt.blockers
  ]);

  return {
    mode: "decision-engine-capacity-state",
    generatedAt: now.toISOString(),
    status,
    capacityHash: stableHash({
      status,
      openAi: [openAiKeyDiagnostic.diagnosticHash, openAiLiveReviewReceipt.receiptHash, openAiLiveReviewReceipt.status],
      supabase: [supabaseTrainingCorpusCensus.censusHash, supabaseTrainingCorpusCensus.status, supabaseTrainingCorpusCensus.totals],
      queue: [firstCorpusImportQueue.queueHash, firstCorpusImportQueue.status],
      providerPlan: [
        providerKeyPlan.status,
        providerKeyPlan.configuredCriticalLanes,
        providerKeyPlan.missingCriticalKeys,
        providerKeyPlan.feedMatrix.totals
      ],
      footballMvpMinimum: [
        footballMvpMinimum.status,
        footballMvpMinimum.requiredEnvLines,
        footballMvpMinimum.missingEnvNames,
        footballMvpMinimum.firstProofUrl
      ],
      mvp: mvpProgressReceipt.percentages
    }),
    summary: summaryFor(status),
    percentages: mvpProgressReceipt.percentages,
    operatingMode: {
      label: operatingLabel(status),
      canUseDeterministicReasoning: true,
      canRequestOpenAIReview: openAiLiveReviewReceipt.controls.canRequestLiveReview && !openAiQuotaBlocked,
      canRunProviderDryRun: firstCorpusImportQueue.controls.canRunProviderDryRun,
      canUseSupabaseCorpusForTraining: trainingReady,
      canPublishPicks: false,
      canStake: false
    },
    gates,
    providerDataPlan: {
      status: providerKeyPlan.status,
      configuredCriticalLanes: providerKeyPlan.configuredCriticalLanes,
      totalCriticalLanes: providerKeyPlan.totalCriticalLanes,
      missingCriticalKeys: providerKeyPlan.missingCriticalKeys,
      nextLane: providerKeyPlan.nextLane?.label ?? null,
      nextFeed: providerKeyPlan.feedMatrix.nextFeed?.label ?? null,
      feeds: {
        total: providerKeyPlan.feedMatrix.totals.feeds,
        configured: providerKeyPlan.feedMatrix.totals.configured,
        missingCritical: providerKeyPlan.feedMatrix.totals.missingCritical,
        optionalMissing: providerKeyPlan.feedMatrix.totals.optionalMissing,
        modelFeatures: providerKeyPlan.feedMatrix.totals.modelFeatures
      },
      topMissingFeeds: providerKeyPlan.feedMatrix.rows
        .filter((feed) => feed.status !== "configured")
        .slice(0, 6)
        .map((feed) => ({
          id: feed.id,
          label: feed.label,
          missingKeys: feed.missingKeys,
          modelFeatures: feed.modelFeatures,
          proofUrl: feed.proofUrl
        }))
    },
    footballMvpMinimum,
    nextStep,
    blockers,
    proofUrls: unique([
      "/api/sports/decision/engine-capacity-state",
      "/api/sports/decision/openai-key-diagnostic",
      "/api/sports/decision/openai-live-review-receipt",
      "/api/sports/decision/provider-key-plan",
      "/api/sports/decision/training/first-corpus-import-queue",
      "/api/sports/decision/training/supabase-training-corpus-census",
      "/api/sports/decision/mvp-progress"
    ]),
    locks: [
      "Capacity state is read-only and cannot call OpenAI, fetch providers, write Supabase rows, train models, publish picks, or stake.",
      `OpenAI proof command: ${decisionCurlCommand("/api/sports/decision/openai-live-review-receipt?sport=football&limit=1&run=1")}`,
      "Sports provider dry-runs require provider keys plus the guarded provider queue; storage writes require separate receipts.",
      "Training authority requires stored corpus rows, labels, completed backtests, and model-promotion review."
    ]
  };
}
