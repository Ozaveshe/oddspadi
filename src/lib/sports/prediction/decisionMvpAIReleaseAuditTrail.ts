import type { DecisionMvpAICritiqueLedger } from "@/lib/sports/prediction/decisionMvpAICritiqueLedger";
import type { DecisionMvpAIAnswerComposer } from "@/lib/sports/prediction/decisionMvpAIAnswerComposer";
import type { DecisionMvpAIAnswerReleasePacket } from "@/lib/sports/prediction/decisionMvpAIAnswerReleasePacket";
import type { DecisionMvpAIAnswerVerifier } from "@/lib/sports/prediction/decisionMvpAIAnswerVerifier";
import type { DecisionMvpAIDecisionTurn } from "@/lib/sports/prediction/decisionMvpAIDecisionTurn";
import type { DecisionMvpAILoopReceipt } from "@/lib/sports/prediction/decisionMvpAILoopReceipt";
import type { DecisionMvpAIPublicAnswerGate } from "@/lib/sports/prediction/decisionMvpAIPublicAnswerGate";
import type { DecisionMvpAIProofCoordinator } from "@/lib/sports/prediction/decisionMvpAIProofCoordinator";

export type DecisionMvpAIReleaseAuditTrailStatus =
  | "released-locked-audit"
  | "released-monitor-audit"
  | "released-shadow-audit"
  | "released-avoid-audit"
  | "withheld-audit";

