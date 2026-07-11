import type { DecisionMvpAnswerAuthorityGate } from "@/lib/sports/prediction/decisionMvpAnswerAuthorityGate";
import type { DecisionMvpLiveActivationBridge } from "@/lib/sports/prediction/decisionMvpLiveActivationBridge";
import type { DecisionMvpProgressSnapshot } from "@/lib/sports/prediction/decisionMvpProgressSnapshot";
import type { DecisionMvpProviderProofReceipt } from "@/lib/sports/prediction/decisionMvpProviderProofReceipt";
import type { DecisionMvpReasoningCheckpoint } from "@/lib/sports/prediction/decisionMvpReasoningCheckpoint";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpBeliefRevisionLoopStatus =
  | "hold-provider-key"
  | "hold-provider-proof"
  | "hold-authority"
  | "ready-readonly-revision"
  | "ready-shadow-revision"
  | "blocked";

export type DecisionMvpBeliefRevisionEntryStatus = "kept" | "lowered" | "held" | "blocked";

export type DecisionMvpBeliefRevisionLoop = {
  mode: "decision-mvp-belief-revision-loop";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpBeliefRevisionLoopStatus;
  loopHash: string;
  summary: string;
  revision: {
    targetMatch: string | null;
    targetSelection: string | null;
    baselineAction: string | null;
    publicPosture: "locked" | "monitor-only" | "shadow-review";
    trustCeiling: "locked" | "monitor-only" | "shadow-review";
    currentBelief: string;
    contradiction: string;
    revisionRule: string;
    changeMind: string;
    nextEvidence: string;
  };
  entries: Array<{
    id: "belief-state" | "provider-blocker" | "proof-receipt" | "authority-lock" | "progress-state" | "next-proof";
    label: string;
    status: DecisionMvpBeliefRevisionEntryStatus;
    evidence: string;
    revision: string;
    proofUrl: string;
  }>;
  nextMove: {
    label: string;
    proofUrl: string;
    command: string | null;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunNextReadOnlyProof: boolean;
    canAskOpenAI: false;
    canPersistDecisions: false;
    canWriteProviderRows: false;
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
  if (!normalized) return "No evidence available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 100): string[] {
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

function statusFor({
  checkpoint,
  liveActivationBridge,
  providerProofReceipt,
  answerAuthorityGate
}: {
  checkpoint: DecisionMvpReasoningCheckpoint;
  liveActivationBridge: DecisionMvpLiveActivationBridge;
  providerProofReceipt: DecisionMvpProviderProofReceipt;
  answerAuthorityGate: DecisionMvpAnswerAuthorityGate;
}): DecisionMvpBeliefRevisionLoopStatus {
  if (liveActivationBridge.status === "waiting-football-key" || liveActivationBridge.status === "waiting-odds-key" || providerProofReceipt.status === "waiting-provider-key") {
    return "hold-provider-key";
  }
  if (liveActivationBridge.status === "provider-error" || providerProofReceipt.status === "provider-error" || checkpoint.signals.some((signal) => signal.status === "block" && signal.id !== "provider-proof" && signal.id !== "live-bridge")) {
    return "blocked";
  }
  if (providerProofReceipt.status !== "proof-observed") return "hold-provider-proof";
  if (answerAuthorityGate.status === "ready-shadow-review" || checkpoint.status === "ready-shadow-review") return "ready-shadow-revision";
  if (answerAuthorityGate.status === "monitor-only" || checkpoint.status === "ready-readonly") return "ready-readonly-revision";
  if (answerAuthorityGate.status === "blocked") return "blocked";
  return "hold-authority";
}

function summaryFor(status: DecisionMvpBeliefRevisionLoopStatus, match: string | null): string {
  if (status === "ready-shadow-revision") return `Belief revision can prepare a shadow-only update for ${match ?? "the slate"}; public picks stay locked.`;
  if (status === "ready-readonly-revision") return `Belief revision can run the next read-only proof for ${match ?? "the slate"} without changing public action.`;
  if (status === "hold-provider-key") return "Belief revision is holding because live fixture or odds provider keys are still missing.";
  if (status === "hold-provider-proof") return "Belief revision is holding until provider dry-run proof is observed.";
  if (status === "hold-authority") return "Belief revision has evidence, but answer authority has not cleared a public-safe posture.";
  return "Belief revision is blocked by current proof, authority, or launch-progress evidence.";
}

function entryStatus(blocked: boolean, lowered: boolean, held: boolean): DecisionMvpBeliefRevisionEntryStatus {
  if (blocked) return "blocked";
  if (lowered) return "lowered";
  if (held) return "held";
  return "kept";
}

export function buildDecisionMvpBeliefRevisionLoop({
  date,
  sport,
  reasoningCheckpoint,
  liveActivationBridge,
  providerProofReceipt,
  answerAuthorityGate,
  mvpProgressSnapshot,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  reasoningCheckpoint: DecisionMvpReasoningCheckpoint;
  liveActivationBridge: DecisionMvpLiveActivationBridge;
  providerProofReceipt: DecisionMvpProviderProofReceipt;
  answerAuthorityGate: DecisionMvpAnswerAuthorityGate;
  mvpProgressSnapshot: DecisionMvpProgressSnapshot;
  now?: Date;
}): DecisionMvpBeliefRevisionLoop {
  const status = statusFor({ checkpoint: reasoningCheckpoint, liveActivationBridge, providerProofReceipt, answerAuthorityGate });
  const trustCeiling: DecisionMvpBeliefRevisionLoop["revision"]["trustCeiling"] =
    status === "ready-shadow-revision" ? "shadow-review" : status === "ready-readonly-revision" ? "monitor-only" : "locked";
  const providerSignal = reasoningCheckpoint.signals.find((signal) => signal.id === "provider-proof");
  const bridgeSignal = reasoningCheckpoint.signals.find((signal) => signal.id === "live-bridge");
  const authoritySignal = reasoningCheckpoint.signals.find((signal) => signal.id === "answer-authority");
  const progressSignal = reasoningCheckpoint.signals.find((signal) => signal.id === "launch-progress");
  const contradiction = compact(
    providerProofReceipt.status !== "proof-observed"
      ? providerProofReceipt.summary
      : authoritySignal?.evidence ?? reasoningCheckpoint.publicReasoning.primaryDoubt,
    280
  );
  const changeMind = compact(
    status === "hold-provider-key"
      ? liveActivationBridge.minimum.nextMissingEnvName
        ? `Configure ${liveActivationBridge.minimum.nextMissingEnvName}, restart, then rerun provider proof.`
        : liveActivationBridge.summary
      : status === "hold-provider-proof"
        ? providerProofReceipt.interpretation.nextAction
        : status === "hold-authority"
          ? answerAuthorityGate.nextAction.detail
          : reasoningCheckpoint.publicReasoning.falsifier,
    280
  );
  const nextMove = {
    ...reasoningCheckpoint.nextMove,
    safeToRun: reasoningCheckpoint.nextMove.safeToRun && (status === "ready-readonly-revision" || status === "ready-shadow-revision")
  };
  const entries: DecisionMvpBeliefRevisionLoop["entries"] = [
    {
      id: "belief-state",
      label: "Belief state",
      status: entryStatus(false, trustCeiling === "locked", false),
      evidence: compact(reasoningCheckpoint.publicReasoning.workingBelief, 220),
      revision:
        trustCeiling === "locked"
          ? "Lower trust ceiling to locked; do not treat the belief as actionable."
          : "Keep the belief available for public-safe inspection only.",
      proofUrl: "/api/sports/decision/mvp-reasoning-checkpoint"
    },
    {
      id: "provider-blocker",
      label: "Provider blocker",
      status: entryStatus(status === "blocked", status === "hold-provider-key", status === "hold-provider-proof"),
      evidence: compact(bridgeSignal?.evidence ?? liveActivationBridge.summary, 220),
      revision:
        status === "hold-provider-key"
          ? "Hold belief revision until fixture and odds provider keys exist."
          : "Keep provider evidence in the revision ledger.",
      proofUrl: "/api/sports/decision/mvp-live-activation-bridge"
    },
    {
      id: "proof-receipt",
      label: "Proof receipt",
      status: entryStatus(providerProofReceipt.status === "provider-error" || providerProofReceipt.status === "blocked", providerProofReceipt.status !== "proof-observed", providerProofReceipt.status === "ready-dry-run" || providerProofReceipt.status === "not-run"),
      evidence: compact(providerSignal?.evidence ?? providerProofReceipt.summary, 220),
      revision:
        providerProofReceipt.status === "proof-observed"
          ? "Provider proof can be carried forward to storage review."
          : "Do not let model confidence rise without observed provider dry-run proof.",
      proofUrl: "/api/sports/decision/mvp-provider-proof-receipt"
    },
    {
      id: "authority-lock",
      label: "Authority lock",
      status: entryStatus(answerAuthorityGate.status === "blocked", answerAuthorityGate.publicAnswer.mode === "locked", answerAuthorityGate.status.startsWith("waiting-")),
      evidence: compact(authoritySignal?.evidence ?? answerAuthorityGate.summary, 220),
      revision:
        answerAuthorityGate.publicAnswer.mode === "locked"
          ? "Keep public answer locked; the loop may only explain uncertainty."
          : "Respect the current monitor/shadow posture and do not publish picks.",
      proofUrl: "/api/sports/decision/mvp-answer-authority-gate"
    },
    {
      id: "progress-state",
      label: "Progress state",
      status: entryStatus(mvpProgressSnapshot.percentages.liveProduction < 25, mvpProgressSnapshot.status !== "local-mvp-ready", false),
      evidence: compact(progressSignal?.evidence ?? mvpProgressSnapshot.summary, 220),
      revision: "Use launch progress as a trust ceiling; technical MVP progress is not live-production authority.",
      proofUrl: "/api/sports/decision/mvp-progress-snapshot"
    },
    {
      id: "next-proof",
      label: "Next proof",
      status: nextMove.safeToRun ? "kept" : "held",
      evidence: compact(nextMove.expectedEvidence, 220),
      revision: nextMove.safeToRun ? "The next proof may run read-only." : "Hold execution until the selected proof is safe and unblocked.",
      proofUrl: nextMove.proofUrl
    }
  ];

  return {
    mode: "decision-mvp-belief-revision-loop",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    loopHash: stableHash({
      date,
      sport,
      status,
      checkpoint: [reasoningCheckpoint.checkpointHash, reasoningCheckpoint.status, reasoningCheckpoint.focus.matchId],
      bridge: [liveActivationBridge.bridgeHash, liveActivationBridge.status],
      receipt: [providerProofReceipt.receiptHash, providerProofReceipt.status],
      authority: [answerAuthorityGate.authorityHash, answerAuthorityGate.status, answerAuthorityGate.publicAnswer.mode],
      progress: [mvpProgressSnapshot.status, mvpProgressSnapshot.percentages.liveProduction],
      entries: entries.map((entry) => [entry.id, entry.status])
    }),
    summary: summaryFor(status, reasoningCheckpoint.focus.match),
    revision: {
      targetMatch: reasoningCheckpoint.focus.match,
      targetSelection: reasoningCheckpoint.focus.selection,
      baselineAction: reasoningCheckpoint.focus.baselineAction,
      publicPosture: answerAuthorityGate.publicAnswer.mode,
      trustCeiling,
      currentBelief: compact(reasoningCheckpoint.publicReasoning.workingBelief, 280),
      contradiction,
      revisionRule: "Keep, lower, or hold beliefs only; never raise confidence, probabilities, public action, staking, provider writes, or training from this loop.",
      changeMind,
      nextEvidence: compact(nextMove.expectedEvidence, 280)
    },
    entries,
    nextMove,
    controls: {
      canInspectReadOnly: true,
      canRunNextReadOnlyProof: nextMove.safeToRun,
      canAskOpenAI: false,
      canPersistDecisions: false,
      canWriteProviderRows: false,
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
    proofUrls: unique([
      "/api/sports/decision/mvp-belief-revision-loop",
      "/api/sports/decision/mvp-reasoning-checkpoint",
      "/api/sports/decision/mvp-live-activation-bridge",
      "/api/sports/decision/mvp-provider-proof-receipt",
      "/api/sports/decision/mvp-answer-authority-gate",
      "/api/sports/decision/mvp-progress-snapshot",
      nextMove.proofUrl,
      ...reasoningCheckpoint.proofUrls,
      ...liveActivationBridge.proofUrls,
      ...providerProofReceipt.proofUrls,
      ...answerAuthorityGate.proofUrls,
      ...mvpProgressSnapshot.proofUrls
    ]),
    locks: unique([
      "MVP belief revision loop is public-safe and does not expose hidden chain-of-thought.",
      "Belief revision can keep, lower, or hold a belief; it cannot raise confidence, adjust probabilities, publish picks, stake, train, persist, or write provider rows.",
      "Provider key, provider proof, authority, storage, OpenAI, and training blockers remain stronger than any model belief.",
      ...reasoningCheckpoint.locks,
      ...liveActivationBridge.locks,
      ...providerProofReceipt.locks,
      ...answerAuthorityGate.locks,
      ...mvpProgressSnapshot.blockers
    ])
  };
}
