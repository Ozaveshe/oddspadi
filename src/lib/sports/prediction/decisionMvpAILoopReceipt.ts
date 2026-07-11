import type { DecisionMvpAICritiqueLedger } from "@/lib/sports/prediction/decisionMvpAICritiqueLedger";
import type { DecisionMvpAIDecisionTurn } from "@/lib/sports/prediction/decisionMvpAIDecisionTurn";
import type { DecisionMvpAIProofCoordinator } from "@/lib/sports/prediction/decisionMvpAIProofCoordinator";
import type { DecisionMvpCognitiveCycle } from "@/lib/sports/prediction/decisionMvpCognitiveCycle";

export type DecisionMvpAILoopReceiptStatus = "waiting-review" | "waiting-provider" | "ready-next-proof" | "hold" | "blocked";
export type DecisionMvpAILoopReceiptMove = "request-review" | "resolve-provider-keys" | "observe-selected-proof" | "repair-blocker" | "hold";

export type DecisionMvpAILoopReceipt = {
  mode: "decision-mvp-ai-loop-receipt";
  generatedAt: string;
  date: string;
  sport: DecisionMvpCognitiveCycle["sport"];
  status: DecisionMvpAILoopReceiptStatus;
  loopHash: string;
  summary: string;
  loop: {
    iteration: 1;
    activePhase: DecisionMvpAIDecisionTurn["turn"]["phase"];
    selectedMove: DecisionMvpAILoopReceiptMove;
    selectedProof: string;
    continuation: "continue-readonly" | "wait" | "stop";
    readOnlyTurnsRemaining: number;
    stopReasons: string[];
    learningCandidate: string;
  };
  trace: Array<{
    id: string;
    label: string;
    status: "pass" | "watch" | "block";
    evidence: string;
    nextAction: string;
  }>;
  source: {
    cognitiveCycleHash: string;
    critiqueLedgerHash: string;
    proofCoordinatorHash: string;
    decisionTurnHash: string;
  };
  controls: {
    canInspectReadOnly: true;
    canContinueReadOnlyLoop: boolean;
    canRunSelectedProof: boolean;
    canCallOpenAI: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
    canUseHiddenChainOfThought: false;
  };
  nextAction: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
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

function compact(value: string | null | undefined, maxLength = 300): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No evidence available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function statusFor(decisionTurn: DecisionMvpAIDecisionTurn): DecisionMvpAILoopReceiptStatus {
  if (decisionTurn.status === "ready-readonly-proof") return "ready-next-proof";
  if (decisionTurn.status === "waiting-review") return "waiting-review";
  if (decisionTurn.status === "waiting-provider") return "waiting-provider";
  if (decisionTurn.status === "blocked") return "blocked";
  return "hold";
}

function moveFor(status: DecisionMvpAILoopReceiptStatus): DecisionMvpAILoopReceiptMove {
  if (status === "ready-next-proof") return "observe-selected-proof";
  if (status === "waiting-review") return "request-review";
  if (status === "waiting-provider") return "resolve-provider-keys";
  if (status === "blocked") return "repair-blocker";
  return "hold";
}

function summaryFor(status: DecisionMvpAILoopReceiptStatus, proof: string): string {
  if (status === "ready-next-proof") return `MVP AI loop can continue with one read-only proof: ${proof}.`;
  if (status === "waiting-review") return "MVP AI loop is waiting for the guarded review step before it can continue.";
  if (status === "waiting-provider") return "MVP AI loop is waiting for provider evidence before continuing.";
  if (status === "blocked") return `MVP AI loop stops on ${proof}; the next turn needs blocker repair.`;
  return `MVP AI loop holds on ${proof}; no continuation is currently safe.`;
}

function stopReasons({
  status,
  critiqueLedger,
  proofCoordinator,
  decisionTurn
}: {
  status: DecisionMvpAILoopReceiptStatus;
  critiqueLedger: DecisionMvpAICritiqueLedger;
  proofCoordinator: DecisionMvpAIProofCoordinator;
  decisionTurn: DecisionMvpAIDecisionTurn;
}): string[] {
  const reasons: string[] = [];
  if (status === "waiting-review") reasons.push("Guarded AI critique has not produced an applicable review for this loop.");
  if (status === "waiting-provider") reasons.push("Provider data is still missing for the selected proof.");
  if (status === "blocked") reasons.push(`Selected proof is blocked: ${proofCoordinator.selectedStep.label}.`);
  if (critiqueLedger.totals.block > 0) reasons.push(`Critique ledger has ${critiqueLedger.totals.block} blocking item(s).`);
  if (!decisionTurn.controls.canRunSelectedProof) reasons.push("Selected proof cannot run from this turn.");
  return unique(reasons, 8);
}

export function buildDecisionMvpAILoopReceipt({
  cognitiveCycle,
  critiqueLedger,
  proofCoordinator,
  decisionTurn,
  now = new Date()
}: {
  cognitiveCycle: DecisionMvpCognitiveCycle;
  critiqueLedger: DecisionMvpAICritiqueLedger;
  proofCoordinator: DecisionMvpAIProofCoordinator;
  decisionTurn: DecisionMvpAIDecisionTurn;
  now?: Date;
}): DecisionMvpAILoopReceipt {
  const status = statusFor(decisionTurn);
  const selectedMove = moveFor(status);
  const canContinue = status === "ready-next-proof" && decisionTurn.controls.canRunSelectedProof;
  const reasons = stopReasons({ status, critiqueLedger, proofCoordinator, decisionTurn });
  const selectedProof = decisionTurn.turn.selectedProof;
  const nextAction =
    canContinue
      ? decisionTurn.nextAction
      : {
          label: selectedMove === "request-review" ? "Request guarded review" : selectedMove === "resolve-provider-keys" ? "Resolve provider evidence" : selectedMove === "repair-blocker" ? "Repair blocker" : "Hold loop",
          command: null,
          verifyUrl: selectedMove === "request-review" ? "/api/sports/decision/mvp-ai-decision-turn?run=1" : decisionTurn.nextAction.verifyUrl,
          safeToRun: false,
          expectedEvidence: reasons[0] ?? decisionTurn.nextAction.expectedEvidence
        };
  const trace = [
    {
      id: "observe-turn",
      label: "Observe decision turn",
      status: "pass" as const,
      evidence: decisionTurn.turn.observation,
      nextAction: decisionTurn.turn.decision
    },
    {
      id: "proof-choice",
      label: "Check selected proof",
      status: proofCoordinator.selectedStep.status === "blocked" ? ("block" as const) : proofCoordinator.selectedStep.safeToRun ? ("pass" as const) : ("watch" as const),
      evidence: `${proofCoordinator.selectedStep.label}: ${proofCoordinator.selectedStep.status}.`,
      nextAction: proofCoordinator.selectedStep.expectedEvidence
    },
    {
      id: "critique-safety",
      label: "Check critique safety",
      status: critiqueLedger.totals.block > 0 ? ("block" as const) : critiqueLedger.totals.watch > 0 ? ("watch" as const) : ("pass" as const),
      evidence: critiqueLedger.summary,
      nextAction: critiqueLedger.nextAction.expectedEvidence
    },
    {
      id: "continuation-budget",
      label: "Check continuation budget",
      status: canContinue ? ("pass" as const) : ("watch" as const),
      evidence: canContinue ? "One read-only continuation is available." : "Read-only continuation is closed until the selected proof is safe.",
      nextAction: canContinue ? "Run the selected proof once." : nextAction.expectedEvidence
    }
  ];

  return {
    mode: "decision-mvp-ai-loop-receipt",
    generatedAt: now.toISOString(),
    date: decisionTurn.date,
    sport: decisionTurn.sport,
    status,
    loopHash: stableHash({
      status,
      selectedMove,
      cognitive: [cognitiveCycle.cycleHash, cognitiveCycle.status, cognitiveCycle.activeStage?.id],
      critique: [critiqueLedger.ledgerHash, critiqueLedger.status, critiqueLedger.totals.block],
      coordinator: [proofCoordinator.coordinatorHash, proofCoordinator.status, proofCoordinator.selectedStep.id],
      turn: [decisionTurn.turnHash, decisionTurn.status, decisionTurn.turn.phase],
      trace: trace.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status, selectedProof),
    loop: {
      iteration: 1,
      activePhase: decisionTurn.turn.phase,
      selectedMove,
      selectedProof,
      continuation: canContinue ? "continue-readonly" : status === "blocked" ? "stop" : "wait",
      readOnlyTurnsRemaining: canContinue ? 1 : 0,
      stopReasons: reasons,
      learningCandidate: compact(
        canContinue
          ? `If ${selectedProof} returns evidence, compare it to the doubt: ${decisionTurn.turn.doubt}`
          : `No learning candidate can be promoted until: ${reasons[0] ?? "the selected proof clears"}`,
        300
      )
    },
    trace,
    source: {
      cognitiveCycleHash: cognitiveCycle.cycleHash,
      critiqueLedgerHash: critiqueLedger.ledgerHash,
      proofCoordinatorHash: proofCoordinator.coordinatorHash,
      decisionTurnHash: decisionTurn.turnHash
    },
    controls: {
      canInspectReadOnly: true,
      canContinueReadOnlyLoop: canContinue,
      canRunSelectedProof: canContinue,
      canCallOpenAI: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    nextAction,
    proofUrls: unique([
      "/api/sports/decision/mvp-ai-loop-receipt",
      ...decisionTurn.proofUrls,
      ...proofCoordinator.proofUrls,
      ...critiqueLedger.proofUrls,
      ...cognitiveCycle.proofUrls
    ]),
    locks: unique([
      "MVP AI loop receipt may continue only one read-only proof turn at a time.",
      "Loop receipt cannot call OpenAI, fetch providers, write provider rows, persist decisions, train, publish, stake, adjust probabilities, raise confidence, or expose hidden chain-of-thought.",
      "Loop receipt can only wait, stop, hold, or request same-or-safer proof repair.",
      ...decisionTurn.locks,
      ...proofCoordinator.locks,
      ...critiqueLedger.locks,
      ...cognitiveCycle.locks
    ])
  };
}
