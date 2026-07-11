import type { DecisionShadowLoopGovernor } from "@/lib/sports/prediction/decisionShadowLoopGovernor";
import type { DecisionShadowLoopReceipt } from "@/lib/sports/prediction/decisionShadowLoopReceipt";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type DecisionShadowLoopInterpreterStatus = "waiting-observation" | "observed-governed-proof" | "needs-repair" | "blocked";
export type DecisionShadowLoopInterpreterTraceStatus = "pass" | "watch" | "block";

export type DecisionShadowLoopInterpreterTrace = {
  id: "select" | "observe" | "interpret" | "guard" | "decide" | "learn";
  label: string;
  status: DecisionShadowLoopInterpreterTraceStatus;
  publicReason: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionShadowLoopInterpreter = {
  generatedAt: string;
  date: string;
  sport: DecisionShadowLoopGovernor["sport"];
  mode: "decision-shadow-loop-interpreter";
  status: DecisionShadowLoopInterpreterStatus;
  interpreterHash: string;
  summary: string;
  input: {
    governorHash: string;
    receiptHash: string;
    selectedIntentId: string | null;
    receiptStatus: DecisionShadowLoopReceipt["status"];
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
  publicTrace: DecisionShadowLoopInterpreterTrace[];
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
    canRunLoopReceiptObservation: boolean;
    canRefreshGovernorWithObservedProof: boolean;
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

function hasSignal(receipt: DecisionShadowLoopReceipt, pattern: RegExp): boolean {
  return receipt.observation.signals.some((signal) => pattern.test(signal)) || Boolean(receipt.observation.statusLabel && pattern.test(receipt.observation.statusLabel));
}

function statusFor(receipt: DecisionShadowLoopReceipt): DecisionShadowLoopInterpreterStatus {
  if (receipt.status === "blocked") return "blocked";
  if (receipt.status === "failed" || receipt.status === "observed-warning") return "needs-repair";
  if (receipt.status === "verified") {
    return hasSignal(receipt, /block|fail|error|persist:true|adjust:true|publish:true|train:true|stake:true/i) ? "needs-repair" : "observed-governed-proof";
  }
  return "waiting-observation";
}

function traceItem(input: DecisionShadowLoopInterpreterTrace): DecisionShadowLoopInterpreterTrace {
  return {
    ...input,
    publicReason: compact(input.publicReason),
    evidence: unique(input.evidence, 7),
    nextAction: compact(input.nextAction)
  };
}

function buildTrace({
  governor,
  receipt,
  status
}: {
  governor: DecisionShadowLoopGovernor;
  receipt: DecisionShadowLoopReceipt;
  status: DecisionShadowLoopInterpreterStatus;
}): DecisionShadowLoopInterpreterTrace[] {
  return [
    traceItem({
      id: "select",
      label: "Governed intent",
      status: governor.selectedIntent.safeToRun ? "pass" : "block",
      publicReason: governor.selectedIntent.rationale,
      evidence: unique([governor.governorHash, governor.selectedIntent.id, governor.selectedIntent.verifyUrl, governor.status]),
      nextAction: governor.selectedIntent.safeToRun ? "Keep the selected intent as the only governable target." : "Hold the loop until a safe intent is selected."
    }),
    traceItem({
      id: "observe",
      label: "Governed observation",
      status: receipt.status === "verified" ? "pass" : receipt.status === "not-run" ? "watch" : "block",
      publicReason: receipt.summary,
      evidence: unique([receipt.receiptHash, receipt.status, receipt.observation.responseHash, receipt.observation.statusLabel, receipt.observation.mode]),
      nextAction:
        receipt.status === "not-run"
          ? "Run the shadow loop receipt with run=1."
          : receipt.status === "verified"
            ? "Use the governed receipt hash as public proof."
            : receipt.verification.fallbackAction
    }),
    traceItem({
      id: "interpret",
      label: "Loop interpretation",
      status: status === "observed-governed-proof" ? "pass" : status === "waiting-observation" ? "watch" : "block",
      publicReason:
        status === "observed-governed-proof"
          ? "The governed observation completed without blocker signals."
          : status === "waiting-observation"
            ? "The governor selected an approved local target, but no governed observation has been run."
            : "The governed observation needs repair before the loop can advance.",
      evidence: unique([receipt.observation.summary, ...receipt.observation.signals]),
      nextAction: status === "observed-governed-proof" ? "Refresh the governor with observed proof." : "Keep the loop capped until observation or repair completes."
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
      publicReason: "The loop interpreter keeps shell, persistence, training, learned weights, probability changes, publishing, staking, and public action upgrades locked.",
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
      label: "Next loop move",
      status: status === "blocked" || status === "needs-repair" ? "block" : "watch",
      publicReason:
        status === "observed-governed-proof"
          ? "The loop can ask the governor to evaluate the observed proof, but public action remains unchanged."
          : status === "waiting-observation"
            ? "The loop should observe the governor-selected target before refreshing its decision."
            : "The loop should repair or replace the selected target before continuing.",
      evidence: unique([status, receipt.target.path, receipt.target.reason, receipt.selectedIntent.id]),
      nextAction:
        status === "observed-governed-proof"
          ? "Run the shadow loop governor with observed proof."
          : status === "waiting-observation"
            ? "Observe the approved governor target once."
            : "Repair the governed proof path."
    }),
    traceItem({
      id: "learn",
      label: "Governed memory",
      status: "watch",
      publicReason: "The interpreter drafts a memory note but cannot persist it until outcome, training, and promotion gates pass.",
      evidence: unique([receipt.observation.responseHash, receipt.receiptHash, governor.governorHash]),
      nextAction: "Keep the memory draft local to this response."
    })
  ];
}

function interpretationFor(status: DecisionShadowLoopInterpreterStatus, receipt: DecisionShadowLoopReceipt): DecisionShadowLoopInterpreter["interpretation"] {
  if (status === "observed-governed-proof") {
    return {
      learned: compact(receipt.observation.summary ?? "The governor-selected read-only target responded successfully."),
      risk: "Governed proof can refresh the next loop decision only; it cannot change the public pick, probability, confidence, or stake.",
      nextAction: "Refresh the shadow loop governor with the observed receipt.",
      confidenceEffect: "shadow-only",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  if (status === "waiting-observation") {
    return {
      learned: "The governor selected an approved proof target, but no governed observation has been run.",
      risk: "Without a governed receipt hash, the loop must not claim a fresh proof state.",
      nextAction: "Run one shadow loop receipt observation.",
      confidenceEffect: "keep-capped",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  return {
    learned: compact(receipt.observation.error ?? receipt.target.reason),
    risk: "The governed proof path is blocked or unreliable, so the loop must repair evidence before continuing.",
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
  sport: DecisionShadowLoopGovernor["sport"];
  receipt: DecisionShadowLoopReceipt;
  status: DecisionShadowLoopInterpreterStatus;
}): DecisionShadowLoopInterpreter["nextTurn"] {
  if (status === "waiting-observation" && receipt.target.allowed) {
    const verifyUrl = `/api/sports/decision/shadow-loop-receipt?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&run=1`;
    return {
      label: "Observe governed loop intent",
      command: decisionCurlCommand(verifyUrl),
      verifyUrl,
      safeToRun: true
    };
  }
  if (status === "observed-governed-proof") {
    const verifyUrl = `/api/sports/decision/shadow-loop-governor?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&run=1`;
    return {
      label: "Refresh governor with observed proof",
      command: decisionCurlCommand(verifyUrl),
      verifyUrl,
      safeToRun: true
    };
  }
  return {
    label: "Repair governed proof path",
    command: null,
    verifyUrl: receipt.target.path ?? "/api/sports/decision/shadow-loop-governor",
    safeToRun: false
  };
}

function summaryFor(status: DecisionShadowLoopInterpreterStatus, interpretation: DecisionShadowLoopInterpreter["interpretation"]): string {
  if (status === "observed-governed-proof") return `Shadow loop interpreter learned: ${interpretation.learned}`;
  if (status === "waiting-observation") return "Shadow loop interpreter is waiting for the governed receipt to be observed.";
  if (status === "needs-repair") return "Shadow loop interpreter needs proof repair before the loop can continue.";
  return "Shadow loop interpreter is blocked by an unsafe or unavailable governed target.";
}

export function buildDecisionShadowLoopInterpreter({
  governor,
  receipt,
  now = new Date()
}: {
  governor: DecisionShadowLoopGovernor;
  receipt: DecisionShadowLoopReceipt;
  now?: Date;
}): DecisionShadowLoopInterpreter {
  const status = statusFor(receipt);
  const interpretation = interpretationFor(status, receipt);
  const publicTrace = buildTrace({ governor, receipt, status });
  const nextTurn = nextTurnFor({ date: governor.date, sport: governor.sport, receipt, status });
  const memoryContent = compact(
    [
      `status:${status}`,
      `intent:${receipt.selectedIntent.id ?? "none"}`,
      `proof:${receipt.observation.responseHash ?? "pending"}`,
      `learned:${interpretation.learned}`,
      `risk:${interpretation.risk}`
    ].join(" | "),
    420
  );
  const interpreterHash = stableHash({
    date: governor.date,
    sport: governor.sport,
    governor: governor.governorHash,
    receipt: receipt.receiptHash,
    status,
    proof: receipt.observation.responseHash,
    trace: publicTrace.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date: governor.date,
    sport: governor.sport,
    mode: "decision-shadow-loop-interpreter",
    status,
    interpreterHash,
    summary: summaryFor(status, interpretation),
    input: {
      governorHash: governor.governorHash,
      receiptHash: receipt.receiptHash,
      selectedIntentId: receipt.selectedIntent.id,
      receiptStatus: receipt.status,
      proofHash: receipt.observation.responseHash,
      observedMode: receipt.observation.mode
    },
    interpretation,
    publicTrace,
    nextTurn,
    memoryDraft: {
      canPersist: false,
      label: "shadow_loop_interpretation",
      evidenceHash: receipt.observation.responseHash,
      content: memoryContent
    },
    controls: {
      canRunLoopReceiptObservation: status === "waiting-observation" && receipt.target.allowed,
      canRefreshGovernorWithObservedProof: status === "observed-governed-proof",
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
      "/api/sports/decision/shadow-loop-interpreter",
      "/api/sports/decision/shadow-loop-receipt",
      "/api/sports/decision/shadow-loop-governor",
      nextTurn.verifyUrl,
      ...receipt.proofUrls,
      ...governor.proofUrls
    ]),
    locks: unique([
      "Loop interpreter output is a public trace only, not hidden chain-of-thought.",
      "It may recommend one read-only loop receipt or governor refresh route only.",
      "It cannot persist memory, write decisions, train models, apply weights, adjust probabilities, raise confidence, publish picks, stake, or upgrade public action.",
      ...receipt.locks,
      ...governor.locks
    ])
  };
}
