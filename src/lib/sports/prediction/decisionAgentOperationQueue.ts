import type { DecisionAgentThoughtBoard } from "@/lib/sports/prediction/decisionAgentThoughtBoard";
import type { DecisionLaunchCommander, DecisionLaunchCommanderItem } from "@/lib/sports/prediction/decisionLaunchCommander";
import type { DecisionLaunchState } from "@/lib/sports/prediction/decisionLaunchState";
import type { DecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import type { DecisionSupabaseMcpObservationReceipt } from "@/lib/sports/prediction/decisionSupabaseMcpObservationReceipt";
import type { Sport } from "@/lib/sports/types";
import type { TrainingActivationRunbook, TrainingActivationStep } from "@/lib/sports/training/trainingActivationRunbook";

export type DecisionAgentOperationQueueStatus = "ready-readonly" | "waiting-openai-quota" | "needs-evidence" | "blocked";
export type DecisionAgentOperationStatus = "ready" | "waiting" | "blocked" | "done";
export type DecisionAgentOperationKind = "agent" | "proof" | "openai" | "supabase" | "training" | "safety";

export type DecisionAgentOperation = {
  id: string;
  kind: DecisionAgentOperationKind;
  status: DecisionAgentOperationStatus;
  priority: "critical" | "high" | "medium" | "low";
  label: string;
  rationale: string;
  expectedEvidence: string;
  command: string | null;
  verifyUrl: string;
  safeToRun: boolean;
  blockedBy: string[];
};

export type DecisionAgentOperationQueue = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "agent-operation-queue";
  status: DecisionAgentOperationQueueStatus;
  queueHash: string;
  summary: string;
  nextOperation: DecisionAgentOperation | null;
  totals: Record<DecisionAgentOperationStatus, number>;
  operations: DecisionAgentOperation[];
  controls: {
    canInspectReadOnly: true;
    canRunReadOnlyCommand: boolean;
    canCallOpenAI: boolean;
    canCompleteOpenAIReview: boolean;
    canUseSupabaseWrites: false;
    canPersistDecisions: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
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

function compact(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function commandIsSafe(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (lower.includes("persist=1") || lower.includes("persist=true")) return false;
  if (lower.includes("dryrun=0") || lower.includes("dryrun=false")) return false;
  if (!lower.includes("-x post") && !lower.includes("-xpost")) return true;
  return lower.includes("dryrun=1");
}

function statusFromCommander(item: DecisionLaunchCommanderItem): DecisionAgentOperationStatus {
  if (item.status === "pass") return "done";
  if (item.status === "ready") return "ready";
  if (item.status === "waiting" || item.status === "watch") return "waiting";
  return "blocked";
}

function operation(input: Omit<DecisionAgentOperation, "rationale" | "expectedEvidence" | "blockedBy" | "safeToRun"> & {
  rationale: string;
  expectedEvidence: string;
  blockedBy?: string[];
}): DecisionAgentOperation {
  const blockedBy = unique(input.blockedBy ?? []);
  return {
    ...input,
    rationale: compact(input.rationale),
    expectedEvidence: compact(input.expectedEvidence),
    blockedBy,
    safeToRun: input.status === "ready" && blockedBy.length === 0 && commandIsSafe(input.command)
  };
}

function commanderOperation(item: DecisionLaunchCommanderItem): DecisionAgentOperation {
  return operation({
    id: `commander-${item.id}`,
    kind: item.category === "openai" ? "openai" : item.category === "supabase" ? "supabase" : item.category === "training" ? "training" : item.category === "safety" ? "safety" : "proof",
    status: statusFromCommander(item),
    priority: item.priority,
    label: item.label,
    rationale: item.detail,
    expectedEvidence: item.unlocks.length ? `Unlocks after proof: ${item.unlocks.join(", ")}.` : item.detail,
    command: item.command,
    verifyUrl: item.verifyUrl,
    blockedBy: [...item.missingEnv, ...item.blocks]
  });
}

function trainingOperation(step: TrainingActivationStep): DecisionAgentOperation {
  return operation({
    id: `training-${step.id}`,
    kind: "training",
    status: step.status === "done" ? "done" : step.status === "ready" ? "ready" : step.status === "blocked" ? "blocked" : "waiting",
    priority: step.status === "blocked" ? "high" : "medium",
    label: step.label,
    rationale: step.expectedEvidence,
    expectedEvidence: step.expectedEvidence,
    command: step.command,
    verifyUrl: step.verifyUrl,
    blockedBy: [...step.missingEnv, ...step.blockedBy]
  });
}

function queueStatus({
  agentThoughtBoard,
  openAiLiveReviewReceipt,
  operations
}: {
  agentThoughtBoard: DecisionAgentThoughtBoard;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  operations: DecisionAgentOperation[];
}): DecisionAgentOperationQueueStatus {
  if (openAiLiveReviewReceipt.status === "quota-or-billing-blocked" || openAiLiveReviewReceipt.status === "rate-or-quota-limited") return "waiting-openai-quota";
  if (agentThoughtBoard.status === "blocked" || operations.some((item) => item.status === "blocked" && item.priority === "critical")) return "blocked";
  if (operations.some((item) => item.status === "ready" && item.safeToRun)) return "ready-readonly";
  return "needs-evidence";
}

function summaryFor(status: DecisionAgentOperationQueueStatus, nextOperation: DecisionAgentOperation | null): string {
  if (status === "waiting-openai-quota") return "Agent operation queue is waiting on OpenAI quota/billing; read-only proof can continue but live AI review cannot complete.";
  if (status === "ready-readonly") return `Agent operation queue has a safe read-only step ready: ${nextOperation?.label ?? "proof check"}.`;
  if (status === "blocked") return `Agent operation queue is blocked by ${nextOperation?.label ?? "a critical evidence gate"}; no write, train, publish, or staking action is allowed.`;
  return "Agent operation queue needs more evidence before any trust level can rise.";
}

export function buildDecisionAgentOperationQueue({
  date,
  sport,
  agentThoughtBoard,
  launchCommander,
  launchState,
  openAiLiveReviewReceipt,
  supabaseMcpObservationReceipt,
  trainingActivationRunbook,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  agentThoughtBoard: DecisionAgentThoughtBoard;
  launchCommander: DecisionLaunchCommander;
  launchState: DecisionLaunchState;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  supabaseMcpObservationReceipt: DecisionSupabaseMcpObservationReceipt;
  trainingActivationRunbook: TrainingActivationRunbook;
  now?: Date;
}): DecisionAgentOperationQueue {
  const seedOperations = [
    operation({
      id: "agent-board-next-evidence",
      kind: "agent",
      status: agentThoughtBoard.status === "ready-shadow" ? "ready" : agentThoughtBoard.status === "quota-waiting" ? "waiting" : agentThoughtBoard.status === "blocked" ? "blocked" : "waiting",
      priority: "critical",
      label: `Resolve agent board for ${agentThoughtBoard.focus.match ?? sport}`,
      rationale: agentThoughtBoard.decision.rationale,
      expectedEvidence: agentThoughtBoard.decision.nextEvidenceAction,
      command: agentThoughtBoard.decision.proofCommand,
      verifyUrl: agentThoughtBoard.decision.verifyUrl ?? "/api/sports/decision/agent-thought-board",
      blockedBy: agentThoughtBoard.roles.filter((role) => role.status === "block").map((role) => `${role.label}: ${role.nextAction}`)
    }),
    operation({
      id: "openai-live-proof",
      kind: "openai",
      status:
        openAiLiveReviewReceipt.status === "reviewed"
          ? "done"
          : openAiLiveReviewReceipt.status === "ready-to-request"
            ? "ready"
          : openAiLiveReviewReceipt.status === "quota-or-billing-blocked" || openAiLiveReviewReceipt.status === "rate-or-quota-limited"
              ? "waiting"
              : "blocked",
      priority: "critical",
      label: "Complete guarded OpenAI live proof",
      rationale: openAiLiveReviewReceipt.summary,
      expectedEvidence: openAiLiveReviewReceipt.nextAction,
      command: openAiLiveReviewReceipt.controls.canRequestLiveReview
        ? `curl.exe -s "http://127.0.0.1:3025/api/sports/decision/openai-live-review-receipt?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&limit=1&run=1"`
        : null,
      verifyUrl: "/api/sports/decision/openai-live-review-receipt?run=1&limit=1",
      blockedBy: openAiLiveReviewReceipt.status === "quota-or-billing-blocked" ? openAiLiveReviewReceipt.locks : []
    }),
    operation({
      id: "supabase-mcp-observation",
      kind: "supabase",
      status:
        supabaseMcpObservationReceipt.status === "clean-odds-padi-proof"
          ? "done"
          : supabaseMcpObservationReceipt.status === "blocked-foreign-schema" || supabaseMcpObservationReceipt.status === "blocked-mixed-schema"
            ? "blocked"
            : "waiting",
      priority: "critical",
      label: "Prove clean OddsPadi Supabase target",
      rationale: supabaseMcpObservationReceipt.summary,
      expectedEvidence: supabaseMcpObservationReceipt.nextAction,
      command: null,
      verifyUrl: "/api/sports/decision/supabase-mcp-observation-receipt",
      blockedBy: supabaseMcpObservationReceipt.locks
    })
  ];
  const operations = [...seedOperations, ...launchCommander.items.map(commanderOperation), ...trainingActivationRunbook.steps.slice(0, 5).map(trainingOperation)];
  const sortedOperations = operations.sort((a, b) => {
    const statusRank = { blocked: 4, ready: 3, waiting: 2, done: 1 }[a.status] - { blocked: 4, ready: 3, waiting: 2, done: 1 }[b.status];
    if (statusRank !== 0) return -statusRank;
    const priorityRank = { critical: 4, high: 3, medium: 2, low: 1 }[a.priority] - { critical: 4, high: 3, medium: 2, low: 1 }[b.priority];
    if (priorityRank !== 0) return -priorityRank;
    return a.id.localeCompare(b.id);
  });
  const nextOperation = sortedOperations.find((item) => item.status === "blocked") ?? sortedOperations.find((item) => item.status === "ready") ?? null;
  const totals = {
    ready: sortedOperations.filter((item) => item.status === "ready").length,
    waiting: sortedOperations.filter((item) => item.status === "waiting").length,
    blocked: sortedOperations.filter((item) => item.status === "blocked").length,
    done: sortedOperations.filter((item) => item.status === "done").length
  };
  const status = queueStatus({ agentThoughtBoard, openAiLiveReviewReceipt, operations: sortedOperations });
  const canRunReadOnlyCommand = sortedOperations.some((item) => item.status === "ready" && item.safeToRun);

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "agent-operation-queue",
    status,
    queueHash: stableHash({
      date,
      sport,
      status,
      launchState: launchState.stateHash,
      board: agentThoughtBoard.boardHash,
      operations: sortedOperations.map((item) => [item.id, item.status, item.blockedBy])
    }),
    summary: summaryFor(status, nextOperation),
    nextOperation,
    totals,
    operations: sortedOperations,
    controls: {
      canInspectReadOnly: true,
      canRunReadOnlyCommand,
      canCallOpenAI: openAiLiveReviewReceipt.controls.canRequestLiveReview,
      canCompleteOpenAIReview: openAiLiveReviewReceipt.status === "reviewed",
      canUseSupabaseWrites: false,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/agent-operation-queue",
      ...agentThoughtBoard.proofUrls,
      ...launchCommander.proofUrls,
      ...launchState.proofUrls,
      ...openAiLiveReviewReceipt.proofUrls,
      "/api/sports/decision/supabase-mcp-observation-receipt",
      ...trainingActivationRunbook.proofUrls
    ]),
    locks: unique([
      "Agent operation queue is read-only and cannot persist decisions, write provider rows, train models, publish picks, stake, or expose hidden chain-of-thought.",
      ...agentThoughtBoard.locks,
      ...launchCommander.locks,
      ...launchState.locks,
      ...openAiLiveReviewReceipt.locks,
      ...supabaseMcpObservationReceipt.locks,
      ...trainingActivationRunbook.blockers
    ])
  };
}
