import type { DecisionMvpAICritiqueLedger } from "@/lib/sports/prediction/decisionMvpAICritiqueLedger";
import type { DecisionMvpAIAnswerReleasePacket } from "@/lib/sports/prediction/decisionMvpAIAnswerReleasePacket";
import type { DecisionMvpAIReleaseAuditTrail } from "@/lib/sports/prediction/decisionMvpAIReleaseAuditTrail";
import type { DecisionMvpAIDecisionTurn } from "@/lib/sports/prediction/decisionMvpAIDecisionTurn";

export type DecisionMvpAILearningHandoffStatus = "blocked-evidence" | "waiting-outcome-label" | "queued-shadow-only" | "withheld";

export type DecisionMvpAILearningHandoff = {
  mode: "decision-mvp-ai-learning-handoff";
  generatedAt: string;
  date: string;
  sport: DecisionMvpAIDecisionTurn["sport"];
  status: DecisionMvpAILearningHandoffStatus;
  handoffHash: string;
  summary: string;
  learningCase: {
    caseId: string;
    releaseStatus: DecisionMvpAIAnswerReleasePacket["status"];
    auditStatus: DecisionMvpAIReleaseAuditTrail["status"];
    decisionStatus: DecisionMvpAIDecisionTurn["status"];
    labelStatus: "unlabeled" | "blocked" | "shadow-only";
    intendedUse: "none" | "shadow-evaluation";
    eligibleForTraining: false;
    eligibleForPublicInfluence: false;
  };
  requiredEvidence: Array<{
    id: string;
    label: string;
    status: "pass" | "watch" | "block";
    detail: string;
    nextAction: string;
  }>;
  futureFeatureRows: string[];
  outcomeLabelsNeeded: string[];
  source: {
    critiqueLedgerHash: string;
    decisionTurnHash: string;
    releaseHash: string;
    auditHash: string;
  };
  controls: {
    canInspectReadOnly: true;
    canQueueShadowCase: boolean;
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

function statusFor({
  releasePacket,
  auditTrail,
  decisionTurn,
  critiqueLedger
}: {
  releasePacket: DecisionMvpAIAnswerReleasePacket;
  auditTrail: DecisionMvpAIReleaseAuditTrail;
  decisionTurn: DecisionMvpAIDecisionTurn;
  critiqueLedger: DecisionMvpAICritiqueLedger;
}): DecisionMvpAILearningHandoffStatus {
  if (releasePacket.status === "withheld" || auditTrail.status === "withheld-audit") return "withheld";
  if (decisionTurn.evidence.missingEnv.length || critiqueLedger.totals.block > 0 || decisionTurn.status === "blocked") return "blocked-evidence";
  if (releasePacket.publicAnswer.renderMode === "locked-explanation") return "waiting-outcome-label";
  return "queued-shadow-only";
}

function summaryFor(status: DecisionMvpAILearningHandoffStatus): string {
  if (status === "queued-shadow-only") return "MVP AI learning handoff can queue this case for future shadow evaluation only.";
  if (status === "waiting-outcome-label") return "MVP AI learning handoff is waiting for settled outcome labels before any shadow learning.";
  if (status === "blocked-evidence") return "MVP AI learning handoff is blocked by missing provider evidence or critique blockers; no learning write is allowed.";
  return "MVP AI learning handoff withholds the case because the public release was withheld.";
}

export function buildDecisionMvpAILearningHandoff({
  critiqueLedger,
  decisionTurn,
  releasePacket,
  auditTrail,
  now = new Date()
}: {
  critiqueLedger: DecisionMvpAICritiqueLedger;
  decisionTurn: DecisionMvpAIDecisionTurn;
  releasePacket: DecisionMvpAIAnswerReleasePacket;
  auditTrail: DecisionMvpAIReleaseAuditTrail;
  now?: Date;
}): DecisionMvpAILearningHandoff {
  const status = statusFor({ releasePacket, auditTrail, decisionTurn, critiqueLedger });
  const missingProviderEvidence = decisionTurn.evidence.missingEnv;
  const requiredEvidence = [
    {
      id: "provider-evidence",
      label: "Provider evidence",
      status: missingProviderEvidence.length ? ("block" as const) : ("watch" as const),
      detail: missingProviderEvidence.length
        ? `Missing provider env: ${missingProviderEvidence.join(", ")}.`
        : "Provider evidence is not yet proven as settled training truth.",
      nextAction: missingProviderEvidence.length ? "Configure provider keys and rerun provider proof before learning." : "Verify provider rows and fixture truth before learning."
    },
    {
      id: "critique-clearance",
      label: "Critique clearance",
      status: critiqueLedger.totals.block > 0 ? ("block" as const) : critiqueLedger.totals.watch > 0 ? ("watch" as const) : ("pass" as const),
      detail: `${critiqueLedger.totals.block} block(s), ${critiqueLedger.totals.watch} watch item(s) from critique.`,
      nextAction: critiqueLedger.totals.block > 0 ? "Resolve critique blockers before a case can teach the system." : "Keep critique evidence attached to the shadow case."
    },
    {
      id: "outcome-label",
      label: "Outcome label",
      status: "block" as const,
      detail: "No settled match outcome label is attached to this MVP AI case.",
      nextAction: "Attach final score, market settlement, closing odds, and result label after the fixture finishes."
    },
    {
      id: "storage-policy",
      label: "Storage policy",
      status: "block" as const,
      detail: "This handoff is read-only; it does not persist memory, outcomes, or training rows.",
      nextAction: "Use the approved Supabase/training gates before any write-mode handoff."
    }
  ];
  const futureFeatureRows = unique([
    "Fixture identity, kickoff time, league, season, home/away teams.",
    "Model probabilities and public posture at decision time.",
    "Provider fixtures, lineups, injuries, suspensions, standings, form, and events.",
    "Bookmaker odds, implied probability, no-vig probability, and closing-line movement.",
    "Final score, settled market result, and calibration outcome.",
    "AI critique verdict, blockers, selected proof, release status, and audit hash."
  ]);
  const outcomeLabelsNeeded = unique([
    "full-time result",
    "market settlement",
    "closing odds snapshot",
    "provider fixture id",
    "decision timestamp",
    "whether the released posture stayed same-or-safer"
  ]);
  const caseId = stableHash({
    release: releasePacket.releaseHash,
    audit: auditTrail.auditHash,
    decision: decisionTurn.turnHash,
    critique: critiqueLedger.ledgerHash
  });
  const canQueueShadowCase = status === "queued-shadow-only";

  return {
    mode: "decision-mvp-ai-learning-handoff",
    generatedAt: now.toISOString(),
    date: releasePacket.date,
    sport: releasePacket.sport,
    status,
    handoffHash: stableHash({
      status,
      caseId,
      requiredEvidence: requiredEvidence.map((item) => [item.id, item.status]),
      futureFeatureRows,
      outcomeLabelsNeeded
    }),
    summary: summaryFor(status),
    learningCase: {
      caseId,
      releaseStatus: releasePacket.status,
      auditStatus: auditTrail.status,
      decisionStatus: decisionTurn.status,
      labelStatus: status === "withheld" ? "blocked" : "unlabeled",
      intendedUse: canQueueShadowCase ? "shadow-evaluation" : "none",
      eligibleForTraining: false,
      eligibleForPublicInfluence: false
    },
    requiredEvidence,
    futureFeatureRows,
    outcomeLabelsNeeded,
    source: {
      critiqueLedgerHash: critiqueLedger.ledgerHash,
      decisionTurnHash: decisionTurn.turnHash,
      releaseHash: releasePacket.releaseHash,
      auditHash: auditTrail.auditHash
    },
    controls: {
      canInspectReadOnly: true,
      canQueueShadowCase,
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
      label: requiredEvidence.find((item) => item.status === "block")?.label ?? "Queue shadow case",
      command: null,
      verifyUrl: "/api/sports/decision/mvp-ai-learning-handoff",
      safeToRun: false,
      expectedEvidence: compact(requiredEvidence.find((item) => item.status === "block")?.nextAction ?? "Keep case shadow-only until settled labels and training gates clear.")
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-ai-learning-handoff",
      ...auditTrail.proofUrls,
      ...releasePacket.proofUrls,
      ...decisionTurn.proofUrls,
      ...critiqueLedger.proofUrls
    ]),
    locks: unique([
      "MVP AI learning handoff is read-only and cannot write memory, outcomes, training rows, or learned weights.",
      "Learning handoff cannot adjust probabilities, raise confidence, publish picks, stake, or expose hidden chain-of-thought.",
      ...auditTrail.locks,
      ...releasePacket.locks,
      ...decisionTurn.locks,
      ...critiqueLedger.locks
    ])
  };
}
