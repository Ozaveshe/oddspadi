import type { DecisionMvpBeliefRevisionLoop } from "@/lib/sports/prediction/decisionMvpBeliefRevisionLoop";
import type { DecisionMvpEvidenceImpactMatrix } from "@/lib/sports/prediction/decisionMvpEvidenceImpactMatrix";
import type { DecisionMvpLiveActivationBridge } from "@/lib/sports/prediction/decisionMvpLiveActivationBridge";
import type { DecisionMvpProgressSnapshot } from "@/lib/sports/prediction/decisionMvpProgressSnapshot";
import type { DecisionMvpProviderProofReceipt } from "@/lib/sports/prediction/decisionMvpProviderProofReceipt";
import type { DecisionMvpReasoningCheckpoint } from "@/lib/sports/prediction/decisionMvpReasoningCheckpoint";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpCognitiveCycleStatus =
  | "waiting-provider-key"
  | "waiting-evidence-proof"
  | "holding-authority"
  | "ready-readonly-cycle"
  | "ready-shadow-cycle"
  | "blocked";

export type DecisionMvpCognitiveCycleStageId = "observe" | "orient" | "hypothesize" | "test" | "revise" | "act" | "learn";
export type DecisionMvpCognitiveCycleStageStatus = "pass" | "next" | "watch" | "locked" | "block";

