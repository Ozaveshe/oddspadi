import type { DecisionMvpAICritiqueLedger } from "@/lib/sports/prediction/decisionMvpAICritiqueLedger";
import type { DecisionMvpCognitiveCycle } from "@/lib/sports/prediction/decisionMvpCognitiveCycle";
import type { DecisionMvpEvidenceImpactMatrix } from "@/lib/sports/prediction/decisionMvpEvidenceImpactMatrix";

export type DecisionMvpAIProofCoordinatorStatus = "waiting-review" | "waiting-provider" | "ready-readonly-proof" | "hold" | "blocked";
export type DecisionMvpAIProofCoordinatorSource = "critique-ledger" | "cognitive-cycle" | "evidence-impact" | "safety-lock";

export type DecisionMvpAIProofCoordinatorStep = {
  id: string;
  label: string;
  source: DecisionMvpAIProofCoordinatorSource;
  status: "ready" | "waiting" | "blocked" | "locked";
  priority: "critical" | "high" | "medium" | "low";
  command: string | null;
  proofUrl: string;
  safeToRun: boolean;
  expectedEvidence: string;
  sameOrSaferReason: string;
};

export type DecisionMvpAIProofCoordinator = {
  mode: "decision-mvp-ai-proof-coordinator";
  generatedAt: string;
  date: string;
  sport: DecisionMvpCognitiveCycle["sport"];
  status: DecisionMvpAIProofCoordinatorStatus;
  coordinatorHash: string;
  summary: string;
  selectedStep: DecisionMvpAIProofCoordinatorStep;
  steps: DecisionMvpAIProofCoordinatorStep[];
  source: {
    cognitiveCycleHash: string;
    evidenceMatrixHash: string;
    critiqueLedgerHash: string;
    cognitiveStatus: DecisionMvpCognitiveCycle["status"];
    evidenceStatus: DecisionMvpEvidenceImpactMatrix["status"];
    critiqueStatus: DecisionMvpAICritiqueLedger["status"];
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

function compact(value: string | null | undefined, maxLength = 300): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No evidence available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 60): string[] {
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

function statusFor(selected: DecisionMvpAIProofCoordinatorStep, critiqueLedger: DecisionMvpAICritiqueLedger): DecisionMvpAIProofCoordinatorStatus {
  if (critiqueLedger.status === "blocked") return "blocked";
  if (critiqueLedger.status === "not-reviewed") return "waiting-review";
  if (selected.status === "ready" && selected.safeToRun) return "ready-readonly-proof";
  if (selected.status === "waiting") return "waiting-provider";
  if (selected.status === "blocked") return "blocked";
  return "hold";
}

function summaryFor(status: DecisionMvpAIProofCoordinatorStatus, selected: DecisionMvpAIProofCoordinatorStep): string {
  if (status === "ready-readonly-proof") return `MVP AI proof coordinator selected ${selected.label} as the next safe read-only proof.`;
  if (status === "waiting-review") return "MVP AI proof coordinator is waiting for the guarded critique runner before selecting a proof turn.";
  if (status === "waiting-provider") return `MVP AI proof coordinator is waiting on provider evidence before ${selected.label} can run.`;
  if (status === "blocked") return `MVP AI proof coordinator blocks the next turn because ${selected.label} is blocked.`;
  return `MVP AI proof coordinator holds on ${selected.label}; no stronger action is allowed.`;
}

function step(input: DecisionMvpAIProofCoordinatorStep): DecisionMvpAIProofCoordinatorStep {
  return {
    ...input,
    expectedEvidence: compact(input.expectedEvidence, 300),
    sameOrSaferReason: compact(input.sameOrSaferReason, 260)
  };
}

export function buildDecisionMvpAIProofCoordinator({
  cognitiveCycle,
  evidenceImpactMatrix,
  critiqueLedger,
  now = new Date()
}: {
  cognitiveCycle: DecisionMvpCognitiveCycle;
  evidenceImpactMatrix: DecisionMvpEvidenceImpactMatrix;
  critiqueLedger: DecisionMvpAICritiqueLedger;
  now?: Date;
}): DecisionMvpAIProofCoordinator {
  const critiqueBlocker = critiqueLedger.items.find((item) => item.status === "block") ?? critiqueLedger.items.find((item) => item.status === "watch") ?? null;
  const impact = evidenceImpactMatrix.nextImpact;
  const reviewStep = step({
    id: "guarded-ai-critique",
    label: "Guarded AI critique",
    source: "critique-ledger",
    status: critiqueLedger.status === "not-reviewed" ? "waiting" : critiqueLedger.status === "blocked" ? "blocked" : "ready",
    priority: critiqueLedger.status === "blocked" ? "critical" : critiqueLedger.status === "not-reviewed" ? "high" : "medium",
    command: critiqueLedger.nextAction.safeToRun ? critiqueLedger.nextAction.command : null,
    proofUrl: critiqueLedger.nextAction.verifyUrl,
    safeToRun: critiqueLedger.nextAction.safeToRun,
    expectedEvidence: critiqueLedger.nextAction.expectedEvidence,
    sameOrSaferReason: "Critique must only hold, monitor, avoid, or request more evidence."
  });
  const critiqueProofStep = step({
    id: "critique-blocker-proof",
    label: critiqueBlocker?.label ?? "Critique blocker proof",
    source: "critique-ledger",
    status: critiqueBlocker ? (critiqueBlocker.status === "pass" ? "ready" : critiqueBlocker.status === "watch" ? "waiting" : "blocked") : "locked",
    priority: critiqueBlocker?.status === "block" ? "critical" : critiqueBlocker?.status === "watch" ? "high" : "low",
    command: critiqueLedger.nextAction.command,
    proofUrl: critiqueLedger.nextAction.verifyUrl,
    safeToRun: false,
    expectedEvidence: critiqueBlocker?.nextAction ?? critiqueLedger.nextAction.expectedEvidence,
    sameOrSaferReason: critiqueBlocker?.sameOrSaferEffect ? `Critique effect is ${critiqueBlocker.sameOrSaferEffect}.` : "No critique blocker is active."
  });
  const evidenceStep = step({
    id: "highest-impact-evidence",
    label: impact?.label ?? "Highest-impact evidence",
    source: "evidence-impact",
    status: impact?.safeToRun ? "ready" : impact?.status === "waiting-provider-key" ? "waiting" : impact?.status === "blocked" ? "blocked" : "locked",
    priority: impact?.impactScore && impact.impactScore >= 50 ? "high" : "medium",
    command: impact?.command ?? null,
    proofUrl: impact?.proofUrl ?? "/api/sports/decision/mvp-evidence-impact-matrix",
    safeToRun: Boolean(impact?.safeToRun),
    expectedEvidence: impact?.expectedRevision ?? evidenceImpactMatrix.summary,
    sameOrSaferReason: impact?.ifContradicts ?? "Evidence may only keep, lower, or hold the current belief."
  });
  const cycleStep = step({
    id: "cognitive-next-turn",
    label: cognitiveCycle.nextTurn.label,
    source: "cognitive-cycle",
    status: cognitiveCycle.nextTurn.safeToRun ? "ready" : cognitiveCycle.status === "waiting-provider-key" ? "waiting" : cognitiveCycle.status === "blocked" ? "blocked" : "locked",
    priority: cognitiveCycle.nextTurn.safeToRun ? "high" : "medium",
    command: cognitiveCycle.nextTurn.command,
    proofUrl: cognitiveCycle.nextTurn.proofUrl,
    safeToRun: cognitiveCycle.nextTurn.safeToRun,
    expectedEvidence: cognitiveCycle.nextTurn.expectedEvidence,
    sameOrSaferReason: "The cognitive cycle can select one read-only proof turn only."
  });
  const safetyStep = step({
    id: "same-or-safer-safety-lock",
    label: "Same-or-safer safety lock",
    source: "safety-lock",
    status: "ready",
    priority: "low",
    command: null,
    proofUrl: "/api/sports/decision/mvp-ai-proof-coordinator",
    safeToRun: false,
    expectedEvidence: "Safety lock stays closed: no publish, stake, train, persist, provider-write, probability edit, confidence raise, or hidden reasoning.",
    sameOrSaferReason: "Safety lock is always advisory and cannot perform side effects."
  });
  const steps = [reviewStep, critiqueProofStep, evidenceStep, cycleStep, safetyStep];
  const selectedStep =
    steps.find((item) => item.status === "ready" && item.safeToRun) ??
    steps.find((item) => item.status === "blocked") ??
    steps.find((item) => item.status === "waiting") ??
    cycleStep;
  const status = statusFor(selectedStep, critiqueLedger);

  return {
    mode: "decision-mvp-ai-proof-coordinator",
    generatedAt: now.toISOString(),
    date: cognitiveCycle.date,
    sport: cognitiveCycle.sport,
    status,
    coordinatorHash: stableHash({
      status,
      selected: [selectedStep.id, selectedStep.status, selectedStep.safeToRun],
      cognitive: [cognitiveCycle.cycleHash, cognitiveCycle.status],
      evidence: [evidenceImpactMatrix.matrixHash, evidenceImpactMatrix.status, evidenceImpactMatrix.nextImpact?.id],
      critique: [critiqueLedger.ledgerHash, critiqueLedger.status, critiqueLedger.source.reviewHash],
      steps: steps.map((item) => [item.id, item.status, item.priority, item.source])
    }),
    summary: summaryFor(status, selectedStep),
    selectedStep,
    steps,
    source: {
      cognitiveCycleHash: cognitiveCycle.cycleHash,
      evidenceMatrixHash: evidenceImpactMatrix.matrixHash,
      critiqueLedgerHash: critiqueLedger.ledgerHash,
      cognitiveStatus: cognitiveCycle.status,
      evidenceStatus: evidenceImpactMatrix.status,
      critiqueStatus: critiqueLedger.status
    },
    controls: {
      canInspectReadOnly: true,
      canRunSelectedProof: selectedStep.safeToRun,
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
      label: selectedStep.label,
      command: selectedStep.safeToRun ? selectedStep.command : null,
      verifyUrl: selectedStep.proofUrl,
      safeToRun: selectedStep.safeToRun,
      expectedEvidence: selectedStep.expectedEvidence
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-ai-proof-coordinator",
      selectedStep.proofUrl,
      "/api/sports/decision/mvp-ai-critique-ledger",
      "/api/sports/decision/mvp-cognitive-cycle",
      "/api/sports/decision/mvp-evidence-impact-matrix",
      ...critiqueLedger.proofUrls,
      ...cognitiveCycle.proofUrls,
      ...evidenceImpactMatrix.proofUrls
    ]),
    locks: unique([
      "MVP AI proof coordinator is read-only and only selects the next proof intent.",
      "Coordinator cannot run OpenAI, fetch providers, write provider rows, persist decisions, train, publish, stake, adjust probabilities, raise confidence, or reveal hidden chain-of-thought.",
      "Selected proof is same-or-safer and cannot improve public action by itself.",
      ...critiqueLedger.locks,
      ...cognitiveCycle.locks,
      ...evidenceImpactMatrix.locks
    ])
  };
}
