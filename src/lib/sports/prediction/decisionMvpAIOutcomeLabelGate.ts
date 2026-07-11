import type { DecisionMvpAILearningQuarantine } from "@/lib/sports/prediction/decisionMvpAILearningQuarantine";

export type DecisionMvpAIOutcomeLabelGateStatus = "blocked-evidence" | "waiting-settlement" | "ready-shadow-label" | "withheld";

export type DecisionMvpAIOutcomeLabelGate = {
  mode: "decision-mvp-ai-outcome-label-gate";
  generatedAt: string;
  date: string;
  sport: DecisionMvpAILearningQuarantine["sport"];
  status: DecisionMvpAIOutcomeLabelGateStatus;
  labelGateHash: string;
  summary: string;
  case: {
    caseId: string;
    sourceQuarantineHash: string;
    labelState: "blocked" | "unsettled" | "shadow-label-ready" | "withheld";
    candidateUse: "none" | "shadow-calibration";
    canBecomeTrainingRow: false;
    canInfluencePublicDecision: false;
  };
  requiredLabels: Array<{
    id: string;
    label: string;
    status: "pass" | "watch" | "block";
    detail: string;
    trainingField: string;
  }>;
  shadowTrainingRow: {
    rowStatus: "not-created" | "draft-only";
    rowKey: string;
    fields: string[];
    blockedWrites: string[];
  };
  controls: {
    canInspectReadOnly: true;
    canDraftShadowLabel: boolean;
    canPersistOutcomeLabel: false;
    canPersistTrainingRows: false;
    canRunCalibration: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
  };
  source: {
    quarantineHash: string;
    handoffHash: string;
    critiqueLedgerHash: string;
    decisionTurnHash: string;
    releaseHash: string;
    auditHash: string;
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

function statusFor(quarantine: DecisionMvpAILearningQuarantine): DecisionMvpAIOutcomeLabelGateStatus {
  if (quarantine.status === "withheld") return "withheld";
  if (quarantine.gates.find((gate) => gate.id === "outcome-label-integrity")?.status === "block") return "waiting-settlement";
  if (quarantine.status === "shadow-quarantine-ready") return "ready-shadow-label";
  return "blocked-evidence";
}

function summaryFor(status: DecisionMvpAIOutcomeLabelGateStatus): string {
  if (status === "ready-shadow-label") return "MVP AI outcome label gate can draft a shadow-only label row for calibration review.";
  if (status === "waiting-settlement") return "MVP AI outcome label gate is waiting for final score, market settlement, and closing odds before learning.";
  if (status === "blocked-evidence") return "MVP AI outcome label gate is blocked until provider evidence, critique, storage, and quarantine gates improve.";
  return "MVP AI outcome label gate withholds labels because the upstream case was withheld.";
}

export function buildDecisionMvpAIOutcomeLabelGate({
  learningQuarantine,
  now = new Date()
}: {
  learningQuarantine: DecisionMvpAILearningQuarantine;
  now?: Date;
}): DecisionMvpAIOutcomeLabelGate {
  const status = statusFor(learningQuarantine);
  const gateById = new Map(learningQuarantine.gates.map((gate) => [gate.id, gate]));
  const canDraftShadowLabel = status === "ready-shadow-label";
  const requiredLabels = [
    {
      id: "fixture-identity",
      label: "Provider fixture identity",
      status: gateById.get("evidence-integrity")?.status ?? ("block" as const),
      detail: gateById.get("evidence-integrity")?.detail ?? "Provider fixture evidence is missing.",
      trainingField: "provider_fixture_id"
    },
    {
      id: "final-score",
      label: "Final score",
      status: gateById.get("outcome-label-integrity")?.status ?? ("block" as const),
      detail: "Attach full-time score, winner/draw result, and match status after provider settlement.",
      trainingField: "full_time_score"
    },
    {
      id: "market-settlement",
      label: "Market settlement",
      status: gateById.get("outcome-label-integrity")?.status ?? ("block" as const),
      detail: "Settle the exact market the model reasoned about, including void/push handling.",
      trainingField: "market_result"
    },
    {
      id: "closing-odds",
      label: "Closing odds",
      status: gateById.get("outcome-label-integrity")?.status === "pass" ? ("watch" as const) : ("block" as const),
      detail: "Attach closing bookmaker price so the engine can compare model edge against market movement.",
      trainingField: "closing_decimal_odds"
    },
    {
      id: "storage-approval",
      label: "Storage approval",
      status: gateById.get("storage-policy")?.status ?? ("block" as const),
      detail: gateById.get("storage-policy")?.detail ?? "Storage approval is missing.",
      trainingField: "storage_receipt_id"
    }
  ];
  const blockedLabel = requiredLabels.find((item) => item.status === "block") ?? null;
  const rowKey = stableHash({
    caseId: learningQuarantine.quarantine.caseId,
    quarantineHash: learningQuarantine.quarantineHash,
    fields: requiredLabels.map((item) => item.trainingField)
  });

  return {
    mode: "decision-mvp-ai-outcome-label-gate",
    generatedAt: now.toISOString(),
    date: learningQuarantine.date,
    sport: learningQuarantine.sport,
    status,
    labelGateHash: stableHash({
      status,
      quarantineHash: learningQuarantine.quarantineHash,
      requiredLabels: requiredLabels.map((item) => [item.id, item.status]),
      rowKey
    }),
    summary: summaryFor(status),
    case: {
      caseId: learningQuarantine.quarantine.caseId,
      sourceQuarantineHash: learningQuarantine.quarantineHash,
      labelState: status === "withheld" ? "withheld" : status === "ready-shadow-label" ? "shadow-label-ready" : status === "waiting-settlement" ? "unsettled" : "blocked",
      candidateUse: canDraftShadowLabel ? "shadow-calibration" : "none",
      canBecomeTrainingRow: false,
      canInfluencePublicDecision: false
    },
    requiredLabels,
    shadowTrainingRow: {
      rowStatus: canDraftShadowLabel ? "draft-only" : "not-created",
      rowKey,
      fields: unique([
        "case_id",
        "decision_turn_hash",
        "release_hash",
        "quarantine_hash",
        ...requiredLabels.map((item) => item.trainingField),
        ...learningQuarantine.quarantine.retainedSignals
      ], 24),
      blockedWrites: [
        "outcome label persistence",
        "training row persistence",
        "calibration run",
        "model training",
        "learned weight promotion",
        "public probability update"
      ]
    },
    controls: {
      canInspectReadOnly: true,
      canDraftShadowLabel,
      canPersistOutcomeLabel: false,
      canPersistTrainingRows: false,
      canRunCalibration: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    source: {
      quarantineHash: learningQuarantine.quarantineHash,
      handoffHash: learningQuarantine.source.handoffHash,
      critiqueLedgerHash: learningQuarantine.source.critiqueLedgerHash,
      decisionTurnHash: learningQuarantine.source.decisionTurnHash,
      releaseHash: learningQuarantine.source.releaseHash,
      auditHash: learningQuarantine.source.auditHash
    },
    nextAction: {
      label: blockedLabel?.label ?? "Draft shadow label only",
      command: null,
      verifyUrl: "/api/sports/decision/mvp-ai-outcome-label-gate",
      safeToRun: false,
      expectedEvidence: compact(blockedLabel ? `Missing label evidence: ${blockedLabel.detail}` : "Keep the label draft shadow-only until storage, calibration, and promotion gates pass.")
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-ai-outcome-label-gate",
      ...learningQuarantine.proofUrls
    ]),
    locks: unique([
      "MVP AI outcome label gate prepares learning labels only; it cannot persist outcomes, write training rows, calibrate, train, apply learned weights, publish picks, stake, or expose hidden chain-of-thought.",
      ...learningQuarantine.locks
    ])
  };
}