export type DecisionMvpAIReleaseAuditTrail = {
  mode: "decision-mvp-ai-release-audit-trail";
  generatedAt: string;
  date: string;
  sport: DecisionMvpAIDecisionTurn["sport"];
  status: DecisionMvpAIReleaseAuditTrailStatus;
  auditHash: string;
  summary: string;
  timeline: Array<{
    id: string;
    label: string;
    status: "pass" | "watch" | "block";
    evidenceHash: string;
    publicReason: string;
    nextAction: string;
  }>;
  publicTrace: {
    conclusion: string;
    currentDecision: string;
    currentDoubt: string;
    selectedProof: string;
    whyNoPick: string;
    nextProofUrl: string;
    safetySummary: string;
  };
  source: {
    critiqueLedgerHash: string;
    proofCoordinatorHash: string;
    decisionTurnHash: string;
    loopReceiptHash: string;
    publicAnswerGateHash: string;
    answerHash: string;
    verifierHash: string;
    releaseHash: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRenderAuditTrail: boolean;
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

function compact(value: string | null | undefined, maxLength = 340): string {
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

function statusFor(releasePacket: DecisionMvpAIAnswerReleasePacket): DecisionMvpAIReleaseAuditTrailStatus {
  if (releasePacket.status === "released-shadow") return "released-shadow-audit";
  if (releasePacket.status === "released-monitor") return "released-monitor-audit";
  if (releasePacket.status === "released-avoid") return "released-avoid-audit";
  if (releasePacket.status === "released-locked") return "released-locked-audit";
  return "withheld-audit";
}

function summaryFor(status: DecisionMvpAIReleaseAuditTrailStatus): string {
  if (status === "released-shadow-audit") return "MVP AI release audit trail records a verified shadow-review release and the public-safe reasoning path behind it.";
  if (status === "released-monitor-audit") return "MVP AI release audit trail records a verified monitor-only release and the public-safe reasoning path behind it.";
  if (status === "released-avoid-audit") return "MVP AI release audit trail records a verified avoid-only release and the public-safe reasoning path behind it.";
  if (status === "released-locked-audit") return "MVP AI release audit trail records a verified locked explanation and the evidence blockers behind it.";
  return "MVP AI release audit trail records why the public answer was withheld.";
}

function stepStatusFromBlockers(blocked: boolean, waiting: boolean): "pass" | "watch" | "block" {
  if (blocked) return "block";
  if (waiting) return "watch";
  return "pass";
}

export function buildDecisionMvpAIReleaseAuditTrail({
  critiqueLedger,
  proofCoordinator,
  decisionTurn,
  loopReceipt,
  publicAnswerGate,
  answerComposer,
  answerVerifier,
  releasePacket,
  now = new Date()
}: {
  critiqueLedger: DecisionMvpAICritiqueLedger;
  proofCoordinator: DecisionMvpAIProofCoordinator;
  decisionTurn: DecisionMvpAIDecisionTurn;
  loopReceipt: DecisionMvpAILoopReceipt;
  publicAnswerGate: DecisionMvpAIPublicAnswerGate;
  answerComposer: DecisionMvpAIAnswerComposer;
  answerVerifier: DecisionMvpAIAnswerVerifier;
  releasePacket: DecisionMvpAIAnswerReleasePacket;
  now?: Date;
}): DecisionMvpAIReleaseAuditTrail {
  const status = statusFor(releasePacket);
  const timeline = [
    {
      id: "critique",
      label: "Critique",
      status: stepStatusFromBlockers(critiqueLedger.totals.block > 0, critiqueLedger.totals.watch > 0),
      evidenceHash: critiqueLedger.ledgerHash,
      publicReason: critiqueLedger.summary,
      nextAction: critiqueLedger.nextAction.expectedEvidence
    },
    {
      id: "proof-selection",
      label: "Proof selection",
      status: stepStatusFromBlockers(proofCoordinator.status === "blocked", proofCoordinator.status !== "ready-readonly-proof"),
      evidenceHash: proofCoordinator.coordinatorHash,
      publicReason: proofCoordinator.summary,
      nextAction: proofCoordinator.nextAction.expectedEvidence
    },
    {
      id: "decision-turn",
      label: "Decision turn",
      status: stepStatusFromBlockers(decisionTurn.status === "blocked", decisionTurn.status !== "ready-readonly-proof"),
      evidenceHash: decisionTurn.turnHash,
      publicReason: decisionTurn.turn.decision,
      nextAction: decisionTurn.nextAction.expectedEvidence
    },
    {
      id: "loop-receipt",
      label: "Loop receipt",
      status: stepStatusFromBlockers(loopReceipt.status === "blocked", loopReceipt.loop.continuation !== "continue-readonly"),
      evidenceHash: loopReceipt.loopHash,
      publicReason: loopReceipt.summary,
      nextAction: loopReceipt.nextAction.expectedEvidence
    },
    {
      id: "public-gate",
      label: "Public gate",
      status: publicAnswerGate.publicAnswer.mode === "locked" ? ("watch" as const) : ("pass" as const),
      evidenceHash: publicAnswerGate.gateHash,
      publicReason: publicAnswerGate.summary,
      nextAction: publicAnswerGate.nextAction.expectedEvidence
    },
    {
      id: "composer",
      label: "Composer",
      status: answerComposer.controls.canRenderInDashboard ? ("pass" as const) : ("block" as const),
      evidenceHash: answerComposer.answerHash,
      publicReason: answerComposer.summary,
      nextAction: answerComposer.nextAction.expectedEvidence
    },
    {
      id: "verifier",
      label: "Verifier",
      status: answerVerifier.status === "failed" ? ("block" as const) : ("pass" as const),
      evidenceHash: answerVerifier.verifierHash,
      publicReason: answerVerifier.summary,
      nextAction: answerVerifier.nextAction.expectedEvidence
    },
    {
      id: "release",
      label: "Release",
      status: releasePacket.status === "withheld" ? ("block" as const) : ("pass" as const),
      evidenceHash: releasePacket.releaseHash,
      publicReason: releasePacket.summary,
      nextAction: releasePacket.nextAction.expectedEvidence
    }
  ];

  const currentDecision = compact(decisionTurn.turn.decision, 260);
  const currentDoubt = compact(decisionTurn.turn.doubt, 260);
  const selectedProof = compact(proofCoordinator.selectedStep.label, 160);
  const whyNoPick = releasePacket.controls.canRenderAsPick
    ? "Pick rendering is unexpectedly open."
    : "No pick is released because the verified packet remains explanation-only and action-locked.";

  return {
    mode: "decision-mvp-ai-release-audit-trail",
    generatedAt: now.toISOString(),
    date: releasePacket.date,
    sport: releasePacket.sport,
    status,
    auditHash: stableHash({
      status,
      source: [
        critiqueLedger.ledgerHash,
        proofCoordinator.coordinatorHash,
        decisionTurn.turnHash,
        loopReceipt.loopHash,
        publicAnswerGate.gateHash,
        answerComposer.answerHash,
        answerVerifier.verifierHash,
        releasePacket.releaseHash
      ],
      timeline: timeline.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status),
    timeline,
    publicTrace: {
      conclusion: compact(releasePacket.summary, 260),
      currentDecision,
      currentDoubt,
      selectedProof,
      whyNoPick,
      nextProofUrl: releasePacket.nextAction.verifyUrl,
      safetySummary: "Public trace excludes hidden chain-of-thought and keeps provider writes, persistence, training, publishing, staking, probability edits, and confidence raises locked."
    },
    source: {
      critiqueLedgerHash: critiqueLedger.ledgerHash,
      proofCoordinatorHash: proofCoordinator.coordinatorHash,
      decisionTurnHash: decisionTurn.turnHash,
      loopReceiptHash: loopReceipt.loopHash,
      publicAnswerGateHash: publicAnswerGate.gateHash,
      answerHash: answerComposer.answerHash,
      verifierHash: answerVerifier.verifierHash,
      releaseHash: releasePacket.releaseHash
    },
    controls: {
      canInspectReadOnly: true,
      canRenderAuditTrail: status !== "withheld-audit",
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
      label: releasePacket.nextAction.label,
      command: null,
      verifyUrl: releasePacket.nextAction.verifyUrl,
      safeToRun: false,
      expectedEvidence: releasePacket.nextAction.expectedEvidence
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-ai-release-audit-trail",
      ...releasePacket.proofUrls,
      ...answerVerifier.proofUrls,
      ...answerComposer.proofUrls,
      ...publicAnswerGate.proofUrls,
      ...loopReceipt.proofUrls,
      ...decisionTurn.proofUrls,
      ...proofCoordinator.proofUrls,
      ...critiqueLedger.proofUrls
    ]),
    locks: unique([
      "MVP AI release audit trail is public-safe and excludes hidden chain-of-thought.",
      "Audit trail cannot call OpenAI, fetch providers, write provider rows, persist decisions, train, apply learned weights, adjust probabilities, raise confidence, publish picks, stake, or expose hidden reasoning.",
      ...releasePacket.locks,
      ...answerVerifier.locks,
      ...answerComposer.locks,
      ...publicAnswerGate.locks,
      ...loopReceipt.locks,
      ...decisionTurn.locks,
      ...proofCoordinator.locks,
      ...critiqueLedger.locks
    ])
  };
}
