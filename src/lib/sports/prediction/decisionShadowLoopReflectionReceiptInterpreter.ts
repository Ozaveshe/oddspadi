import type { DecisionShadowLoopReflection } from "@/lib/sports/prediction/decisionShadowLoopReflection";
import type { DecisionShadowLoopReflectionReceipt } from "@/lib/sports/prediction/decisionShadowLoopReflectionReceipt";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type DecisionShadowLoopReflectionReceiptInterpreterStatus = "waiting-observation" | "observed-reflection-proof" | "needs-repair" | "blocked";
export type DecisionShadowLoopReflectionReceiptTraceStatus = "pass" | "watch" | "block";

export type DecisionShadowLoopReflectionReceiptTrace = {
  id: "select" | "observe" | "interpret" | "guard" | "decide" | "learn";
  label: string;
  status: DecisionShadowLoopReflectionReceiptTraceStatus;
  publicReason: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionShadowLoopReflectionReceiptInterpreter = {
  generatedAt: string;
  date: string;
  sport: DecisionShadowLoopReflection["sport"];
  mode: "decision-shadow-loop-reflection-receipt-interpreter";
  status: DecisionShadowLoopReflectionReceiptInterpreterStatus;
  interpreterHash: string;
  summary: string;
  input: {
    reflectionHash: string;
    receiptHash: string;
    selectedMoveId: string | null;
    receiptStatus: DecisionShadowLoopReflectionReceipt["status"];
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
  publicTrace: DecisionShadowLoopReflectionReceiptTrace[];
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
    canRunReflectionReceiptObservation: boolean;
    canReflectOnObservedProof: boolean;
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

function unique(values: Array<string | null | undefined>, limit = 28): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function hasSignal(receipt: DecisionShadowLoopReflectionReceipt, pattern: RegExp): boolean {
  return receipt.observation.signals.some((signal) => pattern.test(signal)) || Boolean(receipt.observation.statusLabel && pattern.test(receipt.observation.statusLabel));
}

function statusFor(receipt: DecisionShadowLoopReflectionReceipt): DecisionShadowLoopReflectionReceiptInterpreterStatus {
  if (receipt.status === "blocked") return "blocked";
  if (receipt.status === "failed" || receipt.status === "observed-warning") return "needs-repair";
  if (receipt.status === "verified") {
    return hasSignal(receipt, /block|fail|error|persist:true|adjust:true|publish:true|train:true|stake:true/i) ? "needs-repair" : "observed-reflection-proof";
  }
  return "waiting-observation";
}

function traceItem(input: DecisionShadowLoopReflectionReceiptTrace): DecisionShadowLoopReflectionReceiptTrace {
  return {
    ...input,
    publicReason: compact(input.publicReason),
    evidence: unique(input.evidence, 7),
    nextAction: compact(input.nextAction)
  };
}

function buildTrace({
  reflection,
  receipt,
  status
}: {
  reflection: DecisionShadowLoopReflection;
  receipt: DecisionShadowLoopReflectionReceipt;
  status: DecisionShadowLoopReflectionReceiptInterpreterStatus;
}): DecisionShadowLoopReflectionReceiptTrace[] {
  return [
    traceItem({
      id: "select",
      label: "Reflected move",
      status: reflection.nextMove.safeToRun ? "pass" : "block",
      publicReason: reflection.nextMove.reason,
      evidence: unique([reflection.reflectionHash, reflection.nextMove.id, reflection.nextMove.verifyUrl, reflection.status]),
      nextAction: reflection.nextMove.safeToRun ? "Keep the reflected move as the only observable target." : "Hold until reflection selects a safe read-only move."
    }),
    traceItem({
      id: "observe",
      label: "Reflected observation",
      status: receipt.status === "verified" ? "pass" : receipt.status === "not-run" ? "watch" : "block",
      publicReason: receipt.summary,
      evidence: unique([receipt.receiptHash, receipt.status, receipt.observation.responseHash, receipt.observation.statusLabel, receipt.observation.mode]),
      nextAction:
        receipt.status === "not-run"
          ? "Run the shadow loop reflection receipt with run=1."
          : receipt.status === "verified"
            ? "Use the reflected receipt hash as public proof."
            : receipt.verification.fallbackAction
    }),
    traceItem({
      id: "interpret",
      label: "Reflection receipt interpretation",
      status: status === "observed-reflection-proof" ? "pass" : status === "waiting-observation" ? "watch" : "block",
      publicReason:
        status === "observed-reflection-proof"
          ? "The reflected observation completed without blocker signals."
          : status === "waiting-observation"
            ? "The reflection selected an approved local target, but no reflected observation has been run."
            : "The reflected observation needs repair before the loop can continue.",
      evidence: unique([receipt.observation.summary, ...receipt.observation.signals]),
      nextAction: status === "observed-reflection-proof" ? "Reflect again with the observed proof hash." : "Keep the loop capped until observation or repair completes."
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
      publicReason: "The reflection receipt interpreter keeps shell, persistence, training, learned weights, probability changes, publishing, staking, and public action upgrades locked.",
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
      nextAction: "Continue only in read-only shadow-loop mode."
    }),
    traceItem({
      id: "decide",
      label: "Next reflected move",
      status: status === "blocked" || status === "needs-repair" ? "block" : "watch",
      publicReason:
        status === "observed-reflection-proof"
          ? "The loop can ask reflection to recompute from observed proof, but public action remains unchanged."
          : status === "waiting-observation"
            ? "The loop should observe the reflection-selected target before recomputing reflection."
            : "The loop should repair or replace the reflected proof target before continuing.",
      evidence: unique([status, receipt.target.path, receipt.target.reason, receipt.selectedMove.id]),
      nextAction:
        status === "observed-reflection-proof"
          ? "Run the shadow loop reflection with observed proof."
          : status === "waiting-observation"
            ? "Observe the approved reflected target once."
            : "Repair the reflected proof path."
    }),
    traceItem({
      id: "learn",
      label: "Reflection memory",
      status: "watch",
      publicReason: "The interpreter drafts a reflected memory note but cannot persist it until outcome, training, and promotion gates pass.",
      evidence: unique([receipt.observation.responseHash, receipt.receiptHash, reflection.reflectionHash]),
      nextAction: "Keep the memory draft local to this response."
    })
  ];
}

function interpretationFor(
  status: DecisionShadowLoopReflectionReceiptInterpreterStatus,
  receipt: DecisionShadowLoopReflectionReceipt
): DecisionShadowLoopReflectionReceiptInterpreter["interpretation"] {
  if (status === "observed-reflection-proof") {
    return {
      learned: compact(receipt.observation.summary ?? "The reflection-selected read-only target responded successfully."),
      risk: "Reflected proof can trigger another reflection only; it cannot change the public pick, probability, confidence, or stake.",
      nextAction: "Reflect again using the observed reflected receipt hash.",
      confidenceEffect: "shadow-only",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  if (status === "waiting-observation") {
    return {
      learned: "The reflection selected an approved proof target, but no reflected observation has been run.",
      risk: "Without a reflected receipt hash, the loop must not claim the reflected move was observed.",
      nextAction: "Run one shadow loop reflection receipt observation.",
      confidenceEffect: "keep-capped",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  return {
    learned: compact(receipt.observation.error ?? receipt.target.reason),
    risk: "The reflected proof path is blocked or unreliable, so the loop must repair evidence before continuing.",
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
  sport: DecisionShadowLoopReflection["sport"];
  receipt: DecisionShadowLoopReflectionReceipt;
  status: DecisionShadowLoopReflectionReceiptInterpreterStatus;
}): DecisionShadowLoopReflectionReceiptInterpreter["nextTurn"] {
  if (status === "waiting-observation" && receipt.target.allowed) {
    const verifyUrl = `/api/sports/decision/shadow-loop-reflection-receipt?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&run=1`;
    return {
      label: "Observe reflected loop move",
      command: decisionCurlCommand(verifyUrl),
      verifyUrl,
      safeToRun: true
    };
  }
  if (status === "observed-reflection-proof") {
    const verifyUrl = `/api/sports/decision/shadow-loop-reflection?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&run=1`;
    return {
      label: "Reflect again with observed proof",
      command: decisionCurlCommand(verifyUrl),
      verifyUrl,
      safeToRun: true
    };
  }
  return {
    label: "Repair reflected proof path",
    command: null,
    verifyUrl: receipt.target.path ?? "/api/sports/decision/shadow-loop-reflection",
    safeToRun: false
  };
}

function summaryFor(
  status: DecisionShadowLoopReflectionReceiptInterpreterStatus,
  interpretation: DecisionShadowLoopReflectionReceiptInterpreter["interpretation"]
): string {
  if (status === "observed-reflection-proof") return `Shadow reflection receipt interpreter learned: ${interpretation.learned}`;
  if (status === "waiting-observation") return "Shadow reflection receipt interpreter is waiting for the reflected move to be observed.";
  if (status === "needs-repair") return "Shadow reflection receipt interpreter needs proof repair before the loop can continue.";
  return "Shadow reflection receipt interpreter is blocked by an unsafe or unavailable reflected target.";
}

export function buildDecisionShadowLoopReflectionReceiptInterpreter({
  reflection,
  receipt,
  now = new Date()
}: {
  reflection: DecisionShadowLoopReflection;
  receipt: DecisionShadowLoopReflectionReceipt;
  now?: Date;
}): DecisionShadowLoopReflectionReceiptInterpreter {
  const status = statusFor(receipt);
  const interpretation = interpretationFor(status, receipt);
  const publicTrace = buildTrace({ reflection, receipt, status });
  const nextTurn = nextTurnFor({ date: reflection.date, sport: reflection.sport, receipt, status });
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
    date: reflection.date,
    sport: reflection.sport,
    reflection: reflection.reflectionHash,
    receipt: receipt.receiptHash,
    status,
    proof: receipt.observation.responseHash,
    trace: publicTrace.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date: reflection.date,
    sport: reflection.sport,
    mode: "decision-shadow-loop-reflection-receipt-interpreter",
    status,
    interpreterHash,
    summary: summaryFor(status, interpretation),
    input: {
      reflectionHash: reflection.reflectionHash,
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
      label: "shadow_loop_reflection_receipt_interpretation",
      evidenceHash: receipt.observation.responseHash,
      content: memoryContent
    },
    controls: {
      canRunReflectionReceiptObservation: status === "waiting-observation" && receipt.target.allowed,
      canReflectOnObservedProof: status === "observed-reflection-proof",
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
      "/api/sports/decision/shadow-loop-reflection-receipt-interpreter",
      "/api/sports/decision/shadow-loop-reflection-receipt",
      "/api/sports/decision/shadow-loop-reflection",
      nextTurn.verifyUrl,
      ...receipt.proofUrls,
      ...reflection.proofUrls
    ]),
    locks: unique([
      "Reflection receipt interpreter output is a public trace only, not hidden chain-of-thought.",
      "It may recommend one read-only reflection receipt or reflection refresh route only.",
      "It cannot persist memory, write decisions, train models, apply weights, adjust probabilities, raise confidence, publish picks, stake, or upgrade public action.",
      ...receipt.locks,
      ...reflection.locks
    ])
  };
}
