import type { DecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { DecisionEvidenceRefreshScheduler } from "@/lib/sports/prediction/decisionEvidenceRefreshScheduler";
import type { DecisionEvidenceRefreshReceipt, DecisionEvidenceRefreshVerifier } from "@/lib/sports/prediction/decisionEvidenceRefreshVerifier";
import type { DecisionModelTrust } from "@/lib/sports/prediction/decisionModelTrust";
import type { DecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import type { DecisionPortfolioRisk } from "@/lib/sports/prediction/decisionPortfolioRisk";
import type { DecisionSignalReliability } from "@/lib/sports/prediction/decisionSignalReliability";
import type { Sport } from "@/lib/sports/types";

export type DecisionEvidenceTransitionStatus = "advance-ready" | "retry-proof" | "hold" | "blocked";
export type DecisionEvidenceTransitionAction = "advance" | "retry-proof" | "hold" | "reduce-trust";
export type DecisionEvidenceTransitionGateStatus = "pass" | "watch" | "block";
export type DecisionEvidenceTransitionNextStatus = "complete" | "ready" | "waiting" | "blocked";

export type DecisionEvidenceTransitionGate = {
  id: string;
  label: string;
  status: DecisionEvidenceTransitionGateStatus;
  detail: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionEvidenceTransitionNext = {
  label: string;
  status: DecisionEvidenceTransitionNextStatus;
  command: string | null;
  verifyUrl: string;
  expectedEvidence: string;
  canRunNow: boolean;
  blockedBy: string[];
};

export type DecisionEvidenceTransition = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionEvidenceTransitionStatus;
  transitionHash: string;
  summary: string;
  decision: {
    action: DecisionEvidenceTransitionAction;
    reason: string;
    nextCommand: string | null;
    verifyUrl: string;
    confidenceEffect: "no-change" | "cap-low" | "keep-capped";
    trustEffect: "advance-shadow-proof" | "retry-proof" | "hold" | "reduce";
    publishEffect: "locked";
    trainEffect: "locked";
  };
  nextTransition: DecisionEvidenceTransitionNext;
  gates: DecisionEvidenceTransitionGate[];
  counts: {
    pass: number;
    watch: number;
    block: number;
  };
  runtimeEvidence: {
    scheduler: string;
    verifier: string;
    signalReliability: string;
    dataIntake: string;
    modelTrust: string;
    portfolioRisk: string;
    oddsBoard: string;
  };
  policy: {
    canAdvanceReadOnly: boolean;
    canRunNextProof: boolean;
    canRaiseTrust: false;
    canWrite: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    rule: string;
    forbiddenActions: string[];
  };
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

function unique(values: Array<string | null | undefined>, limit = 8): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function safeProofCommand(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (lower.includes("persist=1") || lower.includes("persist=true")) return false;
  if (lower.includes("dryrun=0") || lower.includes("dryrun=false")) return false;
  if ((lower.includes("-x post") || lower.includes("-xpost")) && !lower.includes("dryrun=1") && !lower.includes("dryrun=true")) return false;
  return true;
}

function gate(input: DecisionEvidenceTransitionGate): DecisionEvidenceTransitionGate {
  return {
    ...input,
    evidence: unique(input.evidence, 5)
  };
}

function statusForDataIntake(queue: DecisionDataIntakeQueue): DecisionEvidenceTransitionGateStatus {
  if (queue.status === "ready") return "pass";
  if (queue.status === "waiting") return "watch";
  return "block";
}

function statusForSignal(reliability: DecisionSignalReliability): DecisionEvidenceTransitionGateStatus {
  if (reliability.status === "ready") return "pass";
  if (reliability.status === "degraded") return "watch";
  return "block";
}

function statusForTrust(trust: DecisionModelTrust): DecisionEvidenceTransitionGateStatus {
  if (trust.status === "trusted-shadow") return "pass";
  if (trust.status === "needs-evidence") return "watch";
  return "block";
}

function statusForPortfolio(portfolio: DecisionPortfolioRisk): DecisionEvidenceTransitionGateStatus {
  if (portfolio.status === "paper-ready") return "pass";
  if (portfolio.status === "needs-review") return "watch";
  return "block";
}

function statusForOddsBoard(board: DecisionOddsBoard): DecisionEvidenceTransitionGateStatus {
  if (board.status === "value-found") return "pass";
  if (board.status === "watchlist") return "watch";
  return "block";
}

function receiptIsRunnable(receipt: DecisionEvidenceRefreshReceipt): boolean {
  return receipt.status === "ready-to-check" && receipt.safeToRun && safeProofCommand(receipt.nextCheck);
}

function chooseRunnableReceipt(verifier: DecisionEvidenceRefreshVerifier): DecisionEvidenceRefreshReceipt | null {
  return verifier.receipts.find(receiptIsRunnable) ?? null;
}

function chooseNextReceipt(verifier: DecisionEvidenceRefreshVerifier): DecisionEvidenceRefreshReceipt | null {
  return chooseRunnableReceipt(verifier) ?? verifier.nextReceipt;
}

function transitionStatusForReceipt(receipt: DecisionEvidenceRefreshReceipt | null, verifier: DecisionEvidenceRefreshVerifier): DecisionEvidenceTransitionNextStatus {
  if (!receipt) return verifier.status === "verified" ? "complete" : "waiting";
  if (receipt.status === "verified") return "complete";
  if (receipt.status === "ready-to-check") return receiptIsRunnable(receipt) ? "ready" : "blocked";
  if (receipt.status === "waiting") return "waiting";
  return "blocked";
}

function nextTransitionFor(verifier: DecisionEvidenceRefreshVerifier): DecisionEvidenceTransitionNext {
  const receipt = chooseNextReceipt(verifier);
  const status = transitionStatusForReceipt(receipt, verifier);
  if (!receipt) {
    return {
      label: "All evidence receipts verified",
      status,
      command: null,
      verifyUrl: verifier.policy.verificationUrl,
      expectedEvidence: "Evidence receipts remain verified on the next refresh-verification run.",
      canRunNow: false,
      blockedBy: []
    };
  }

  const canRunNow = receiptIsRunnable(receipt);
  return {
    label: receipt.label,
    status,
    command: canRunNow ? receipt.nextCheck : null,
    verifyUrl: receipt.verifyUrl,
    expectedEvidence: receipt.expectedEvidence,
    canRunNow,
    blockedBy: canRunNow ? [] : unique([...receipt.missingEnv, receipt.safeToRun ? null : "Unsafe or write-gated proof command", receipt.proof])
  };
}

function buildGates({
  scheduler,
  verifier,
  signalReliability,
  dataIntake,
  modelTrust,
  portfolioRisk,
  oddsBoard
}: {
  scheduler: DecisionEvidenceRefreshScheduler;
  verifier: DecisionEvidenceRefreshVerifier;
  signalReliability: DecisionSignalReliability;
  dataIntake: DecisionDataIntakeQueue;
  modelTrust: DecisionModelTrust;
  portfolioRisk: DecisionPortfolioRisk;
  oddsBoard: DecisionOddsBoard;
}): DecisionEvidenceTransitionGate[] {
  const runnableReceipt = chooseRunnableReceipt(verifier);
  const nextReceipt = chooseNextReceipt(verifier);
  return [
    gate({
      id: "refresh-scheduler",
      label: "Refresh scheduler",
      status: scheduler.policy.canRunReadOnly ? "pass" : scheduler.status === "waiting" ? "watch" : "block",
      detail: scheduler.summary,
      evidence: [scheduler.refreshHash, `${scheduler.totals.ready} ready`, `${scheduler.totals.blocked} blocked`, `${scheduler.totals.safeToRun} safe`],
      nextAction: scheduler.nextTask?.command ?? "Refresh scheduler has no pending proof task."
    }),
    gate({
      id: "evidence-receipts",
      label: "Evidence receipts",
      status: verifier.status === "verified" ? "pass" : verifier.counts.readyToCheck || verifier.counts.waiting ? "watch" : "block",
      detail: verifier.summary,
      evidence: [verifier.verificationHash, `${verifier.counts.verified} verified`, `${verifier.counts.readyToCheck} ready`, `${verifier.counts.blocked} blocked`],
      nextAction: runnableReceipt?.nextCheck ?? nextReceipt?.nextCheck ?? "Keep all receipts attached to the decision run."
    }),
    gate({
      id: "safe-proof-command",
      label: "Safe proof command",
      status: runnableReceipt ? "pass" : verifier.status === "verified" ? "pass" : "block",
      detail: runnableReceipt
        ? `${runnableReceipt.label} can be checked with a read-only or dry-run-safe command.`
        : verifier.status === "verified"
          ? "No proof command is needed because all visible receipts are verified."
          : "No runnable proof command is available from the current receipts.",
      evidence: [runnableReceipt?.nextCheck ?? nextReceipt?.nextCheck ?? "", `receipt:${nextReceipt?.status ?? "none"}`],
      nextAction: runnableReceipt?.nextCheck ?? "Wait for provider/admin/Supabase prerequisites before running this proof."
    }),
    gate({
      id: "signal-reliability",
      label: "Signal reliability",
      status: statusForSignal(signalReliability),
      detail: signalReliability.summary,
      evidence: [signalReliability.reliabilityHash, `${signalReliability.reliabilityScore}/100`, `${signalReliability.totals.requiredGaps} required gaps`],
      nextAction: signalReliability.nextSignal?.nextAction ?? "Keep signal proofs fresh."
    }),
    gate({
      id: "data-intake",
      label: "Data intake",
      status: statusForDataIntake(dataIntake),
      detail: dataIntake.summary,
      evidence: [`${dataIntake.coverageScore}/100 coverage`, `${dataIntake.readyItems} ready`, `${dataIntake.blockedItems} blocked`],
      nextAction: dataIntake.nextItem?.command ?? "Keep data-intake provider proof current."
    }),
    gate({
      id: "model-trust",
      label: "Model trust",
      status: statusForTrust(modelTrust),
      detail: modelTrust.summary,
      evidence: [modelTrust.trustHash, `${modelTrust.trustScore}/100`, `${modelTrust.counts.block} block gates`],
      nextAction: modelTrust.nextActions[0] ?? "Keep model-trust proof current."
    }),
    gate({
      id: "portfolio-pressure",
      label: "Portfolio pressure",
      status: statusForPortfolio(portfolioRisk),
      detail: portfolioRisk.summary,
      evidence: [portfolioRisk.portfolioHash, `${portfolioRisk.totals.capped} capped`, `${portfolioRisk.totals.excluded} excluded`],
      nextAction: portfolioRisk.policy.verificationUrl
    }),
    gate({
      id: "odds-board",
      label: "Odds board",
      status: statusForOddsBoard(oddsBoard),
      detail: oddsBoard.summary,
      evidence: [oddsBoard.boardHash, `${oddsBoard.totals.value} value`, `${oddsBoard.totals.watch} watch`, `${oddsBoard.totals.avoid} avoid`],
      nextAction: oddsBoard.policy.verificationUrl
    })
  ];
}

function decisionAction({
  verifier,
  runnableReceipt,
  gates
}: {
  verifier: DecisionEvidenceRefreshVerifier;
  runnableReceipt: DecisionEvidenceRefreshReceipt | null;
  gates: DecisionEvidenceTransitionGate[];
}): DecisionEvidenceTransitionAction {
  const hasBlockingGate = gates.some((item) => item.status === "block");
  const allHardGatesPass = gates.every((item) => item.status === "pass");
  if (verifier.status === "verified" && allHardGatesPass) return "advance";
  if (runnableReceipt) return "retry-proof";
  if (hasBlockingGate || verifier.status === "blocked") return "reduce-trust";
  return "hold";
}

function statusForAction(action: DecisionEvidenceTransitionAction): DecisionEvidenceTransitionStatus {
  if (action === "advance") return "advance-ready";
  if (action === "retry-proof") return "retry-proof";
  if (action === "reduce-trust") return "blocked";
  return "hold";
}

function reasonFor(action: DecisionEvidenceTransitionAction, next: DecisionEvidenceTransitionNext): string {
  if (action === "advance") return "All visible proof gates pass, so the engine may advance to the next read-only shadow proof state.";
  if (action === "retry-proof") return `${next.label} is safe to recheck now; rerun it before changing confidence, persistence, publishing, or training state.`;
  if (action === "reduce-trust") return `${next.label} is blocked or unsafe, so trust remains capped and the next state must be evidence repair.`;
  return `${next.label} is waiting for external/operator evidence; hold the current decision state.`;
}

function runtimeEvidence({
  scheduler,
  verifier,
  signalReliability,
  dataIntake,
  modelTrust,
  portfolioRisk,
  oddsBoard
}: {
  scheduler: DecisionEvidenceRefreshScheduler;
  verifier: DecisionEvidenceRefreshVerifier;
  signalReliability: DecisionSignalReliability;
  dataIntake: DecisionDataIntakeQueue;
  modelTrust: DecisionModelTrust;
  portfolioRisk: DecisionPortfolioRisk;
  oddsBoard: DecisionOddsBoard;
}): DecisionEvidenceTransition["runtimeEvidence"] {
  return {
    scheduler: `${scheduler.status}: ${scheduler.totals.ready} ready, ${scheduler.totals.safeToRun} safe, ${scheduler.totals.blocked} blocked.`,
    verifier: `${verifier.status}: ${verifier.counts.verified} verified, ${verifier.counts.readyToCheck} ready, ${verifier.counts.blocked} blocked.`,
    signalReliability: `${signalReliability.status}: ${signalReliability.reliabilityScore}/100, ${signalReliability.totals.requiredGaps} required gaps.`,
    dataIntake: `${dataIntake.status}: ${dataIntake.coverageScore}/100 coverage, ${dataIntake.blockedItems} blocked item(s).`,
    modelTrust: `${modelTrust.status}: ${modelTrust.trustScore}/100, ${modelTrust.counts.block} block gate(s).`,
    portfolioRisk: `${portfolioRisk.status}: ${portfolioRisk.totals.candidates} candidate(s), ${portfolioRisk.totals.capped} capped.`,
    oddsBoard: `${oddsBoard.status}: ${oddsBoard.totals.value} value, ${oddsBoard.totals.watch} watch, ${oddsBoard.totals.avoid} avoid.`
  };
}

export function buildDecisionEvidenceTransition({
  scheduler,
  verifier,
  signalReliability,
  dataIntake,
  modelTrust,
  portfolioRisk,
  oddsBoard,
  now = new Date()
}: {
  scheduler: DecisionEvidenceRefreshScheduler;
  verifier: DecisionEvidenceRefreshVerifier;
  signalReliability: DecisionSignalReliability;
  dataIntake: DecisionDataIntakeQueue;
  modelTrust: DecisionModelTrust;
  portfolioRisk: DecisionPortfolioRisk;
  oddsBoard: DecisionOddsBoard;
  now?: Date;
}): DecisionEvidenceTransition {
  const gates = buildGates({ scheduler, verifier, signalReliability, dataIntake, modelTrust, portfolioRisk, oddsBoard });
  const runnableReceipt = chooseRunnableReceipt(verifier);
  const nextTransition = nextTransitionFor(verifier);
  const action = decisionAction({ verifier, runnableReceipt, gates });
  const status = statusForAction(action);
  const pass = gates.filter((item) => item.status === "pass").length;
  const watch = gates.filter((item) => item.status === "watch").length;
  const block = gates.filter((item) => item.status === "block").length;
  const transitionHash = stableHash({
    scheduler: scheduler.refreshHash,
    verifier: verifier.verificationHash,
    action,
    status,
    next: [nextTransition.label, nextTransition.status, nextTransition.canRunNow],
    gates: gates.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date: scheduler.date,
    sport: scheduler.sport,
    status,
    transitionHash,
    summary:
      status === "advance-ready"
        ? "Evidence transition is advance-ready for the next read-only shadow state; write, publish, persist, and train remain locked."
        : status === "retry-proof"
          ? `Evidence transition selected a safe proof retry: ${nextTransition.label}.`
          : status === "hold"
            ? `Evidence transition is holding until ${nextTransition.label} changes state.`
            : `Evidence transition is blocked at ${nextTransition.label}; trust must stay reduced until proof clears.`,
    decision: {
      action,
      reason: reasonFor(action, nextTransition),
      nextCommand: nextTransition.command,
      verifyUrl: nextTransition.verifyUrl,
      confidenceEffect: action === "advance" ? "no-change" : action === "reduce-trust" ? "cap-low" : "keep-capped",
      trustEffect: action === "advance" ? "advance-shadow-proof" : action === "retry-proof" ? "retry-proof" : action === "reduce-trust" ? "reduce" : "hold",
      publishEffect: "locked",
      trainEffect: "locked"
    },
    nextTransition,
    gates,
    counts: { pass, watch, block },
    runtimeEvidence: runtimeEvidence({ scheduler, verifier, signalReliability, dataIntake, modelTrust, portfolioRisk, oddsBoard }),
    policy: {
      canAdvanceReadOnly: action === "advance",
      canRunNextProof: nextTransition.canRunNow,
      canRaiseTrust: false,
      canWrite: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      rule:
        "Evidence transition may choose advance, retry-proof, hold, or reduce-trust from verified proof receipts only. It cannot raise trust, write to Supabase, persist decisions, publish picks, or train models.",
      forbiddenActions: [
        "Do not raise confidence from a retry-proof or blocked transition.",
        "Do not persist decision runs until Supabase service and publishable keys pass readiness.",
        "Do not run write-mode provider imports from an evidence transition command.",
        "Do not publish or train from a transition packet."
      ]
    }
  };
}
