import type { DecisionCycleReceipt } from "@/lib/sports/prediction/decisionCycleReceipt";
import type { DecisionSupervisedAgentRun } from "@/lib/sports/prediction/decisionSupervisedAgentRun";
import type { Sport } from "@/lib/sports/types";

export type DecisionSupervisedAgentRunnerStatus = "preview" | "observed" | "observed-warning" | "blocked" | "failed";

export type DecisionSupervisedAgentRunner = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-supervised-agent-runner";
  status: DecisionSupervisedAgentRunnerStatus;
  runnerHash: string;
  summary: string;
  runRequested: boolean;
  previewRun: {
    runHash: string;
    status: DecisionSupervisedAgentRun["status"];
    activeStep: string | null;
    selectedIntent: string;
    receiptStatus: DecisionCycleReceipt["status"];
  };
  observedRun: {
    runHash: string;
    status: DecisionSupervisedAgentRun["status"];
    activeStep: string | null;
    selectedIntent: string;
    receiptStatus: DecisionCycleReceipt["status"];
  };
  receipt: {
    receiptHash: string;
    status: DecisionCycleReceipt["status"];
    targetAllowed: boolean;
    targetPath: string | null;
    attempted: boolean;
    httpStatus: number | null;
    success: boolean | null;
    responseHash: string | null;
    summary: string | null;
  };
  delta: {
    receiptChanged: boolean;
    runHashChanged: boolean;
    statusChanged: boolean;
    activeStepChanged: boolean;
    observedEvidence: string[];
  };
  controls: {
    canInspectReadOnly: true;
    canObserveOneSelectedIntent: boolean;
    canExecuteShell: false;
    canApplyAI: false;
    canPersist: false;
    canPersistOutcomes: false;
    canRunCalibration: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
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

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function runSnapshot(run: DecisionSupervisedAgentRun) {
  return {
    runHash: run.runHash,
    status: run.status,
    activeStep: run.activeStep?.id ?? null,
    selectedIntent: run.finalDirective.selectedIntent,
    receiptStatus: run.finalDirective.receiptStatus
  };
}

function statusFor({
  runRequested,
  receipt
}: {
  runRequested: boolean;
  receipt: DecisionCycleReceipt;
}): DecisionSupervisedAgentRunnerStatus {
  if (!runRequested) return "preview";
  if (receipt.status === "verified") return "observed";
  if (receipt.status === "observed-warning") return "observed-warning";
  if (receipt.status === "failed") return "failed";
  return "blocked";
}

function summaryFor(status: DecisionSupervisedAgentRunnerStatus, receipt: DecisionCycleReceipt): string {
  if (status === "observed") return `Supervised runner observed the selected read-only intent: ${receipt.selectedIntent.label}.`;
  if (status === "observed-warning") return "Supervised runner observed the selected intent, but the response needs review.";
  if (status === "failed") return `Supervised runner attempted the selected intent and failed: ${receipt.observation.error ?? "unknown error"}.`;
  if (status === "blocked") return `Supervised runner is blocked: ${receipt.target.reason}`;
  return `Supervised runner is ready to observe ${receipt.selectedIntent.label} when run=1 is requested.`;
}

export function buildDecisionSupervisedAgentRunner({
  date,
  sport,
  runRequested,
  previewRun,
  observedRun,
  observedReceipt,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  runRequested: boolean;
  previewRun: DecisionSupervisedAgentRun;
  observedRun: DecisionSupervisedAgentRun;
  observedReceipt: DecisionCycleReceipt;
  now?: Date;
}): DecisionSupervisedAgentRunner {
  const preview = runSnapshot(previewRun);
  const observed = runSnapshot(observedRun);
  const status = statusFor({ runRequested, receipt: observedReceipt });
  const observedEvidence = unique([
    observedReceipt.observation.statusLabel,
    observedReceipt.observation.summary,
    ...observedReceipt.observation.signals
  ], 8);

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-supervised-agent-runner",
    status,
    runnerHash: stableHash({
      date,
      sport,
      runRequested,
      preview,
      observed,
      receipt: [observedReceipt.receiptHash, observedReceipt.status, observedReceipt.observation.responseHash]
    }),
    summary: summaryFor(status, observedReceipt),
    runRequested,
    previewRun: preview,
    observedRun: observed,
    receipt: {
      receiptHash: observedReceipt.receiptHash,
      status: observedReceipt.status,
      targetAllowed: observedReceipt.target.allowed,
      targetPath: observedReceipt.target.path,
      attempted: observedReceipt.observation.attempted,
      httpStatus: observedReceipt.observation.statusCode,
      success: observedReceipt.observation.success,
      responseHash: observedReceipt.observation.responseHash,
      summary: observedReceipt.observation.summary
    },
    delta: {
      receiptChanged: preview.receiptStatus !== observed.receiptStatus,
      runHashChanged: preview.runHash !== observed.runHash,
      statusChanged: preview.status !== observed.status,
      activeStepChanged: preview.activeStep !== observed.activeStep,
      observedEvidence
    },
    controls: {
      canInspectReadOnly: true,
      canObserveOneSelectedIntent: observedReceipt.controls.canObserveSelectedIntent,
      canExecuteShell: false,
      canApplyAI: false,
      canPersist: false,
      canPersistOutcomes: false,
      canRunCalibration: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/supervised-agent-runner",
      "/api/sports/decision/supervised-agent-run",
      "/api/sports/decision/cycle-receipt",
      ...observedRun.proofUrls,
      ...observedReceipt.proofUrls
    ]),
    locks: unique([
      "Supervised runner can perform one approved local read-only observation only.",
      "Supervised runner never executes shell commands and cannot persist, train, publish, stake, or apply learned weights.",
      "Observed output is returned as a receipt and public trace, not hidden chain-of-thought.",
      ...observedRun.locks,
      ...observedReceipt.locks
    ], 32)
  };
}