export type DecisionMvpCognitiveCycleStage = {
  id: DecisionMvpCognitiveCycleStageId;
  label: string;
  status: DecisionMvpCognitiveCycleStageStatus;
  signal: string;
  decision: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionMvpCognitiveCycle = {
  mode: "decision-mvp-cognitive-cycle";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpCognitiveCycleStatus;
  cycleHash: string;
  summary: string;
  focus: {
    match: string | null;
    selection: string | null;
    publicPosture: "locked" | "monitor-only" | "shadow-review";
    trustCeiling: "locked" | "monitor-only" | "shadow-review";
    nextQuestion: string;
    nextProofUrl: string;
  };
  stages: DecisionMvpCognitiveCycleStage[];
  activeStage: DecisionMvpCognitiveCycleStage | null;
  nextTurn: {
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
  beliefRevisionLoop,
  evidenceImpactMatrix,
  liveActivationBridge,
  providerProofReceipt
}: {
  beliefRevisionLoop: DecisionMvpBeliefRevisionLoop;
  evidenceImpactMatrix: DecisionMvpEvidenceImpactMatrix;
  liveActivationBridge: DecisionMvpLiveActivationBridge;
  providerProofReceipt: DecisionMvpProviderProofReceipt;
}): DecisionMvpCognitiveCycleStatus {
  if (liveActivationBridge.status === "provider-error" || providerProofReceipt.status === "provider-error" || beliefRevisionLoop.status === "blocked") return "blocked";
  if (beliefRevisionLoop.status === "hold-provider-key" || evidenceImpactMatrix.status === "waiting-provider-key") return "waiting-provider-key";
  if (evidenceImpactMatrix.controls.canRunNextReadOnlyProof && beliefRevisionLoop.status === "ready-shadow-revision") return "ready-shadow-cycle";
  if (evidenceImpactMatrix.controls.canRunNextReadOnlyProof) return "ready-readonly-cycle";
  if (beliefRevisionLoop.status === "hold-authority") return "holding-authority";
  return "waiting-evidence-proof";
}

function summaryFor(status: DecisionMvpCognitiveCycleStatus, match: string | null): string {
  if (status === "ready-shadow-cycle") return `MVP cognitive cycle can run the next read-only shadow proof for ${match ?? "the slate"}.`;
  if (status === "ready-readonly-cycle") return `MVP cognitive cycle has a safe read-only next turn for ${match ?? "the slate"}.`;
  if (status === "waiting-provider-key") return "MVP cognitive cycle is waiting for provider keys before the next evidence test can run.";
  if (status === "waiting-evidence-proof") return "MVP cognitive cycle has a question, but proof is not yet safe to run.";
  if (status === "holding-authority") return "MVP cognitive cycle is holding because answer authority has not cleared the next posture.";
  return "MVP cognitive cycle is blocked by provider, proof, or authority evidence.";
}

function stage(input: DecisionMvpCognitiveCycleStage): DecisionMvpCognitiveCycleStage {
  return {
    ...input,
    signal: compact(input.signal, 220),
    decision: compact(input.decision, 220),
    nextAction: compact(input.nextAction, 220)
  };
}

export function buildDecisionMvpCognitiveCycle({
  date,
  sport,
  reasoningCheckpoint,
  beliefRevisionLoop,
  evidenceImpactMatrix,
  liveActivationBridge,
  providerProofReceipt,
  mvpProgressSnapshot,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  reasoningCheckpoint: DecisionMvpReasoningCheckpoint;
  beliefRevisionLoop: DecisionMvpBeliefRevisionLoop;
  evidenceImpactMatrix: DecisionMvpEvidenceImpactMatrix;
  liveActivationBridge: DecisionMvpLiveActivationBridge;
  providerProofReceipt: DecisionMvpProviderProofReceipt;
  mvpProgressSnapshot: DecisionMvpProgressSnapshot;
  now?: Date;
}): DecisionMvpCognitiveCycle {
  const status = statusFor({ beliefRevisionLoop, evidenceImpactMatrix, liveActivationBridge, providerProofReceipt });
  const nextImpact = evidenceImpactMatrix.nextImpact;
  const nextTurn = {
    label: nextImpact?.label ?? beliefRevisionLoop.nextMove.label,
    proofUrl: nextImpact?.proofUrl ?? beliefRevisionLoop.nextMove.proofUrl,
    command: nextImpact?.command ?? beliefRevisionLoop.nextMove.command,
    safeToRun: Boolean(nextImpact?.safeToRun && (status === "ready-readonly-cycle" || status === "ready-shadow-cycle")),
    expectedEvidence: compact(nextImpact?.expectedRevision ?? beliefRevisionLoop.nextMove.expectedEvidence, 260)
  };
  const stages: DecisionMvpCognitiveCycleStage[] = [
    stage({
      id: "observe",
      label: "Observe slate",
      status: reasoningCheckpoint.focus.match ? "pass" : "watch",
      signal: reasoningCheckpoint.publicReasoning.workingBelief,
      decision: reasoningCheckpoint.focus.match ? `Focus ${reasoningCheckpoint.focus.match}.` : "Keep observing until a slate focus exists.",
      nextAction: reasoningCheckpoint.publicReasoning.nextQuestion,
      proofUrl: "/api/sports/decision/mvp-reasoning-checkpoint"
    }),
    stage({
      id: "orient",
      label: "Orient around contradiction",
      status: beliefRevisionLoop.revision.trustCeiling === "locked" ? "block" : "pass",
      signal: beliefRevisionLoop.revision.contradiction,
      decision: `Trust ceiling is ${beliefRevisionLoop.revision.trustCeiling}.`,
      nextAction: beliefRevisionLoop.revision.changeMind,
      proofUrl: "/api/sports/decision/mvp-belief-revision-loop"
    }),
    stage({
      id: "hypothesize",
      label: "Choose belief test",
      status: nextImpact ? "pass" : "block",
      signal: nextImpact?.decisionQuestion ?? evidenceImpactMatrix.summary,
      decision: nextImpact ? `Rank #${nextImpact.rank} at ${nextImpact.impactScore}/100 impact.` : "No hypothesis can be selected.",
      nextAction: nextImpact?.expectedRevision ?? evidenceImpactMatrix.locks[0],
      proofUrl: "/api/sports/decision/mvp-evidence-impact-matrix"
    }),
    stage({
      id: "test",
      label: "Test evidence",
      status: nextTurn.safeToRun ? "next" : status === "waiting-provider-key" ? "locked" : "watch",
      signal: nextImpact?.ifSupports ?? providerProofReceipt.summary,
      decision: nextTurn.safeToRun ? "Next proof can run read-only." : "Hold execution until proof is safe and unblocked.",
      nextAction: nextTurn.expectedEvidence,
      proofUrl: nextTurn.proofUrl
    }),
    stage({
      id: "revise",
      label: "Revise belief",
      status: beliefRevisionLoop.status === "blocked" ? "block" : beliefRevisionLoop.revision.trustCeiling === "locked" ? "locked" : "watch",
      signal: beliefRevisionLoop.revision.revisionRule,
      decision: beliefRevisionLoop.revision.trustCeiling === "locked" ? "Only hold or lower the belief." : "Revision can stay monitor/shadow only.",
      nextAction: beliefRevisionLoop.revision.nextEvidence,
      proofUrl: "/api/sports/decision/mvp-belief-revision-loop"
    }),
    stage({
      id: "act",
      label: "Select safe action",
      status: nextTurn.safeToRun ? "next" : "locked",
      signal: liveActivationBridge.summary,
      decision: "Public picks, staking, writes, training, and confidence raises stay locked.",
      nextAction: nextTurn.safeToRun ? "Run only the selected read-only proof." : liveActivationBridge.nextRun.expectedEvidence,
      proofUrl: nextTurn.proofUrl
    }),
    stage({
      id: "learn",
      label: "Learn later",
      status: mvpProgressSnapshot.status === "local-mvp-ready" ? "watch" : "locked",
      signal: mvpProgressSnapshot.summary,
      decision: "Learning remains a later gate after provider, storage, OpenAI, and backtest proof.",
      nextAction: mvpProgressSnapshot.lanes.find((lane) => lane.status !== "done")?.nextAction ?? mvpProgressSnapshot.epl2026.nextAction,
      proofUrl: "/api/sports/decision/mvp-progress-snapshot"
    })
  ];
  const activeStage = stages.find((item) => item.status === "next") ?? stages.find((item) => item.status === "block" || item.status === "locked") ?? stages[0] ?? null;

  return {
    mode: "decision-mvp-cognitive-cycle",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    cycleHash: stableHash({
      date,
      sport,
      status,
      checkpoint: [reasoningCheckpoint.checkpointHash, reasoningCheckpoint.status, reasoningCheckpoint.focus.matchId],
      revision: [beliefRevisionLoop.loopHash, beliefRevisionLoop.status, beliefRevisionLoop.revision.trustCeiling],
      impact: [evidenceImpactMatrix.matrixHash, evidenceImpactMatrix.status, evidenceImpactMatrix.nextImpact?.id],
      bridge: [liveActivationBridge.bridgeHash, liveActivationBridge.status],
      receipt: [providerProofReceipt.receiptHash, providerProofReceipt.status],
      progress: [mvpProgressSnapshot.status, mvpProgressSnapshot.percentages],
      stages: stages.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status, reasoningCheckpoint.focus.match),
    focus: {
      match: reasoningCheckpoint.focus.match,
      selection: reasoningCheckpoint.focus.selection,
      publicPosture: beliefRevisionLoop.revision.publicPosture,
      trustCeiling: beliefRevisionLoop.revision.trustCeiling,
      nextQuestion: compact(nextImpact?.decisionQuestion ?? reasoningCheckpoint.publicReasoning.nextQuestion, 260),
      nextProofUrl: nextTurn.proofUrl
    },
    stages,
    activeStage,
    nextTurn,
    controls: {
      canInspectReadOnly: true,
      canRunNextReadOnlyProof: nextTurn.safeToRun,
      canAskOpenAI: false,
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
    proofUrls: unique([
      "/api/sports/decision/mvp-cognitive-cycle",
      "/api/sports/decision/mvp-reasoning-checkpoint",
      "/api/sports/decision/mvp-belief-revision-loop",
      "/api/sports/decision/mvp-evidence-impact-matrix",
      nextTurn.proofUrl,
      ...reasoningCheckpoint.proofUrls,
      ...beliefRevisionLoop.proofUrls,
      ...evidenceImpactMatrix.proofUrls,
      ...liveActivationBridge.proofUrls,
      ...providerProofReceipt.proofUrls,
      ...mvpProgressSnapshot.proofUrls
    ]),
    locks: unique([
      "MVP cognitive cycle is public-safe and exposes a stage trace, not hidden chain-of-thought.",
      "The cycle can select one read-only next turn only; it cannot fetch providers by itself, write rows, persist decisions, train, publish, stake, adjust probabilities, or raise confidence.",
      "Provider keys, provider proof, Supabase storage, OpenAI review, historical backtests, and answer authority remain stronger than any cycle stage.",
      ...reasoningCheckpoint.locks,
      ...beliefRevisionLoop.locks,
      ...evidenceImpactMatrix.locks,
      ...providerProofReceipt.locks
    ])
  };
}
