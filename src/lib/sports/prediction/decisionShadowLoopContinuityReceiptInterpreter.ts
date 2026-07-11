import type { DecisionShadowLoopContinuity } from "@/lib/sports/prediction/decisionShadowLoopContinuity";
import type { DecisionShadowLoopContinuityReceipt } from "@/lib/sports/prediction/decisionShadowLoopContinuityReceipt";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type DecisionShadowLoopContinuityReceiptInterpreterStatus = "waiting-continuity-observation" | "observed-continuity-proof" | "needs-repair" | "blocked";
export type DecisionShadowLoopContinuityReceiptTraceStatus = "pass" | "watch" | "block";

export type DecisionShadowLoopContinuityReceiptTrace = {
  id: "select" | "observe" | "interpret" | "guard" | "decide" | "learn";
  label: string;
  status: DecisionShadowLoopContinuityReceiptTraceStatus;
  publicReason: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionShadowLoopContinuityReceiptInterpreter = {
  generatedAt: string;
  date: string;
  sport: DecisionShadowLoopContinuity["sport"];
  mode: "decision-shadow-loop-continuity-receipt-interpreter";
  status: DecisionShadowLoopContinuityReceiptInterpreterStatus;
  interpreterHash: string;
  summary: string;
  input: {
    continuityHash: string;
    receiptHash: string;
    selectedMoveId: string | null;
    receiptStatus: DecisionShadowLoopContinuityReceipt["status"];
    proofHash: string | null;
    observedMode: string | null;
  };
  interpretation: {
    learned: string;
    risk: string;
    nextAction: string;
    confidenceEffect: "keep-capped" | "reduce" | "shadow-only";
    publicActionEffect: "none";
    probabilityEffect: 0;
  };
  publicTrace: DecisionShadowLoopContinuityReceiptTrace[];
  nextTurn: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
  };
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string | null;
    content: string;
  };
  controls: {
    canRunContinuityReceiptObservation: boolean;
    canRefreshContinuityWithObservedProof: boolean;
    canPersistMemory: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
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

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function hasSignal(receipt: DecisionShadowLoopContinuityReceipt, pattern: RegExp): boolean {
  return receipt.observation.signals.some((signal) => pattern.test(signal)) || Boolean(receipt.observation.statusLabel && pattern.test(receipt.observation.statusLabel));
}

function statusFor(receipt: DecisionShadowLoopContinuityReceipt): DecisionShadowLoopContinuityReceiptInterpreterStatus {
  if (receipt.status === "blocked") return "blocked";
  if (receipt.status === "failed" || receipt.status === "observed-warning") return "needs-repair";
  if (receipt.status === "verified") {
    return hasSignal(receipt, /block|fail|error|persist:true|adjust:true|publish:true|train:true|stake:true/i) ? "needs-repair" : "observed-continuity-proof";
  }
  return "waiting-continuity-observation";
}

function traceItem(input: DecisionShadowLoopContinuityReceiptTrace): DecisionShadowLoopContinuityReceiptTrace {
  return {
    ...input,
    publicReason: compact(input.publicReason),
    evidence: unique(input.evidence, 8),
    nextAction: compact(input.nextAction)
  };
}

function buildTrace({
  continuity,
  receipt,
  status
}: {
  continuity: DecisionShadowLoopContinuity;
  receipt: DecisionShadowLoopContinuityReceipt;
  status: DecisionShadowLoopContinuityReceiptInterpreterStatus;
}): DecisionShadowLoopContinuityReceiptTrace[] {
  return [
    traceItem({
      id: "select",
      label: "Continuity move",
      status: continuity.nextMove.safeToRun ? "pass" : "block",
      publicReason: continuity.nextMove.reason,
      evidence: unique([continuity.continuityHash, continuity.status, continuity.nextMove.id, continuity.nextMove.verifyUrl]),
      nextAction: continuity.nextMove.safeToRun ? "Keep the continuity-selected move as the only observable target." : "Hold until continuity selects a safe read-only move."
    }),
    traceItem({
      id: "observe",
      label: "Continuity observation",
      status: receipt.status === "verified" ? "pass" : receipt.status === "not-run" ? "watch" : "block",
      publicReason: receipt.summary,
      evidence: unique([receipt.receiptHash, receipt.status, receipt.observation.responseHash, receipt.observation.statusLabel, receipt.observation.mode]),
      nextAction:
        receipt.status === "not-run"
          ? "Run the shadow loop continuity receipt with run=1."
          : receipt.status === "verified"
            ? "Use the continuity receipt hash as public proof."
            : receipt.verification.fallbackAction
    }),
    traceItem({
      id: "interpret",
      label: "Continuity receipt interpretation",
      status: status === "observed-continuity-proof" ? "pass" : status === "waiting-continuity-observation" ? "watch" : "block",
      publicReason:
        status === "observed-continuity-proof"
          ? "The continuity-selected observation completed without blocker signals."
          : status === "waiting-continuity-observation"
            ? "Continuity selected an approved local target, but no continuity observation has been run."
            : "The continuity observation needs repair before the loop can continue.",
      evidence: unique([receipt.observation.summary, ...receipt.observation.signals]),
      nextAction: status === "observed-continuity-proof" ? "Refresh continuity with the observed proof hash." : "Keep the continuity loop capped until observation or repair completes."
    }),
    traceItem({
      id: "guard",
      label: "Authority guard",
      status:
        receipt.controls.canExecuteShell ||
        receipt.controls.canPersistMemory ||
        receipt.controls.canTrainModels ||
        receipt.controls.canApplyLearnedWeights ||
        receipt.controls.canAdjustProbabilities ||
        receipt.controls.canPublishPicks ||
        receipt.controls.canStake ||
        receipt.controls.canUpgradePublicAction
          ? "block"
          : "pass",
      publicReason: "The continuity receipt interpreter keeps shell, persistence, training, learned weights, probability changes, publishing, staking, and public action upgrades locked.",
      evidence: [
        `shell:${receipt.controls.canExecuteShell}`,
        `persist:${receipt.controls.canPersistMemory}`,
        `train:${receipt.controls.canTrainModels}`,
        `weights:${receipt.controls.canApplyLearnedWeights}`,
        `adjust:${receipt.controls.canAdjustProbabilities}`,
        `publish:${receipt.controls.canPublishPicks}`,
        `stake:${receipt.controls.canStake}`,
        `upgrade:${receipt.controls.canUpgradePublicAction}`
      ],
      nextAction: "Continue only in read-only shadow-continuity mode."
    }),
    traceItem({
      id: "decide",
      label: "Next continuity turn",
      status: status === "blocked" || status === "needs-repair" ? "block" : "watch",
      publicReason:
        status === "observed-continuity-proof"
          ? "The loop can refresh continuity from observed proof, but public betting action remains unchanged."
          : status === "waiting-continuity-observation"
            ? "The loop should observe the continuity-selected target before refreshing continuity."
            : "The loop should repair or replace the selected continuity proof target before continuing.",
      evidence: unique([status, receipt.target.path, receipt.target.reason, receipt.selectedMove.id]),
      nextAction:
        status === "observed-continuity-proof"
          ? "Run the shadow loop continuity route with run=1."
          : status === "waiting-continuity-observation"
            ? "Observe the approved continuity target once."
            : "Repair the continuity proof path."
    }),
    traceItem({
      id: "learn",
      label: "Continuity memory",
      status: "watch",
      publicReason: "The interpreter drafts a continuity memory note but cannot persist it until outcome, training, and promotion gates pass.",
      evidence: unique([receipt.observation.responseHash, receipt.receiptHash, continuity.continuityHash]),
      nextAction: "Keep the memory draft local to this response."
    })
  ];
}

function interpretationFor(
  status: DecisionShadowLoopContinuityReceiptInterpreterStatus,
  receipt: DecisionShadowLoopContinuityReceipt
): DecisionShadowLoopContinuityReceiptInterpreter["interpretation"] {
  if (status === "observed-continuity-proof") {
    return {
      learned: compact(receipt.observation.summary ?? "The continuity-selected read-only target responded successfully."),
      risk: "Continuity proof can refresh the next shadow continuity step only; it cannot change the public pick, probability, confidence, or stake.",
      nextAction: "Refresh shadow loop continuity using the observed continuity receipt hash.",
      confidenceEffect: "shadow-only",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  if (status === "waiting-continuity-observation") {
    return {
      learned: "Continuity selected an approved proof target, but no continuity observation has been run.",
      risk: "Without a continuity receipt hash, the loop must not claim the continuity move was observed.",
      nextAction: "Run one shadow loop continuity receipt observation.",
      confidenceEffect: "keep-capped",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  return {
    learned: compact(receipt.observation.error ?? receipt.target.reason),
    risk: "The continuity proof path is blocked or unreliable, so the loop must repair evidence before continuing.",
    nextAction: receipt.verification.fallbackAction,
    confidenceEffect: "reduce",
    publicActionEffect: "none",
    probabilityEffect: 0
  };
}

function nextTurnFor({
  date,
  sport,
  receipt,
  status
}: {
  date: string;
  sport: DecisionShadowLoopContinuity["sport"];
  receipt: DecisionShadowLoopContinuityReceipt;
  status: DecisionShadowLoopContinuityReceiptInterpreterStatus;
}): DecisionShadowLoopContinuityReceiptInterpreter["nextTurn"] {
  if (status === "waiting-continuity-observation" && receipt.target.allowed) {
    const verifyUrl = `/api/sports/decision/shadow-loop-continuity-receipt?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&run=1`;
    return {
      label: "Observe continuity-selected move",
      command: decisionCurlCommand(verifyUrl),
      verifyUrl,
      safeToRun: true
    };
  }
  if (status === "observed-continuity-proof") {
    const verifyUrl = `/api/sports/decision/shadow-loop-continuity?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&run=1`;
    return {
      label: "Refresh continuity with observed proof",
      command: decisionCurlCommand(verifyUrl),
      verifyUrl,
      safeToRun: true
    };
  }
  return {
    label: "Repair continuity proof path",
    command: null,
    verifyUrl: receipt.target.path ?? "/api/sports/decision/shadow-loop-continuity",
    safeToRun: false
  };
}

function summaryFor(
  status: DecisionShadowLoopContinuityReceiptInterpreterStatus,
  interpretation: DecisionShadowLoopContinuityReceiptInterpreter["interpretation"]
): string {
  if (status === "observed-continuity-proof") return `Shadow continuity receipt interpreter learned: ${interpretation.learned}`;
  if (status === "waiting-continuity-observation") return "Shadow continuity receipt interpreter is waiting for the continuity-selected move to be observed.";
  if (status === "needs-repair") return "Shadow continuity receipt interpreter needs proof repair before the loop can continue.";
  return "Shadow continuity receipt interpreter is blocked by an unsafe or unavailable continuity target.";
}

export function buildDecisionShadowLoopContinuityReceiptInterpreter({
  continuity,
  receipt,
  now = new Date()
}: {
  continuity: DecisionShadowLoopContinuity;
  receipt: DecisionShadowLoopContinuityReceipt;
  now?: Date;
}): DecisionShadowLoopContinuityReceiptInterpreter {
  const status = statusFor(receipt);
  const interpretation = interpretationFor(status, receipt);
  const publicTrace = buildTrace({ continuity, receipt, status });
  const nextTurn = nextTurnFor({ date: continuity.date, sport: continuity.sport, receipt, status });
  const memoryContent = compact(
    [
      `status:${status}`,
      `move:${receipt.selectedMove.id ?? "none"}`,
      `proof:${receipt.observation.responseHash ?? "pending"}`,
      `learned:${interpretation.learned}`,
      `risk:${interpretation.risk}`
    ].join(" | "),
    420
  );
  const interpreterHash = stableHash({
    date: continuity.date,
    sport: continuity.sport,
    continuity: continuity.continuityHash,
    receipt: receipt.receiptHash,
    status,
    proof: receipt.observation.responseHash,
    trace: publicTrace.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date: continuity.date,
    sport: continuity.sport,
    mode: "decision-shadow-loop-continuity-receipt-interpreter",
    status,
    interpreterHash,
    summary: summaryFor(status, interpretation),
    input: {
      continuityHash: continuity.continuityHash,
      receiptHash: receipt.receiptHash,
      selectedMoveId: receipt.selectedMove.id,
      receiptStatus: receipt.status,
      proofHash: receipt.observation.responseHash,
      observedMode: receipt.observation.mode
    },
    interpretation,
    publicTrace,
    nextTurn,
    memoryDraft: {
      canPersist: false,
      label: "shadow_loop_continuity_receipt_interpretation",
      evidenceHash: receipt.observation.responseHash,
      content: memoryContent
    },
    controls: {
      canRunContinuityReceiptObservation: status === "waiting-continuity-observation" && receipt.target.allowed,
      canRefreshContinuityWithObservedProof: status === "observed-continuity-proof",
      canPersistMemory: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/shadow-loop-continuity-receipt-interpreter",
      "/api/sports/decision/shadow-loop-continuity-receipt",
      "/api/sports/decision/shadow-loop-continuity",
      nextTurn.verifyUrl,
      ...receipt.proofUrls,
      ...continuity.proofUrls
    ]),
    locks: unique([
      "Continuity receipt interpreter output is a public trace only, not hidden chain-of-thought.",
      "It may recommend one read-only continuity receipt or continuity refresh route only.",
      "It cannot persist memory, write decisions, train models, apply weights, adjust probabilities, raise confidence, publish picks, stake, or upgrade public action.",
      ...receipt.locks,
      ...continuity.locks
    ])
  };
}
