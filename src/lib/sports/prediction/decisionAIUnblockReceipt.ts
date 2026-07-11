import type { DecisionAILiveCycleReceipt } from "@/lib/sports/prediction/decisionAILiveCycleReceipt";
import type { DecisionBrainEvidenceDebtResolver } from "@/lib/sports/prediction/decisionBrainEvidenceDebtResolver";
import type { DecisionOddsFeatureGenerationReceipt } from "@/lib/sports/prediction/decisionOddsFeatureGenerationReceipt";
import type { DecisionOddsSnapshotStorageReadiness } from "@/lib/sports/prediction/decisionOddsSnapshotStorageReadiness";
import type { DecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import type { DecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import type { DecisionSupabaseMcpObservationReceipt } from "@/lib/sports/prediction/decisionSupabaseMcpObservationReceipt";
import type { TrainingReadiness } from "@/lib/sports/training/trainingReadiness";
import type { Sport } from "@/lib/sports/types";

export type DecisionAIUnblockReceiptStatus =
  | "blocked-data-authority"
  | "blocked-training-corpus"
  | "blocked-evidence-debt"
  | "waiting-openai"
  | "ready-guarded-review"
  | "reviewed-advisory";

export type DecisionAIUnblockTaskStatus = "pass" | "watch" | "block";
export type DecisionAIUnblockTaskSource = "openai" | "supabase" | "odds" | "training" | "brain" | "safety";

export type DecisionAIUnblockTask = {
  id: string;
  source: DecisionAIUnblockTaskSource;
  status: DecisionAIUnblockTaskStatus;
  priority: "critical" | "high" | "medium" | "low";
  label: string;
  detail: string;
  nextAction: string;
  proofUrl: string;
  unlocks: string[];
  blocksLiveReview: boolean;
  blocksTraining: boolean;
};

export type DecisionAIUnblockReceipt = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-unblock-receipt";
  status: DecisionAIUnblockReceiptStatus;
  receiptHash: string;
  summary: string;
  progress: {
    tasks: number;
    passed: number;
    watched: number;
    blocked: number;
    mvpFoundationPercent: number;
    liveReviewPercent: number;
  };
  currentWork: {
    label: string;
    source: DecisionAIUnblockTaskSource;
    proofUrl: string;
    reason: string;
  } | null;
  tasks: DecisionAIUnblockTask[];
  controls: {
    canInspectReadOnly: true;
    canRequestOpenAIReview: boolean;
    requiresExplicitRunParam: true;
    canRunOpenAIWithoutEvidence: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
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

function compact(value: string | null | undefined, maxLength = 260): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No public detail available.";
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function task(input: DecisionAIUnblockTask): DecisionAIUnblockTask {
  return {
    ...input,
    detail: compact(input.detail),
    nextAction: compact(input.nextAction),
    unlocks: unique(input.unlocks, 8)
  };
}

function priorityRank(priority: DecisionAIUnblockTask["priority"]): number {
  if (priority === "critical") return 4;
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function statusRank(status: DecisionAIUnblockTaskStatus): number {
  if (status === "block") return 3;
  if (status === "watch") return 2;
  return 1;
}

function taskProgress(status: DecisionAIUnblockTaskStatus): number {
  if (status === "pass") return 1;
  if (status === "watch") return 0.45;
  return 0;
}

function statusFor({
  tasks,
  openAiLiveReviewReceipt
}: {
  tasks: DecisionAIUnblockTask[];
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
}): DecisionAIUnblockReceiptStatus {
  if (openAiLiveReviewReceipt.status === "quota-or-billing-blocked" || openAiLiveReviewReceipt.status === "rate-or-quota-limited") return "waiting-openai";
  if (tasks.some((item) => item.source === "supabase" && item.status === "block")) return "blocked-data-authority";
  if (tasks.some((item) => item.source === "odds" && item.status === "block")) return "blocked-data-authority";
  if (tasks.some((item) => item.source === "training" && item.status === "block")) return "blocked-training-corpus";
  if (tasks.some((item) => item.source === "brain" && item.status === "block")) return "blocked-evidence-debt";
  if (openAiLiveReviewReceipt.status === "reviewed") return "reviewed-advisory";
  return "ready-guarded-review";
}

function summaryFor(status: DecisionAIUnblockReceiptStatus, current: DecisionAIUnblockReceipt["currentWork"]): string {
  if (status === "blocked-data-authority") return `AI live review is held by data authority: ${current?.label ?? "prove the storage target"}.`;
  if (status === "blocked-training-corpus") return `AI live review is held by training corpus proof: ${current?.label ?? "prove historical data and backtests"}.`;
  if (status === "blocked-evidence-debt") return `AI live review is held by evidence debt: ${current?.label ?? "clear the brain blockers"}.`;
  if (status === "waiting-openai") return "AI live review reached an OpenAI quota, rate, or billing wait state.";
  if (status === "reviewed-advisory") return "AI live review has completed, but it remains advisory with persistence, training, publishing, and staking locked.";
  return "AI live review can be requested through the guarded run=1 route; public actions still stay locked.";
}

export function buildDecisionAIUnblockReceipt({
  date,
  sport,
  openAiKeyDiagnostic,
  openAiLiveReviewReceipt,
  aiLiveCycleReceipt,
  brainEvidenceDebtResolver,
  supabaseMcpObservationReceipt,
  oddsSnapshotStorageReadiness,
  oddsFeatureGenerationReceipt,
  trainingReadiness,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  aiLiveCycleReceipt: DecisionAILiveCycleReceipt;
  brainEvidenceDebtResolver: DecisionBrainEvidenceDebtResolver;
  supabaseMcpObservationReceipt: DecisionSupabaseMcpObservationReceipt;
  oddsSnapshotStorageReadiness: DecisionOddsSnapshotStorageReadiness;
  oddsFeatureGenerationReceipt: DecisionOddsFeatureGenerationReceipt;
  trainingReadiness: TrainingReadiness;
  now?: Date;
}): DecisionAIUnblockReceipt {
  const supabaseClean = supabaseMcpObservationReceipt.status === "clean-odds-padi-proof" && supabaseMcpObservationReceipt.controls.canTrustMcpForSchema;
  const oddsStorageReady = oddsSnapshotStorageReadiness.status === "ready-shadow-storage-review";
  const oddsFeaturesReady = oddsFeatureGenerationReceipt.status === "generated-preview";
  const trainingReady = trainingReadiness.status === "trainable-shadow";
  const brainClear = brainEvidenceDebtResolver.debt.blockerCount === 0 && aiLiveCycleReceipt.status !== "blocked";

  const tasks = [
    task({
      id: "openai-runtime",
      source: "openai",
      status: openAiKeyDiagnostic.status === "ready-to-request" && openAiLiveReviewReceipt.controls.canRequestLiveReview ? "pass" : "block",
      priority: "high",
      label: "OpenAI guarded runtime",
      detail: openAiLiveReviewReceipt.summary,
      nextAction: openAiLiveReviewReceipt.nextAction,
      proofUrl: "/api/sports/decision/openai-live-review-receipt",
      unlocks: ["guarded AI critique", "same-or-safer review"],
      blocksLiveReview: openAiKeyDiagnostic.status !== "ready-to-request",
      blocksTraining: false
    }),
    task({
      id: "supabase-authority",
      source: "supabase",
      status: supabaseClean ? "pass" : "block",
      priority: "critical",
      label: "OddsPadi Supabase authority",
      detail: supabaseMcpObservationReceipt.summary,
      nextAction: supabaseMcpObservationReceipt.nextAction,
      proofUrl: "/api/sports/decision/supabase-mcp-observation-receipt",
      unlocks: ["provider writes", "odds snapshot storage", "decision memory"],
      blocksLiveReview: true,
      blocksTraining: true
    }),
    task({
      id: "odds-snapshot-storage",
      source: "odds",
      status: oddsStorageReady ? "pass" : oddsSnapshotStorageReadiness.status === "waiting-odds-proof" ? "watch" : "block",
      priority: "critical",
      label: "Bookmaker odds snapshot storage",
      detail: oddsSnapshotStorageReadiness.summary,
      nextAction: oddsSnapshotStorageReadiness.nextTurn.label,
      proofUrl: "/api/sports/decision/odds-snapshot-storage-readiness",
      unlocks: ["opening odds", "pre-kickoff odds", "closing-line value"],
      blocksLiveReview: true,
      blocksTraining: true
    }),
    task({
      id: "odds-feature-generation",
      source: "odds",
      status: oddsFeaturesReady ? "pass" : oddsFeatureGenerationReceipt.status === "waiting-odds-write" ? "block" : "watch",
      priority: "high",
      label: "Odds feature generation",
      detail: oddsFeatureGenerationReceipt.summary,
      nextAction: oddsFeatureGenerationReceipt.verification.fallbackAction,
      proofUrl: "/api/sports/decision/odds-feature-generation-receipt",
      unlocks: ["market edge features", "expected value labels", "CLV audit"],
      blocksLiveReview: true,
      blocksTraining: true
    }),
    task({
      id: "training-corpus",
      source: "training",
      status: trainingReady ? "pass" : trainingReadiness.status === "backfill-ready" ? "watch" : "block",
      priority: "high",
      label: "Historical training corpus",
      detail: trainingReadiness.summary,
      nextAction: trainingReadiness.nextSafeCommand.label,
      proofUrl: "/api/sports/decision/training/readiness",
      unlocks: ["shadow training", "backtests", "learned weights"],
      blocksLiveReview: false,
      blocksTraining: true
    }),
    task({
      id: "brain-evidence-debt",
      source: "brain",
      status: brainClear ? "pass" : brainEvidenceDebtResolver.status === "ready-action" ? "block" : "block",
      priority: "high",
      label: "Brain evidence debt",
      detail: `${brainEvidenceDebtResolver.debt.blockerCount} blocker(s), evidence debt ${brainEvidenceDebtResolver.debt.evidenceDebt}/100. ${brainEvidenceDebtResolver.summary}`,
      nextAction: brainEvidenceDebtResolver.nextAction?.label ?? "Inspect brain evidence debt resolver.",
      proofUrl: "/api/sports/decision/brain-evidence-debt-resolver",
      unlocks: ["live-review request permission", "advisory trust ceiling"],
      blocksLiveReview: true,
      blocksTraining: false
    }),
    task({
      id: "public-action-safety",
      source: "safety",
      status: "pass",
      priority: "medium",
      label: "Public action safety locks",
      detail: "Persistence, training, publishing, staking, hidden chain-of-thought, and trust upgrades are locked.",
      nextAction: "Keep all public pick outputs advisory until every proof gate passes.",
      proofUrl: "/api/sports/decision/ai-live-cycle-receipt",
      unlocks: ["safe operator visibility"],
      blocksLiveReview: false,
      blocksTraining: false
    })
  ].sort((a, b) => statusRank(b.status) - statusRank(a.status) || priorityRank(b.priority) - priorityRank(a.priority) || a.label.localeCompare(b.label));

  const currentWorkTask =
    tasks.find((item) => item.id === "supabase-authority" && item.status === "block") ??
    tasks.find((item) => item.status === "block") ??
    tasks.find((item) => item.status === "watch") ??
    null;
  const currentWork = currentWorkTask
    ? {
        label: currentWorkTask.label,
        source: currentWorkTask.source,
        proofUrl: currentWorkTask.proofUrl,
        reason: currentWorkTask.detail
      }
    : null;
  const progressScore = tasks.reduce((sum, item) => sum + taskProgress(item.status), 0) / Math.max(1, tasks.length);
  const liveReviewScore = tasks.filter((item) => item.blocksLiveReview).reduce((sum, item) => sum + taskProgress(item.status), 0) / Math.max(1, tasks.filter((item) => item.blocksLiveReview).length);
  const progress = {
    tasks: tasks.length,
    passed: tasks.filter((item) => item.status === "pass").length,
    watched: tasks.filter((item) => item.status === "watch").length,
    blocked: tasks.filter((item) => item.status === "block").length,
    mvpFoundationPercent: clamp(progressScore * 100),
    liveReviewPercent: clamp(liveReviewScore * 100)
  };
  const status = statusFor({ tasks, openAiLiveReviewReceipt });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "ai-unblock-receipt",
    status,
    receiptHash: stableHash({
      date,
      sport,
      status,
      tasks: tasks.map((item) => [item.id, item.status]),
      openAi: openAiLiveReviewReceipt.receiptHash,
      supabase: supabaseMcpObservationReceipt.receiptHash,
      oddsStorage: oddsSnapshotStorageReadiness.readinessHash,
      oddsFeatures: oddsFeatureGenerationReceipt.receiptHash,
      training: trainingReadiness.readinessHash,
      brain: brainEvidenceDebtResolver.resolverHash
    }),
    summary: summaryFor(status, currentWork),
    progress,
    currentWork,
    tasks,
    controls: {
      canInspectReadOnly: true,
      canRequestOpenAIReview: status === "ready-guarded-review" || status === "reviewed-advisory",
      requiresExplicitRunParam: true,
      canRunOpenAIWithoutEvidence: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/ai-unblock-receipt",
      "/api/sports/decision/openai-live-review-receipt",
      "/api/sports/decision/ai-live-cycle-receipt",
      "/api/sports/decision/supabase-mcp-observation-receipt",
      "/api/sports/decision/odds-snapshot-storage-readiness",
      "/api/sports/decision/odds-feature-generation-receipt",
      "/api/sports/decision/training/readiness",
      "/api/sports/decision/brain-evidence-debt-resolver"
    ]),
    locks: [
      "AI unblock receipt is read-only and cannot call OpenAI by itself.",
      "Guarded OpenAI review is denied until data authority, odds feature, training, and brain evidence gates are clear.",
      "No provider writes, decision persistence, training-row writes, learned-weight use, publishing, staking, or public-action upgrade is allowed from this receipt."
    ]
  };
}
