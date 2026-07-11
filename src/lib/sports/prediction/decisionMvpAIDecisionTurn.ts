import type { DecisionMvpAICritiqueLedger } from "@/lib/sports/prediction/decisionMvpAICritiqueLedger";
import type { DecisionMvpAIProofCoordinator } from "@/lib/sports/prediction/decisionMvpAIProofCoordinator";
import type { DecisionMvpCognitiveCycle, DecisionMvpCognitiveCycleStageId } from "@/lib/sports/prediction/decisionMvpCognitiveCycle";
import type { DecisionMvpEvidenceImpactMatrix } from "@/lib/sports/prediction/decisionMvpEvidenceImpactMatrix";

export type DecisionMvpAIDecisionTurnStatus = "waiting-review" | "waiting-provider" | "ready-readonly-proof" | "hold" | "blocked";

export type DecisionMvpAIDecisionTurn = {
  mode: "decision-mvp-ai-decision-turn";
  generatedAt: string;
  date: string;
  sport: DecisionMvpCognitiveCycle["sport"];
  status: DecisionMvpAIDecisionTurnStatus;
  turnHash: string;
  summary: string;
  turn: {
    phase: DecisionMvpCognitiveCycleStageId | "none";
    observation: string;
    belief: string;
    doubt: string;
    decision: string;
    selectedProof: string;
    expectedEvidence: string;
    sameOrSaferReason: string;
    appliedEffect: DecisionMvpAICritiqueLedger["verdict"]["appliedEffect"];
    publicPosture: DecisionMvpAICritiqueLedger["verdict"]["publicPosture"];
    trustCeiling: DecisionMvpAICritiqueLedger["verdict"]["trustCeiling"];
  };
  thinkingAudit: {
    publicRationale: string[];
    uncertaintyDrivers: string[];
    counterEvidence: string[];
    flipConditions: string[];
    promotionBlockers: string[];
    safestNextStep: string;
    publicSafetyRule: string;
  };
  experimentProtocol: {
    hypothesis: string;
    evidenceAction: string;
    supportSignal: string;
    contradictionSignal: string;
    stopConditions: string[];
    readOnlyBoundary: string;
  };
  evidence: {
    cognitiveCycleHash: string;
    evidenceMatrixHash: string;
    critiqueLedgerHash: string;
    proofCoordinatorHash: string;
    activeStage: string;
    impactScore: number;
    missingEnv: string[];
    critiqueBlocks: number;
    critiqueWatches: number;
  };
  controls: {
    canInspectReadOnly: true;
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

function compact(value: string | null | undefined, maxLength = 320): string {
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

function statusFor(proofCoordinator: DecisionMvpAIProofCoordinator): DecisionMvpAIDecisionTurnStatus {
  if (proofCoordinator.status === "ready-readonly-proof") return "ready-readonly-proof";
  if (proofCoordinator.status === "waiting-review") return "waiting-review";
  if (proofCoordinator.status === "waiting-provider") return "waiting-provider";
  if (proofCoordinator.status === "blocked") return "blocked";
  return "hold";
}

function summaryFor(status: DecisionMvpAIDecisionTurnStatus, selectedProof: string): string {
  if (status === "ready-readonly-proof") return `MVP AI decision turn selected ${selectedProof} as the next read-only proof.`;
  if (status === "waiting-review") return "MVP AI decision turn is waiting for the guarded review before it can close the loop.";
  if (status === "waiting-provider") return "MVP AI decision turn is waiting for provider evidence before the next proof can run.";
  if (status === "blocked") return `MVP AI decision turn is blocked by ${selectedProof}; public action stays locked.`;
  return `MVP AI decision turn is holding on ${selectedProof}; no stronger action is allowed.`;
}

function auditList(values: Array<string | null | undefined>, fallback: string, limit = 5): string[] {
  const result = unique(values, limit);
  return result.length ? result : [fallback];
}

function protocolFor({
  selectedStep,
  impact,
  activeStage,
  blocker,
  cognitiveCycle
}: {
  selectedStep: DecisionMvpAIProofCoordinator["selectedStep"];
  impact: DecisionMvpEvidenceImpactMatrix["nextImpact"];
  activeStage: DecisionMvpCognitiveCycle["activeStage"];
  blocker: DecisionMvpAICritiqueLedger["items"][number] | null;
  cognitiveCycle: DecisionMvpCognitiveCycle;
}): DecisionMvpAIDecisionTurn["experimentProtocol"] {
  const supportSignal = compact(
    impact?.ifSupports ?? selectedStep.expectedEvidence ?? cognitiveCycle.nextTurn.expectedEvidence,
    300
  );
  const contradictionSignal = compact(
    impact?.ifContradicts ?? blocker?.evidence ?? activeStage?.signal ?? "Contradictory proof keeps the belief held, monitored, lowered, or avoided.",
    300
  );

  return {
    hypothesis: compact(
      `If ${selectedStep.label} returns the expected evidence, the engine may reduce uncertainty for the current slate while public action stays same-or-safer.`,
      320
    ),
    evidenceAction: compact(selectedStep.expectedEvidence || cognitiveCycle.nextTurn.expectedEvidence, 320),
    supportSignal,
    contradictionSignal,
    stopConditions: auditList(
      [
        selectedStep.safeToRun ? null : `Stop because selected proof is not runnable: ${selectedStep.sameOrSaferReason}`,
        blocker ? `Stop because ${blocker.label} is ${blocker.status}: ${blocker.nextAction}` : null,
        "Stop before any provider write, decision persistence, training write, learned-weight update, public pick, stake, probability upgrade, confidence raise, or hidden chain-of-thought exposure.",
        "Stop after one read-only proof observation and require a fresh verification receipt before the next turn."
      ],
      "Stop before any side effect or public-action upgrade.",
      5
    ),
    readOnlyBoundary: "Protocol may inspect and explain proof evidence only; it cannot fetch/write provider rows, persist decisions, train, publish picks, stake, adjust probabilities, raise confidence, or expose hidden chain-of-thought."
  };
}

export function buildDecisionMvpAIDecisionTurn({
  cognitiveCycle,
  evidenceImpactMatrix,
  critiqueLedger,
  proofCoordinator,
  now = new Date()
}: {
  cognitiveCycle: DecisionMvpCognitiveCycle;
  evidenceImpactMatrix: DecisionMvpEvidenceImpactMatrix;
  critiqueLedger: DecisionMvpAICritiqueLedger;
  proofCoordinator: DecisionMvpAIProofCoordinator;
  now?: Date;
}): DecisionMvpAIDecisionTurn {
  const status = statusFor(proofCoordinator);
  const activeStage = cognitiveCycle.activeStage;
  const impact = evidenceImpactMatrix.nextImpact;
  const selectedStep = proofCoordinator.selectedStep;
  const blocker = critiqueLedger.items.find((item) => item.status === "block") ?? critiqueLedger.items.find((item) => item.status === "watch") ?? null;
  const observation = compact(activeStage?.signal ?? cognitiveCycle.summary, 300);
  const belief = compact(
    cognitiveCycle.focus.match
      ? `${cognitiveCycle.focus.match}: posture ${cognitiveCycle.focus.publicPosture}; trust ceiling ${cognitiveCycle.focus.trustCeiling}.`
      : `Slate posture ${cognitiveCycle.focus.publicPosture}; trust ceiling ${cognitiveCycle.focus.trustCeiling}.`,
    260
  );
  const doubt = compact(blocker?.evidence ?? impact?.ifMissing ?? cognitiveCycle.focus.nextQuestion, 300);
  const decision = compact(
    status === "ready-readonly-proof"
      ? `Run only ${selectedStep.label} as a read-only proof.`
      : `Hold: ${selectedStep.label} is ${selectedStep.status}, so public action cannot improve.`,
    260
  );
  const critiqueBlockers = critiqueLedger.items.filter((item) => item.status === "block" || item.status === "watch");
  const missingEnvSummary = impact?.missingEnv.length ? `Missing provider env: ${impact.missingEnv.join(", ")}.` : null;
  const thinkingAudit: DecisionMvpAIDecisionTurn["thinkingAudit"] = {
    publicRationale: auditList(
      [
        observation,
        belief,
        selectedStep.expectedEvidence ? `Selected proof target: ${selectedStep.expectedEvidence}` : null,
        `Critique applied effect is ${critiqueLedger.verdict.appliedEffect}; public posture is ${critiqueLedger.verdict.publicPosture}.`
      ],
      "No public rationale is available yet."
    ),
    uncertaintyDrivers: auditList(
      [
        blocker?.evidence,
        impact?.ifMissing,
        cognitiveCycle.focus.nextQuestion,
        missingEnvSummary,
        critiqueLedger.totals.missingEvidence ? `${critiqueLedger.totals.missingEvidence} critique evidence gap(s) remain.` : null
      ],
      "No uncertainty driver was identified."
    ),
    counterEvidence: auditList(
      [
        impact?.ifContradicts,
        ...critiqueBlockers.map((item) => `${item.label}: ${item.evidence}`),
        activeStage?.status === "block" ? activeStage.signal : null
      ],
      "No counter-evidence has cleared the current proof gates."
    ),
    flipConditions: auditList(
      [
        impact?.ifSupports,
        impact?.ifContradicts,
        selectedStep.expectedEvidence,
        cognitiveCycle.nextTurn.expectedEvidence
      ],
      "The belief cannot flip until a read-only proof returns provider-backed evidence."
    ),
    promotionBlockers: auditList(
      [
        ...critiqueBlockers.map((item) => `${item.label}: ${item.nextAction}`),
        proofCoordinator.controls.canRunSelectedProof ? null : `Selected proof is not safe to run: ${selectedStep.sameOrSaferReason}`,
        cognitiveCycle.controls.canRunNextReadOnlyProof ? null : "Cognitive cycle cannot run the next read-only proof yet."
      ],
      "No promotion blocker was identified, but public promotion remains locked by policy."
    ),
    safestNextStep: compact(proofCoordinator.nextAction.safeToRun ? proofCoordinator.nextAction.expectedEvidence : selectedStep.sameOrSaferReason, 260),
    publicSafetyRule: "Expose public rationale, uncertainty, counter-evidence, and flip conditions only; never expose hidden chain-of-thought, publish picks, stake, or raise confidence."
  };
  const experimentProtocol = protocolFor({ selectedStep, impact, activeStage, blocker, cognitiveCycle });

  return {
    mode: "decision-mvp-ai-decision-turn",
    generatedAt: now.toISOString(),
    date: cognitiveCycle.date,
    sport: cognitiveCycle.sport,
    status,
    turnHash: stableHash({
      status,
      cognitive: [cognitiveCycle.cycleHash, cognitiveCycle.status, activeStage?.id],
      evidence: [evidenceImpactMatrix.matrixHash, evidenceImpactMatrix.status, impact?.id, impact?.impactScore],
      critique: [critiqueLedger.ledgerHash, critiqueLedger.status, critiqueLedger.verdict.appliedEffect],
      coordinator: [proofCoordinator.coordinatorHash, proofCoordinator.status, selectedStep.id],
      thinkingAudit,
      experimentProtocol
    }),
    summary: summaryFor(status, selectedStep.label),
    turn: {
      phase: activeStage?.id ?? "none",
      observation,
      belief,
      doubt,
      decision,
      selectedProof: selectedStep.label,
      expectedEvidence: selectedStep.expectedEvidence,
      sameOrSaferReason: selectedStep.sameOrSaferReason,
      appliedEffect: critiqueLedger.verdict.appliedEffect,
      publicPosture: critiqueLedger.verdict.publicPosture,
      trustCeiling: critiqueLedger.verdict.trustCeiling
    },
    thinkingAudit,
    experimentProtocol,
    evidence: {
      cognitiveCycleHash: cognitiveCycle.cycleHash,
      evidenceMatrixHash: evidenceImpactMatrix.matrixHash,
      critiqueLedgerHash: critiqueLedger.ledgerHash,
      proofCoordinatorHash: proofCoordinator.coordinatorHash,
      activeStage: activeStage?.id ?? "none",
      impactScore: impact?.impactScore ?? 0,
      missingEnv: impact?.missingEnv ?? [],
      critiqueBlocks: critiqueLedger.totals.block,
      critiqueWatches: critiqueLedger.totals.watch
    },
    controls: {
      canInspectReadOnly: true,
      canRunSelectedProof: proofCoordinator.controls.canRunSelectedProof,
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
    nextAction: {
      ...proofCoordinator.nextAction,
      command: proofCoordinator.nextAction.safeToRun ? proofCoordinator.nextAction.command : null
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-ai-decision-turn",
      ...proofCoordinator.proofUrls,
      ...critiqueLedger.proofUrls,
      ...cognitiveCycle.proofUrls,
      ...evidenceImpactMatrix.proofUrls
    ]),
    locks: unique([
      "MVP AI decision turn exposes public-safe reasoning only, not hidden chain-of-thought.",
      "Decision turn cannot call OpenAI, fetch providers, write provider rows, persist decisions, train, publish, stake, adjust probabilities, or raise confidence.",
      "Any selected proof can only keep, lower, hold, monitor, or avoid.",
      ...proofCoordinator.locks,
      ...critiqueLedger.locks,
      ...cognitiveCycle.locks,
      ...evidenceImpactMatrix.locks
    ])
  };
}
