import type { DecisionOperatorReceipt } from "@/lib/sports/prediction/decisionOperatorReceipt";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type DecisionOperatorStateStatus = "pending-proof" | "proof-observed" | "advance-shadow" | "needs-repair" | "blocked";
export type DecisionOperatorStateGateStatus = "pass" | "watch" | "block";

export type DecisionOperatorStateGate = {
  id: string;
  label: string;
  status: DecisionOperatorStateGateStatus;
  evidence: string[];
  nextAction: string;
};

export type DecisionOperatorState = {
  generatedAt: string;
  date: string;
  sport: DecisionOperatorReceipt["sport"];
  mode: "operator-state-transition";
  status: DecisionOperatorStateStatus;
  stateHash: string;
  summary: string;
  input: {
    turnHash: string;
    receiptHash: string;
    receiptStatus: DecisionOperatorReceipt["status"];
    proofStatus: string | null;
    proofHash: string | null;
  };
  statePatch: {
    confidence: DecisionOperatorReceipt["statePatch"]["confidence"];
    trust: DecisionOperatorReceipt["statePatch"]["trust"];
    authorizedAction: DecisionOperatorReceipt["statePatch"]["authorizedAction"];
    publicPosture: DecisionOperatorReceipt["statePatch"]["publicPosture"];
    mayAdvanceReadOnly: boolean;
    mayAskAI: boolean;
    mayPersist: false;
    mayPublish: false;
    mayTrain: false;
  };
  interpretation: {
    label: string;
    reason: string;
    evidence: string[];
    nextMove: string;
  };
  gates: DecisionOperatorStateGate[];
  nextTurn: {
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
  };
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string | null;
    content: string;
  };
  locks: string[];
  proofUrls: string[];
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

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function signalNumber(signals: string[], key: string): number | null {
  const pattern = new RegExp(`${key}=([0-9]+)`, "i");
  for (const signal of signals) {
    const match = signal.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

function hasBlockingEvidence(receipt: DecisionOperatorReceipt): boolean {
  const status = receipt.observation.statusLabel?.toLowerCase() ?? "";
  const blocks = signalNumber(receipt.observation.signals, "block");
  return status.includes("block") || (blocks != null && blocks > 0);
}

function hasWatchEvidence(receipt: DecisionOperatorReceipt): boolean {
  const status = receipt.observation.statusLabel?.toLowerCase() ?? "";
  const watches = signalNumber(receipt.observation.signals, "watch");
  return status.includes("watch") || status.includes("needs") || (watches != null && watches > 0);
}

function statusFor(receipt: DecisionOperatorReceipt): DecisionOperatorStateStatus {
  if (receipt.status === "not-run") return "pending-proof";
  if (receipt.status === "blocked") return "blocked";
  if (receipt.status === "failed" || receipt.status === "observed-warning") return "needs-repair";
  if (hasBlockingEvidence(receipt) || hasWatchEvidence(receipt)) return "proof-observed";
  return "advance-shadow";
}

function trustPatch(receipt: DecisionOperatorReceipt, status: DecisionOperatorStateStatus): DecisionOperatorReceipt["statePatch"]["trust"] {
  if (status === "advance-shadow") return receipt.statePatch.trust;
  if (status === "needs-repair" || status === "blocked") return "reduce";
  return "hold";
}

function confidencePatch(receipt: DecisionOperatorReceipt, status: DecisionOperatorStateStatus): DecisionOperatorReceipt["statePatch"]["confidence"] {
  if (status === "advance-shadow") return receipt.statePatch.confidence;
  if (status === "needs-repair" || status === "blocked") return "cap-low";
  return "keep-capped";
}

function gate(input: DecisionOperatorStateGate): DecisionOperatorStateGate {
  return {
    ...input,
    evidence: unique(input.evidence, 5),
    nextAction: compact(input.nextAction)
  };
}

function buildGates(receipt: DecisionOperatorReceipt, status: DecisionOperatorStateStatus): DecisionOperatorStateGate[] {
  return [
    gate({
      id: "proof-target",
      label: "Proof target",
      status: receipt.target.allowed ? "pass" : "block",
      evidence: unique([receipt.target.path, receipt.target.reason]),
      nextAction: receipt.target.allowed ? "Keep observing only this approved local proof route." : receipt.target.reason
    }),
    gate({
      id: "proof-observation",
      label: "Proof observation",
      status: receipt.status === "verified" ? "pass" : receipt.status === "not-run" ? "watch" : "block",
      evidence: unique([receipt.observation.responseHash, receipt.observation.statusLabel, receipt.observation.error]),
      nextAction:
        receipt.status === "verified"
          ? "Use the response hash as the current proof receipt."
          : receipt.status === "not-run"
            ? "Request operator-receipt with run=1 to observe the proof."
            : receipt.verification.fallbackAction
    }),
    gate({
      id: "blocker-pressure",
      label: "Blocker pressure",
      status: hasBlockingEvidence(receipt) ? "block" : hasWatchEvidence(receipt) ? "watch" : "pass",
      evidence: receipt.observation.signals,
      nextAction: hasBlockingEvidence(receipt)
        ? "Keep trust capped and route the next turn toward the highest blocker."
        : hasWatchEvidence(receipt)
          ? "Keep the state in proof-observed mode until watch signals clear."
          : "Read-only shadow advance may be considered."
    }),
    gate({
      id: "side-effects",
      label: "Side effects",
      status: receipt.permissions.canExecuteShell || receipt.permissions.canPersist || receipt.permissions.canPublish || receipt.permissions.canTrain ? "block" : "pass",
      evidence: [
        `shell:${receipt.permissions.canExecuteShell}`,
        `persist:${receipt.permissions.canPersist}`,
        `publish:${receipt.permissions.canPublish}`,
        `train:${receipt.permissions.canTrain}`
      ],
      nextAction: "Keep shell execution, persistence, publishing, and training locked for this transition."
    }),
    gate({
      id: "state-advance",
      label: "State advance",
      status: status === "advance-shadow" ? "pass" : status === "pending-proof" || status === "proof-observed" ? "watch" : "block",
      evidence: [status, receipt.statePatch.authorizedAction, receipt.statePatch.publicPosture],
      nextAction:
        status === "advance-shadow"
          ? "Allow only a read-only shadow advance, then rerun operator-turn."
          : status === "proof-observed"
            ? "Record the proof as observed, keep confidence capped, and rerun the next safe operator turn."
            : status === "pending-proof"
              ? "Observe the proof receipt before changing state."
              : "Repair the failed or unsafe proof path before changing state."
    })
  ];
}

function interpretationFor(receipt: DecisionOperatorReceipt, status: DecisionOperatorStateStatus): DecisionOperatorState["interpretation"] {
  if (status === "advance-shadow") {
    return {
      label: "Shadow advance allowed",
      reason: "The proof receipt verified without blocker or watch pressure.",
      evidence: unique([receipt.observation.responseHash, receipt.observation.summary, ...receipt.observation.signals]),
      nextMove: "Rerun operator-turn and keep the transition read-only until persistence gates pass."
    };
  }
  if (status === "proof-observed") {
    return {
      label: "Proof observed, trust capped",
      reason: "The proof receipt was fetched successfully, but the observed response still reports blockers or watch signals.",
      evidence: unique([receipt.observation.responseHash, receipt.observation.summary, ...receipt.observation.signals]),
      nextMove: "Keep the current action conservative and route the next turn to blocker repair."
    };
  }
  if (status === "pending-proof") {
    return {
      label: "Proof pending",
      reason: "The proof target is approved, but the receipt has not been observed yet.",
      evidence: unique([receipt.target.path, receipt.target.reason]),
      nextMove: "Run operator-receipt with run=1 to produce an observed proof hash."
    };
  }
  if (status === "needs-repair") {
    return {
      label: "Proof needs repair",
      reason: receipt.observation.error ?? "The proof response was not clean enough to update state.",
      evidence: unique([receipt.observation.responseHash, receipt.observation.statusLabel, ...receipt.observation.signals]),
      nextMove: receipt.verification.fallbackAction
    };
  }
  return {
    label: "State transition blocked",
    reason: receipt.target.reason,
    evidence: unique([receipt.target.path, ...receipt.verification.failureSignals]),
    nextMove: "Return to operator-turn and select a safe local proof route."
  };
}

function summaryFor(status: DecisionOperatorStateStatus, receipt: DecisionOperatorReceipt): string {
  if (status === "advance-shadow") return `Operator state may advance in read-only shadow mode after receipt ${receipt.receiptHash}.`;
  if (status === "proof-observed") return `Operator state observed proof ${receipt.observation.responseHash ?? receipt.receiptHash}, but trust stays capped.`;
  if (status === "needs-repair") return "Operator state needs repair because the proof receipt failed or returned a warning.";
  if (status === "blocked") return "Operator state is blocked because the selected proof target is unsafe or unavailable.";
  return "Operator state is waiting for an observed receipt before changing belief.";
}

export function buildDecisionOperatorState({
  receipt,
  now = new Date()
}: {
  receipt: DecisionOperatorReceipt;
  now?: Date;
}): DecisionOperatorState {
  const status = statusFor(receipt);
  const gates = buildGates(receipt, status);
  const interpretation = interpretationFor(receipt, status);
  const statePatch = {
    confidence: confidencePatch(receipt, status),
    trust: trustPatch(receipt, status),
    authorizedAction: receipt.statePatch.authorizedAction,
    publicPosture: receipt.statePatch.publicPosture,
    mayAdvanceReadOnly: status === "advance-shadow",
    mayAskAI: false,
    mayPersist: false,
    mayPublish: false,
    mayTrain: false
  } satisfies DecisionOperatorState["statePatch"];
  const stateHash = stableHash({
    date: receipt.date,
    sport: receipt.sport,
    turnHash: receipt.turnHash,
    receiptHash: receipt.receiptHash,
    status,
    patch: statePatch,
    gates: gates.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date: receipt.date,
    sport: receipt.sport,
    mode: "operator-state-transition",
    status,
    stateHash,
    summary: summaryFor(status, receipt),
    input: {
      turnHash: receipt.turnHash,
      receiptHash: receipt.receiptHash,
      receiptStatus: receipt.status,
      proofStatus: receipt.observation.statusLabel,
      proofHash: receipt.observation.responseHash
    },
    statePatch,
    interpretation,
    gates,
    nextTurn: {
      label: status === "pending-proof" ? "Observe receipt" : "Rerun operator turn",
      command:
        status === "pending-proof"
          ? decisionCurlCommand(`/api/sports/decision/operator-receipt?date=${encodeURIComponent(receipt.date)}&sport=${encodeURIComponent(receipt.sport)}&run=1`)
          : decisionCurlCommand(`/api/sports/decision/operator-turn?date=${encodeURIComponent(receipt.date)}&sport=${encodeURIComponent(receipt.sport)}`),
      verifyUrl: status === "pending-proof" ? "/api/sports/decision/operator-receipt" : "/api/sports/decision/operator-turn",
      safeToRun: true
    },
    memoryDraft: {
      canPersist: false,
      label: "Operator proof observation",
      evidenceHash: receipt.observation.responseHash,
      content: `${interpretation.label}: ${interpretation.reason}`
    },
    locks: unique([
      ...receipt.locks,
      "Operator state may only update read-only shadow belief until Supabase, outcome, and training gates pass.",
      "Do not persist the memory draft until write approval is explicit."
    ], 16),
    proofUrls: unique(["/api/sports/decision/operator-state", ...receipt.proofUrls])
  };
}
