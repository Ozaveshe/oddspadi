import type { DecisionMvpAILearningHandoff } from "@/lib/sports/prediction/decisionMvpAILearningHandoff";

export type DecisionMvpAILearningQuarantineStatus = "quarantined-evidence" | "quarantined-labels" | "shadow-quarantine-ready" | "withheld";

export type DecisionMvpAILearningQuarantine = {
  mode: "decision-mvp-ai-learning-quarantine";
  generatedAt: string;
  date: string;
  sport: DecisionMvpAILearningHandoff["sport"];
  status: DecisionMvpAILearningQuarantineStatus;
  quarantineHash: string;
  summary: string;
  quarantine: {
    caseId: string;
    allowedScope: "none" | "shadow-only";
    influenceStatus: "blocked" | "shadow-quarantined";
    reason: string;
    retainedSignals: string[];
    blockedInfluence: string[];
  };
  gates: Array<{
    id: string;
    label: string;
    status: "pass" | "watch" | "block";
    detail: string;
    unlocks: string[];
  }>;
  source: {
    handoffHash: string;
    critiqueLedgerHash: string;
    decisionTurnHash: string;
    releaseHash: string;
    auditHash: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRetainReadOnlySignals: boolean;
    canPersistMemory: false;
    canPersistOutcomes: false;
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

function compact(value: string | null | undefined, maxLength = 340): string {
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

function statusFor(handoff: DecisionMvpAILearningHandoff): DecisionMvpAILearningQuarantineStatus {
  if (handoff.status === "withheld") return "withheld";
  if (handoff.status === "blocked-evidence") return "quarantined-evidence";
  if (handoff.status === "waiting-outcome-label") return "quarantined-labels";
  return "shadow-quarantine-ready";
}

function summaryFor(status: DecisionMvpAILearningQuarantineStatus): string {
  if (status === "shadow-quarantine-ready") return "MVP AI learning quarantine can retain this case for shadow-only evaluation, with no public influence.";
  if (status === "quarantined-labels") return "MVP AI learning quarantine holds the case until settled outcome labels are attached.";
  if (status === "quarantined-evidence") return "MVP AI learning quarantine blocks the case because evidence, critique, labels, or storage policy are not ready.";
  return "MVP AI learning quarantine withholds the case because the upstream handoff was withheld.";
}

export function buildDecisionMvpAILearningQuarantine({
  learningHandoff,
  now = new Date()
}: {
  learningHandoff: DecisionMvpAILearningHandoff;
  now?: Date;
}): DecisionMvpAILearningQuarantine {
  const status = statusFor(learningHandoff);
  const requiredById = new Map(learningHandoff.requiredEvidence.map((item) => [item.id, item]));
  const gates = [
    {
      id: "evidence-integrity",
      label: "Evidence integrity",
      status: requiredById.get("provider-evidence")?.status ?? ("block" as const),
      detail: requiredById.get("provider-evidence")?.detail ?? "Provider evidence gate is missing.",
      unlocks: ["shadow-feature-retention", "future-backtest-input"]
    },
    {
      id: "critique-integrity",
      label: "Critique integrity",
      status: requiredById.get("critique-clearance")?.status ?? ("block" as const),
      detail: requiredById.get("critique-clearance")?.detail ?? "Critique gate is missing.",
      unlocks: ["shadow-case-eligibility"]
    },
    {
      id: "outcome-label-integrity",
      label: "Outcome label integrity",
      status: requiredById.get("outcome-label")?.status ?? ("block" as const),
      detail: requiredById.get("outcome-label")?.detail ?? "Outcome label gate is missing.",
      unlocks: ["settled-calibration", "walk-forward-replay"]
    },
    {
      id: "storage-policy",
      label: "Storage policy",
      status: requiredById.get("storage-policy")?.status ?? ("block" as const),
      detail: requiredById.get("storage-policy")?.detail ?? "Storage policy gate is missing.",
      unlocks: ["memory-write", "training-row-write"]
    },
    {
      id: "public-influence-firewall",
      label: "Public influence firewall",
      status: "pass" as const,
      detail: "Quarantine prevents this case from changing probabilities, confidence, public picks, publishing, staking, or learned weights.",
      unlocks: []
    }
  ];
  const blockedGate = gates.find((gate) => gate.status === "block") ?? null;
  const allowedScope = status === "shadow-quarantine-ready" ? "shadow-only" : "none";

  return {
    mode: "decision-mvp-ai-learning-quarantine",
    generatedAt: now.toISOString(),
    date: learningHandoff.date,
    sport: learningHandoff.sport,
    status,
    quarantineHash: stableHash({
      status,
      handoffHash: learningHandoff.handoffHash,
      gates: gates.map((gate) => [gate.id, gate.status]),
      caseId: learningHandoff.learningCase.caseId
    }),
    summary: summaryFor(status),
    quarantine: {
      caseId: learningHandoff.learningCase.caseId,
      allowedScope,
      influenceStatus: allowedScope === "shadow-only" ? "shadow-quarantined" : "blocked",
      reason: compact(blockedGate?.detail ?? summaryFor(status), 300),
      retainedSignals: unique(learningHandoff.futureFeatureRows, 8),
      blockedInfluence: [
        "public probability",
        "confidence",
        "pick publication",
        "stake sizing",
        "learned weights",
        "training rows",
        "decision memory writes",
        "hidden chain-of-thought"
      ]
    },
    gates,
    source: {
      handoffHash: learningHandoff.handoffHash,
      critiqueLedgerHash: learningHandoff.source.critiqueLedgerHash,
      decisionTurnHash: learningHandoff.source.decisionTurnHash,
      releaseHash: learningHandoff.source.releaseHash,
      auditHash: learningHandoff.source.auditHash
    },
    controls: {
      canInspectReadOnly: true,
      canRetainReadOnlySignals: status !== "withheld",
      canPersistMemory: false,
      canPersistOutcomes: false,
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
      label: blockedGate?.label ?? "Keep shadow quarantine read-only",
      command: null,
      verifyUrl: "/api/sports/decision/mvp-ai-learning-quarantine",
      safeToRun: false,
      expectedEvidence: compact(blockedGate ? `Clear gate: ${blockedGate.detail}` : "Keep quarantine read-only until promotion gates clear.", 300)
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-ai-learning-quarantine",
      ...learningHandoff.proofUrls
    ]),
    locks: unique([
      "MVP AI learning quarantine blocks all public and model influence until evidence, labels, storage, backtests, and governance clear.",
      "Learning quarantine cannot write memory, persist outcomes, persist training rows, train models, apply learned weights, adjust probabilities, raise confidence, publish picks, stake, or expose hidden chain-of-thought.",
      ...learningHandoff.locks
    ])
  };
}
