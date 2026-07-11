import type { DecisionMvpAnswerAuthorityGate } from "@/lib/sports/prediction/decisionMvpAnswerAuthorityGate";
import type { DecisionMvpEvidenceAcquisitionQueue } from "@/lib/sports/prediction/decisionMvpEvidenceAcquisitionQueue";
import type { DecisionMvpLiveActivationBridge } from "@/lib/sports/prediction/decisionMvpLiveActivationBridge";
import type { DecisionMvpProgressSnapshot } from "@/lib/sports/prediction/decisionMvpProgressSnapshot";
import type { DecisionMvpProviderProofReceipt } from "@/lib/sports/prediction/decisionMvpProviderProofReceipt";
import type { DecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpReasoningCheckpointStatus = "waiting-evidence" | "ready-readonly" | "ready-shadow-review" | "blocked";
export type DecisionMvpReasoningCheckpointSignalStatus = "support" | "watch" | "block";

export type DecisionMvpReasoningCheckpoint = {
  mode: "decision-mvp-reasoning-checkpoint";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpReasoningCheckpointStatus;
  checkpointHash: string;
  summary: string;
  focus: {
    matchId: string | null;
    match: string | null;
    selection: string | null;
    baselineAction: string | null;
    publicPosture: "locked" | "monitor-only" | "shadow-review";
    confidence: number;
  };
  publicReasoning: {
    workingBelief: string;
    primaryDoubt: string;
    nextQuestion: string;
    falsifier: string;
    safeAlternative: string;
  };
  signals: Array<{
    id: "slate-belief" | "provider-proof" | "live-bridge" | "evidence-queue" | "answer-authority" | "launch-progress";
    label: string;
    status: DecisionMvpReasoningCheckpointSignalStatus;
    evidence: string;
    nextAction: string;
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

function signalStatus(blocked: boolean, watch: boolean): DecisionMvpReasoningCheckpointSignalStatus {
  if (blocked) return "block";
  if (watch) return "watch";
  return "support";
}

function statusFor(signals: DecisionMvpReasoningCheckpoint["signals"], answerAuthorityGate: DecisionMvpAnswerAuthorityGate): DecisionMvpReasoningCheckpointStatus {
  if (!signals.length || signals.some((signal) => signal.status === "block")) return "blocked";
  if (answerAuthorityGate.status === "ready-shadow-review") return "ready-shadow-review";
  if (signals.some((signal) => signal.status === "support")) return "ready-readonly";
  return "waiting-evidence";
}

function summaryFor(status: DecisionMvpReasoningCheckpointStatus, match: string | null): string {
  if (status === "ready-shadow-review") return `MVP reasoning can prepare a shadow review for ${match ?? "the slate"}, but public action stays locked.`;
  if (status === "ready-readonly") return `MVP reasoning has a safe next read-only proof for ${match ?? "the slate"}.`;
  if (status === "waiting-evidence") return `MVP reasoning is waiting for evidence before the next belief can move.`;
  return `MVP reasoning is blocked by provider, storage, OpenAI, or promotion authority evidence.`;
}

export function buildDecisionMvpReasoningCheckpoint({
  date,
  sport,
  slateThinking,
  evidenceQueue,
  liveActivationBridge,
  providerProofReceipt,
  answerAuthorityGate,
  mvpProgressSnapshot,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  slateThinking: DecisionSlateThinking;
  evidenceQueue: DecisionMvpEvidenceAcquisitionQueue;
  liveActivationBridge: DecisionMvpLiveActivationBridge;
  providerProofReceipt: DecisionMvpProviderProofReceipt;
  answerAuthorityGate: DecisionMvpAnswerAuthorityGate;
  mvpProgressSnapshot: DecisionMvpProgressSnapshot;
  now?: Date;
}): DecisionMvpReasoningCheckpoint {
  const thought = slateThinking.nextThought;
  const selectedGate = answerAuthorityGate.selectedGate;
  const nextEvidence = evidenceQueue.nextItem;
  const nextBridgeRun = liveActivationBridge.nextRun.safeToRun ? liveActivationBridge.nextRun : null;
  const rawSignals: DecisionMvpReasoningCheckpoint["signals"] = [
    {
      id: "slate-belief",
      label: "Slate belief",
      status: signalStatus(Boolean(!thought || thought.blockers.length), slateThinking.status !== "clear"),
      evidence: thought ? thought.synthesis : slateThinking.summary,
      nextAction: thought?.nextEvidenceAction ?? "Create at least one slate thought from current matches.",
      proofUrl: slateThinking.policy.verificationUrl
    },
    {
      id: "provider-proof",
      label: "Provider proof",
      status: signalStatus(providerProofReceipt.status === "waiting-provider-key" || providerProofReceipt.status === "blocked" || providerProofReceipt.status === "provider-error", providerProofReceipt.status !== "proof-observed"),
      evidence: providerProofReceipt.summary,
      nextAction: providerProofReceipt.interpretation.nextAction,
      proofUrl: "/api/sports/decision/mvp-provider-proof-receipt"
    },
    {
      id: "live-bridge",
      label: "Live activation bridge",
      status: signalStatus(
        liveActivationBridge.status === "waiting-football-key" || liveActivationBridge.status === "waiting-odds-key" || liveActivationBridge.status === "provider-error" || liveActivationBridge.status === "blocked",
        liveActivationBridge.status !== "ready-storage-review"
      ),
      evidence: liveActivationBridge.summary,
      nextAction: liveActivationBridge.nextRun.expectedEvidence,
      proofUrl: "/api/sports/decision/mvp-live-activation-bridge"
    },
    {
      id: "evidence-queue",
      label: "Evidence queue",
      status: signalStatus(evidenceQueue.status === "blocked", evidenceQueue.status !== "ready-readonly"),
      evidence: evidenceQueue.summary,
      nextAction: nextEvidence?.expectedBeliefChange ?? evidenceQueue.locks[0],
      proofUrl: "/api/sports/decision/mvp-evidence-acquisition-queue"
    },
    {
      id: "answer-authority",
      label: "Answer authority",
      status: signalStatus(answerAuthorityGate.status === "blocked" || answerAuthorityGate.status.startsWith("waiting-"), answerAuthorityGate.status !== "ready-shadow-review"),
      evidence: answerAuthorityGate.summary,
      nextAction: answerAuthorityGate.nextAction.detail,
      proofUrl: "/api/sports/decision/mvp-answer-authority-gate"
    },
    {
      id: "launch-progress",
      label: "Launch progress",
      status: signalStatus(mvpProgressSnapshot.percentages.liveProduction < 25, mvpProgressSnapshot.status !== "local-mvp-ready"),
      evidence: mvpProgressSnapshot.summary,
      nextAction: mvpProgressSnapshot.lanes.find((lane) => lane.status !== "done")?.nextAction ?? mvpProgressSnapshot.epl2026.nextAction,
      proofUrl: "/api/sports/decision/mvp-progress-snapshot"
    }
  ];
  const signals: DecisionMvpReasoningCheckpoint["signals"] = rawSignals.map((signal) => ({
    ...signal,
    evidence: compact(signal.evidence, 230),
    nextAction: compact(signal.nextAction, 220)
  }));
  const status = statusFor(signals, answerAuthorityGate);
  const bridgeOrEvidenceCommand = nextBridgeRun?.command ?? nextEvidence?.command ?? null;
  const bridgeOrEvidenceProof = nextBridgeRun?.proofUrl ?? nextEvidence?.proofUrl ?? selectedGate?.proofUrl ?? "/api/sports/decision/mvp-reasoning-checkpoint";
  const bridgeOrEvidenceLabel = nextBridgeRun?.label ?? nextEvidence?.label ?? (selectedGate ? `Clear ${selectedGate.label}` : "Inspect MVP reasoning checkpoint");
  const nextMove = {
    label: bridgeOrEvidenceLabel,
    proofUrl: bridgeOrEvidenceProof,
    command: bridgeOrEvidenceCommand,
    safeToRun: Boolean(nextBridgeRun?.safeToRun || nextEvidence?.safeToRun),
    expectedEvidence: compact(
      nextBridgeRun?.expectedEvidence ??
        nextEvidence?.expectedBeliefChange ??
        selectedGate?.nextAction ??
        "Inspect the current public-safe reasoning state before any authority change.",
      260
    )
  };

  return {
    mode: "decision-mvp-reasoning-checkpoint",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    checkpointHash: stableHash({
      date,
      sport,
      status,
      slate: [slateThinking.thinkingHash, thought?.id, thought?.status, thought?.pressure],
      evidence: [evidenceQueue.queueHash, evidenceQueue.status, nextEvidence?.id],
      bridge: [liveActivationBridge.bridgeHash, liveActivationBridge.status, liveActivationBridge.nextRun.laneId],
      receipt: [providerProofReceipt.receiptHash, providerProofReceipt.status],
      authority: [answerAuthorityGate.authorityHash, answerAuthorityGate.status],
      progress: [mvpProgressSnapshot.status, mvpProgressSnapshot.percentages, mvpProgressSnapshot.lanes.map((lane) => [lane.id, lane.status, lane.percent])]
    }),
    summary: summaryFor(status, thought?.match ?? null),
    focus: {
      matchId: thought?.matchId ?? null,
      match: thought?.match ?? null,
      selection: thought?.selection ?? null,
      baselineAction: thought?.baselineAction ?? null,
      publicPosture: answerAuthorityGate.publicAnswer.mode,
      confidence: thought?.confidenceScore ?? 0
    },
    publicReasoning: {
      workingBelief: compact(thought?.thesis ?? slateThinking.summary, 260),
      primaryDoubt: compact(thought?.counterThesis ?? providerProofReceipt.summary, 260),
      nextQuestion: compact(thought?.nextEvidenceAction ?? liveActivationBridge.nextRun.expectedEvidence, 240),
      falsifier: compact(selectedGate?.detail ?? liveActivationBridge.summary, 240),
      safeAlternative: compact(thought?.saferAlternatives[0] ?? "Keep analysis monitor-only until provider, storage, OpenAI, and promotion proof all clear.", 240)
    },
    signals,
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
      "/api/sports/decision/mvp-reasoning-checkpoint",
      slateThinking.policy.verificationUrl,
      "/api/sports/decision/mvp-evidence-acquisition-queue",
      "/api/sports/decision/mvp-live-activation-bridge",
      "/api/sports/decision/mvp-provider-proof-receipt",
      "/api/sports/decision/mvp-answer-authority-gate",
      bridgeOrEvidenceProof,
      ...evidenceQueue.proofUrls,
      ...liveActivationBridge.proofUrls,
      ...providerProofReceipt.proofUrls,
      ...answerAuthorityGate.proofUrls,
      ...mvpProgressSnapshot.proofUrls
    ]),
    locks: unique([
      "MVP reasoning checkpoint exposes public-safe reasoning only; it never reveals hidden chain-of-thought.",
      "The checkpoint can select the next read-only proof but cannot write provider rows, persist decisions, train models, apply learned weights, raise confidence, publish picks, or stake.",
      "A positive belief remains monitor-only until provider proof, storage/corpus, OpenAI review, backtests, and answer-promotion authority clear.",
      ...evidenceQueue.locks,
      ...liveActivationBridge.locks,
      ...providerProofReceipt.locks,
      ...answerAuthorityGate.locks
    ])
  };
}
