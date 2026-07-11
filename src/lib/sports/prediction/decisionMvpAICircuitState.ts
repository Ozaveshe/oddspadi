import type { DecisionMvpAIAnswerComposer } from "@/lib/sports/prediction/decisionMvpAIAnswerComposer";
import type { DecisionMvpAIAnswerReleasePacket } from "@/lib/sports/prediction/decisionMvpAIAnswerReleasePacket";
import type { DecisionMvpAIAnswerVerifier } from "@/lib/sports/prediction/decisionMvpAIAnswerVerifier";
import type { DecisionMvpAICritiqueLedger } from "@/lib/sports/prediction/decisionMvpAICritiqueLedger";
import type { DecisionMvpAIDecisionTurn } from "@/lib/sports/prediction/decisionMvpAIDecisionTurn";
import type { DecisionMvpAIExperimentMemory } from "@/lib/sports/prediction/decisionMvpAIExperimentMemory";
import type { DecisionMvpAIExperimentObserver } from "@/lib/sports/prediction/decisionMvpAIExperimentObserver";
import type { DecisionMvpAILearningHandoff } from "@/lib/sports/prediction/decisionMvpAILearningHandoff";
import type { DecisionMvpAILearningQuarantine } from "@/lib/sports/prediction/decisionMvpAILearningQuarantine";
import type { DecisionMvpAILoopReceipt } from "@/lib/sports/prediction/decisionMvpAILoopReceipt";
import type { DecisionMvpAIOutcomeLabelGate } from "@/lib/sports/prediction/decisionMvpAIOutcomeLabelGate";
import type { DecisionMvpAIProofCoordinator } from "@/lib/sports/prediction/decisionMvpAIProofCoordinator";
import type { DecisionMvpAIPromotionFirewall } from "@/lib/sports/prediction/decisionMvpAIPromotionFirewall";
import type { DecisionMvpAIPublicAnswerGate } from "@/lib/sports/prediction/decisionMvpAIPublicAnswerGate";
import type { DecisionMvpAIReleaseAuditTrail } from "@/lib/sports/prediction/decisionMvpAIReleaseAuditTrail";
import type { DecisionMvpAIReviewPacket } from "@/lib/sports/prediction/decisionMvpAIReviewPacket";
import type { DecisionMvpAIReviewRunner } from "@/lib/sports/prediction/decisionMvpAIReviewRunner";
import type { DecisionMvpAIShadowCalibrationBridge } from "@/lib/sports/prediction/decisionMvpAIShadowCalibrationBridge";
import type { DecisionProviderEnvDiagnostic } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import type { DecisionMvpProviderProofGate } from "@/lib/sports/prediction/decisionMvpProviderProofGate";

export type DecisionMvpAICircuitStateStatus =
  | "blocked-provider-evidence"
  | "blocked-ai-review"
  | "blocked-public-release"
  | "blocked-learning-labels"
  | "blocked-calibration"
  | "blocked-promotion"
  | "shadow-ready"
  | "withheld";

export type DecisionMvpAICircuitStageStatus = "pass" | "watch" | "block";

export type DecisionMvpAICircuitStage = {
  id: string;
  label: string;
  status: DecisionMvpAICircuitStageStatus;
  sourceStatus: string;
  evidenceHash: string;
  proofUrl: string;
  detail: string;
  unlocks: string[];
};

export type DecisionMvpAICircuitState = {
  mode: "decision-mvp-ai-circuit-state";
  generatedAt: string;
  date: string;
  sport: DecisionMvpAIReviewPacket["sport"];
  status: DecisionMvpAICircuitStateStatus;
  circuitHash: string;
  summary: string;
  progress: {
    completedStages: number;
    totalStages: number;
    percent: number;
    currentStageId: string;
    currentStageLabel: string;
    firstBlocker: string;
    firstBlockerProofUrl: string;
  };
  providerMinimum: {
    status: DecisionProviderEnvDiagnostic["footballMvpMinimum"]["status"];
    requiredLaneIds: DecisionProviderEnvDiagnostic["footballMvpMinimum"]["requiredLaneIds"];
    recommendedEnvNames: DecisionProviderEnvDiagnostic["footballMvpMinimum"]["recommendedEnvNames"];
    acceptedAlternativeEnvNames: string[];
    configuredKeys: string[];
    placeholderKeys: string[];
    missingKeys: string[];
    nextMissingEnvName: string | null;
    nextAction: string;
    proofUrl: string;
  };
  stages: DecisionMvpAICircuitStage[];
  allowedActions: {
    canInspectReadOnly: true;
    canSubmitToOpenAI: boolean;
    canRunReadOnlyProof: boolean;
    canRenderPublicAnswer: boolean;
    canRetainShadowSignals: boolean;
    canDraftOutcomeLabel: boolean;
    canRunCalibration: boolean;
    canSimulateShadowPromotion: boolean;
    canPersistDecisions: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
    allowedScope: "none" | "monitor-only" | "shadow-review" | "shadow-memory";
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

function stage(input: DecisionMvpAICircuitStage): DecisionMvpAICircuitStage {
  return {
    ...input,
    detail: compact(input.detail, 300),
    unlocks: unique(input.unlocks, 6)
  };
}

function statusFromBool(ready: boolean, waiting: boolean, blocked: boolean): DecisionMvpAICircuitStageStatus {
  if (blocked) return "block";
  if (waiting) return "watch";
  if (ready) return "pass";
  return "watch";
}

function statusForCurrentStage(stageId: string, stageStatus: DecisionMvpAICircuitStageStatus): DecisionMvpAICircuitStateStatus {
  if (stageStatus !== "block") return "withheld";
  if (stageId === "provider-evidence") return "blocked-provider-evidence";
  if (["ai-review-packet", "ai-review-runner", "critique-ledger", "proof-coordinator", "decision-turn", "experiment-observer", "experiment-memory", "loop-receipt"].includes(stageId)) {
    return "blocked-ai-review";
  }
  if (["public-answer-gate", "answer-composer", "answer-verifier", "release-packet", "release-audit"].includes(stageId)) {
    return "blocked-public-release";
  }
  if (["learning-handoff", "learning-quarantine", "outcome-label"].includes(stageId)) return "blocked-learning-labels";
  if (stageId === "shadow-calibration") return "blocked-calibration";
  return "blocked-promotion";
}

function summaryFor(status: DecisionMvpAICircuitStateStatus, current: DecisionMvpAICircuitStage): string {
  if (status === "shadow-ready") return "MVP AI circuit is ready for shadow-only comparison; public picks, staking, and learned-weight promotion remain locked.";
  if (status === "blocked-provider-evidence") return "MVP AI circuit is stopped at provider evidence: fixtures, odds, live signals, or settlement truth are missing.";
  if (status === "blocked-ai-review") return "MVP AI circuit is stopped inside the guarded AI review and proof loop.";
  if (status === "blocked-public-release") return "MVP AI circuit is stopped before safe public-copy release.";
  if (status === "blocked-learning-labels") return "MVP AI circuit is stopped before outcome labels can become shadow learning evidence.";
  if (status === "blocked-calibration") return "MVP AI circuit is stopped before calibration math has settled labels and sample size.";
  if (status === "blocked-promotion") return "MVP AI circuit is stopped before learned weights can be promoted even to shadow memory.";
  return `MVP AI circuit is withheld at ${current.label}.`;
}

function scopeFor({
  publicAnswerGate,
  promotionFirewall
}: {
  publicAnswerGate: DecisionMvpAIPublicAnswerGate;
  promotionFirewall: DecisionMvpAIPromotionFirewall;
}): DecisionMvpAICircuitState["allowedActions"]["allowedScope"] {
  if (promotionFirewall.promotionCase.allowedScope === "shadow-memory") return "shadow-memory";
  if (publicAnswerGate.publicAnswer.mode === "shadow-review") return "shadow-review";
  if (publicAnswerGate.publicAnswer.mode === "monitor-only" || publicAnswerGate.publicAnswer.mode === "avoid-only") return "monitor-only";
  return "none";
}

export function buildDecisionMvpAICircuitState({
  reviewPacket,
  reviewRunner,
  providerEnvDiagnostic,
  providerProofGate,
  critiqueLedger,
  proofCoordinator,
  decisionTurn,
  experimentObserver,
  experimentMemory,
  loopReceipt,
  publicAnswerGate,
  answerComposer,
  answerVerifier,
  releasePacket,
  auditTrail,
  learningHandoff,
  learningQuarantine,
  outcomeLabelGate,
  shadowCalibrationBridge,
  promotionFirewall,
  now = new Date()
}: {
  reviewPacket: DecisionMvpAIReviewPacket;
  reviewRunner: DecisionMvpAIReviewRunner;
  providerEnvDiagnostic: DecisionProviderEnvDiagnostic;
  providerProofGate: DecisionMvpProviderProofGate;
  critiqueLedger: DecisionMvpAICritiqueLedger;
  proofCoordinator: DecisionMvpAIProofCoordinator;
  decisionTurn: DecisionMvpAIDecisionTurn;
  experimentObserver: DecisionMvpAIExperimentObserver;
  experimentMemory: DecisionMvpAIExperimentMemory;
  loopReceipt: DecisionMvpAILoopReceipt;
  publicAnswerGate: DecisionMvpAIPublicAnswerGate;
  answerComposer: DecisionMvpAIAnswerComposer;
  answerVerifier: DecisionMvpAIAnswerVerifier;
  releasePacket: DecisionMvpAIAnswerReleasePacket;
  auditTrail: DecisionMvpAIReleaseAuditTrail;
  learningHandoff: DecisionMvpAILearningHandoff;
  learningQuarantine: DecisionMvpAILearningQuarantine;
  outcomeLabelGate: DecisionMvpAIOutcomeLabelGate;
  shadowCalibrationBridge: DecisionMvpAIShadowCalibrationBridge;
  promotionFirewall: DecisionMvpAIPromotionFirewall;
  now?: Date;
}): DecisionMvpAICircuitState {
  const providerMinimum = providerEnvDiagnostic.footballMvpMinimum;
  const missingProviderEnv = providerMinimum.missingKeys.length
    ? providerMinimum.missingKeys
    : providerProofGate.selected?.missingEnv.length
      ? providerProofGate.selected.missingEnv
      : decisionTurn.evidence.missingEnv;
  const providerStageStatus: DecisionMvpAICircuitStageStatus =
    providerMinimum.status === "missing-critical" ||
    providerMinimum.status === "placeholder-values" ||
    providerProofGate.status === "waiting-provider-env" ||
    providerProofGate.status === "blocked" ||
    providerProofGate.status === "provider-error"
      ? "block"
      : providerMinimum.status === "partial" ||
          providerProofGate.status === "waiting-admin-token" ||
          providerProofGate.status === "ready-dry-run" ||
          providerProofGate.status === "provider-warning"
        ? "watch"
        : "pass";
  const stages = [
    stage({
      id: "provider-evidence",
      label: "Provider evidence",
      status: providerStageStatus,
      sourceStatus: providerMinimum.status,
      evidenceHash: stableHash({ providerMinimum, gateHash: providerProofGate.gateHash }),
      proofUrl: providerMinimum.proofUrl,
      detail: missingProviderEnv.length
        ? `Missing provider env: ${missingProviderEnv.join(", ")}.`
        : providerMinimum.nextAction,
      unlocks: ["fixtures", "odds", "lineups/injuries", "settlement truth", "read-only proof turns"]
    }),
    stage({
      id: "ai-review-packet",
      label: "AI review packet",
      status: statusFromBool(
        reviewPacket.status === "ready-preview" || reviewPacket.status === "ready-to-submit",
        reviewPacket.status === "waiting-cycle-proof",
        reviewPacket.status === "blocked" || reviewPacket.status === "needs-openai"
      ),
      sourceStatus: reviewPacket.status,
      evidenceHash: reviewPacket.packetHash,
      proofUrl: "/api/sports/decision/mvp-ai-review-packet",
      detail: reviewPacket.summary,
      unlocks: ["strict JSON review contract", "store=false OpenAI request preview", "same-or-safer critique"]
    }),
    stage({
      id: "ai-review-runner",
      label: "AI review runner",
      status: statusFromBool(
        reviewRunner.status === "reviewed",
        reviewRunner.status === "not-requested",
        reviewRunner.status === "waiting-packet" || reviewRunner.status === "not-configured" || reviewRunner.status === "invalid-response" || reviewRunner.status === "provider-error"
      ),
      sourceStatus: reviewRunner.status,
      evidenceHash: reviewRunner.runnerHash,
      proofUrl: "/api/sports/decision/mvp-ai-review-runner",
      detail: reviewRunner.summary,
      unlocks: ["guarded OpenAI review", "deterministic fallback", "review hash"]
    }),
    stage({
      id: "critique-ledger",
      label: "Critique ledger",
      status: statusFromBool(
        critiqueLedger.status === "same-or-safer",
        critiqueLedger.status === "needs-evidence" || critiqueLedger.status === "downgrade-required",
        critiqueLedger.status === "not-reviewed" || critiqueLedger.status === "blocked"
      ),
      sourceStatus: critiqueLedger.status,
      evidenceHash: critiqueLedger.ledgerHash,
      proofUrl: "/api/sports/decision/mvp-ai-critique-ledger",
      detail: critiqueLedger.summary,
      unlocks: ["missing-evidence list", "unsupported-claim guard", "same-or-safer effect"]
    }),
    stage({
      id: "proof-coordinator",
      label: "Proof coordinator",
      status: statusFromBool(
        proofCoordinator.status === "ready-readonly-proof",
        proofCoordinator.status === "waiting-provider" || proofCoordinator.status === "waiting-review" || proofCoordinator.status === "hold",
        proofCoordinator.status === "blocked"
      ),
      sourceStatus: proofCoordinator.status,
      evidenceHash: proofCoordinator.coordinatorHash,
      proofUrl: "/api/sports/decision/mvp-ai-proof-coordinator",
      detail: proofCoordinator.summary,
      unlocks: ["selected proof", "safe-to-run flag", "next evidence target"]
    }),
    stage({
      id: "decision-turn",
      label: "Decision turn",
      status: statusFromBool(
        decisionTurn.status === "ready-readonly-proof",
        decisionTurn.status === "waiting-provider" || decisionTurn.status === "waiting-review" || decisionTurn.status === "hold",
        decisionTurn.status === "blocked"
      ),
      sourceStatus: decisionTurn.status,
      evidenceHash: decisionTurn.turnHash,
      proofUrl: "/api/sports/decision/mvp-ai-decision-turn",
      detail: decisionTurn.summary,
      unlocks: ["observation", "belief", "doubt", "public-safe decision"]
    }),
    stage({
      id: "experiment-observer",
      label: "Experiment observer",
      status: statusFromBool(
        experimentObserver.status === "observed-support",
        experimentObserver.status === "ready-observation" || experimentObserver.status === "observed-warning" || experimentObserver.status === "failed",
        experimentObserver.status === "blocked" || experimentObserver.status === "observed-contradiction"
      ),
      sourceStatus: experimentObserver.status,
      evidenceHash: experimentObserver.observerHash,
      proofUrl: "/api/sports/decision/mvp-ai-experiment-observer",
      detail: experimentObserver.summary,
      unlocks: ["read-only proof observation", "support/warning/contradiction signal", "observer hash"]
    }),
    stage({
      id: "experiment-memory",
      label: "Experiment memory",
      status: statusFromBool(
        experimentMemory.status === "ready-shadow-memory",
        experimentMemory.status === "waiting-observation" || experimentMemory.status === "warning-review",
        experimentMemory.status === "blocked" || experimentMemory.status === "contradiction-review"
      ),
      sourceStatus: experimentMemory.status,
      evidenceHash: experimentMemory.memoryHash,
      proofUrl: "/api/sports/decision/mvp-ai-experiment-memory",
      detail: experimentMemory.summary,
      unlocks: ["learned signal", "remaining doubt", "next safe move", "shadow-only working memory"]
    }),
    stage({
      id: "loop-receipt",
      label: "Loop receipt",
      status: statusFromBool(
        loopReceipt.status === "ready-next-proof",
        loopReceipt.status === "waiting-provider" || loopReceipt.status === "waiting-review" || loopReceipt.status === "hold",
        loopReceipt.status === "blocked"
      ),
      sourceStatus: loopReceipt.status,
      evidenceHash: loopReceipt.loopHash,
      proofUrl: "/api/sports/decision/mvp-ai-loop-receipt",
      detail: loopReceipt.summary,
      unlocks: ["loop continuation", "stop reasons", "learning candidate"]
    }),
    stage({
      id: "public-answer-gate",
      label: "Public answer gate",
      status: statusFromBool(
        publicAnswerGate.status === "monitor-only" || publicAnswerGate.status === "ready-shadow-answer",
        publicAnswerGate.status === "waiting-provider" || publicAnswerGate.status === "waiting-review",
        publicAnswerGate.status === "blocked"
      ),
      sourceStatus: publicAnswerGate.status,
      evidenceHash: publicAnswerGate.gateHash,
      proofUrl: "/api/sports/decision/mvp-ai-public-answer-gate",
      detail: publicAnswerGate.summary,
      unlocks: ["monitor-only copy", "risk copy", "safer alternatives"]
    }),
    stage({
      id: "answer-composer",
      label: "Answer composer",
      status: answerComposer.controls.canRenderInDashboard ? "pass" : "watch",
      sourceStatus: answerComposer.status,
      evidenceHash: answerComposer.answerHash,
      proofUrl: "/api/sports/decision/mvp-ai-answer-composer",
      detail: answerComposer.summary,
      unlocks: ["public-safe answer copy", "risk list", "omitted claims"]
    }),
    stage({
      id: "answer-verifier",
      label: "Answer verifier",
      status: answerVerifier.status === "failed" ? "block" : "pass",
      sourceStatus: answerVerifier.status,
      evidenceHash: answerVerifier.verifierHash,
      proofUrl: "/api/sports/decision/mvp-ai-answer-verifier",
      detail: answerVerifier.summary,
      unlocks: ["render-mode verdict", "unsafe-claim scan", "public-copy envelope"]
    }),
    stage({
      id: "release-packet",
      label: "Release packet",
      status: releasePacket.status === "withheld" ? "block" : "pass",
      sourceStatus: releasePacket.status,
      evidenceHash: releasePacket.releaseHash,
      proofUrl: "/api/sports/decision/mvp-ai-answer-release-packet",
      detail: releasePacket.summary,
      unlocks: ["verified locked/monitor/shadow copy", "release provenance"]
    }),
    stage({
      id: "release-audit",
      label: "Release audit",
      status: auditTrail.status === "withheld-audit" ? "block" : "pass",
      sourceStatus: auditTrail.status,
      evidenceHash: auditTrail.auditHash,
      proofUrl: "/api/sports/decision/mvp-ai-release-audit-trail",
      detail: auditTrail.summary,
      unlocks: ["public trace", "timeline", "why no pick"]
    }),
    stage({
      id: "learning-handoff",
      label: "Learning handoff",
      status: statusFromBool(
        learningHandoff.status === "queued-shadow-only",
        learningHandoff.status === "waiting-outcome-label",
        learningHandoff.status === "blocked-evidence" || learningHandoff.status === "withheld"
      ),
      sourceStatus: learningHandoff.status,
      evidenceHash: learningHandoff.handoffHash,
      proofUrl: "/api/sports/decision/mvp-ai-learning-handoff",
      detail: learningHandoff.summary,
      unlocks: ["shadow case", "feature-row plan", "outcome-label requirements"]
    }),
    stage({
      id: "learning-quarantine",
      label: "Learning quarantine",
      status: statusFromBool(
        learningQuarantine.status === "shadow-quarantine-ready",
        learningQuarantine.status === "quarantined-labels",
        learningQuarantine.status === "quarantined-evidence" || learningQuarantine.status === "withheld"
      ),
      sourceStatus: learningQuarantine.status,
      evidenceHash: learningQuarantine.quarantineHash,
      proofUrl: "/api/sports/decision/mvp-ai-learning-quarantine",
      detail: learningQuarantine.summary,
      unlocks: ["shadow-only retention", "public influence firewall"]
    }),
    stage({
      id: "outcome-label",
      label: "Outcome label gate",
      status: statusFromBool(
        outcomeLabelGate.status === "ready-shadow-label",
        outcomeLabelGate.status === "waiting-settlement",
        outcomeLabelGate.status === "blocked-evidence" || outcomeLabelGate.status === "withheld"
      ),
      sourceStatus: outcomeLabelGate.status,
      evidenceHash: outcomeLabelGate.labelGateHash,
      proofUrl: "/api/sports/decision/mvp-ai-outcome-label-gate",
      detail: outcomeLabelGate.summary,
      unlocks: ["final score", "market settlement", "closing odds", "shadow training row shape"]
    }),
    stage({
      id: "shadow-calibration",
      label: "Shadow calibration",
      status: statusFromBool(
        shadowCalibrationBridge.status === "shadow-calibration-ready",
        shadowCalibrationBridge.status === "waiting-sample",
        shadowCalibrationBridge.status === "waiting-labels" || shadowCalibrationBridge.status === "withheld"
      ),
      sourceStatus: shadowCalibrationBridge.status,
      evidenceHash: shadowCalibrationBridge.bridgeHash,
      proofUrl: "/api/sports/decision/mvp-ai-shadow-calibration-bridge",
      detail: shadowCalibrationBridge.summary,
      unlocks: ["Brier score", "log loss", "CLV", "ROI", "calibration buckets"]
    }),
    stage({
      id: "promotion-firewall",
      label: "Promotion firewall",
      status: statusFromBool(
        promotionFirewall.status === "shadow-only-ready",
        promotionFirewall.status === "blocked-sample" || promotionFirewall.status === "blocked-governance",
        promotionFirewall.status === "blocked-labels" || promotionFirewall.status === "withheld"
      ),
      sourceStatus: promotionFirewall.status,
      evidenceHash: promotionFirewall.firewallHash,
      proofUrl: "/api/sports/decision/mvp-ai-promotion-firewall",
      detail: promotionFirewall.summary,
      unlocks: ["shadow-memory comparison", "operator-reviewed promotion gates"]
    })
  ];

  const completedStages = stages.filter((item) => item.status === "pass").length;
  const totalStages = stages.length;
  const current = stages.find((item) => item.status !== "pass") ?? stages[stages.length - 1];
  const firstBlocker = stages.find((item) => item.status === "block") ?? current;
  const status = stages.every((item) => item.status === "pass") ? "shadow-ready" : statusForCurrentStage(firstBlocker.id, firstBlocker.status);
  const allowedScope = scopeFor({ publicAnswerGate, promotionFirewall });
  const proofUrls = unique([
    "/api/sports/decision/mvp-ai-circuit-state",
    ...stages.map((item) => item.proofUrl),
    ...providerEnvDiagnostic.proofUrls,
    ...providerProofGate.proofUrls,
    ...reviewPacket.proofUrls,
    ...reviewRunner.proofUrls,
    ...critiqueLedger.proofUrls,
    ...proofCoordinator.proofUrls,
    ...decisionTurn.proofUrls,
    ...experimentObserver.proofUrls,
    ...experimentMemory.proofUrls,
    ...loopReceipt.proofUrls,
    ...publicAnswerGate.proofUrls,
    ...answerComposer.proofUrls,
    ...answerVerifier.proofUrls,
    ...releasePacket.proofUrls,
    ...auditTrail.proofUrls,
    ...learningHandoff.proofUrls,
    ...learningQuarantine.proofUrls,
    ...outcomeLabelGate.proofUrls,
    ...shadowCalibrationBridge.proofUrls,
    ...promotionFirewall.proofUrls
  ]);
  const nextAction =
    firstBlocker.id === "provider-evidence"
      ? {
          label: "Add provider and odds keys, restart localhost, then rerun the live activation proof.",
          command: null,
          verifyUrl: firstBlocker.proofUrl,
          safeToRun: false,
          expectedEvidence: firstBlocker.detail
        }
      : {
          label: `Repair ${firstBlocker.label}.`,
          command: null,
          verifyUrl: firstBlocker.proofUrl,
          safeToRun: false,
          expectedEvidence: firstBlocker.detail
        };

  return {
    mode: "decision-mvp-ai-circuit-state",
    generatedAt: now.toISOString(),
    date: reviewPacket.date,
    sport: reviewPacket.sport,
    status,
    circuitHash: stableHash({
      status,
      stages: stages.map((item) => [item.id, item.status, item.evidenceHash, item.sourceStatus]),
      allowedScope,
      experimentObserver: experimentObserver.observerHash,
      experimentMemory: experimentMemory.memoryHash,
      firstBlocker: firstBlocker.id
    }),
    summary: summaryFor(status, firstBlocker),
    progress: {
      completedStages,
      totalStages,
      percent: Math.round((completedStages / Math.max(1, totalStages)) * 100),
      currentStageId: current.id,
      currentStageLabel: current.label,
      firstBlocker: `${firstBlocker.label}: ${firstBlocker.detail}`,
      firstBlockerProofUrl: firstBlocker.proofUrl
    },
    providerMinimum: {
      status: providerMinimum.status,
      requiredLaneIds: providerMinimum.requiredLaneIds,
      recommendedEnvNames: providerMinimum.recommendedEnvNames,
      acceptedAlternativeEnvNames: providerMinimum.acceptedAlternativeEnvNames,
      configuredKeys: providerMinimum.configuredKeys,
      placeholderKeys: providerMinimum.placeholderKeys,
      missingKeys: providerMinimum.missingKeys,
      nextMissingEnvName: providerMinimum.nextMissingEnvName,
      nextAction: providerMinimum.nextAction,
      proofUrl: providerMinimum.proofUrl
    },
    stages,
    allowedActions: {
      canInspectReadOnly: true,
      canSubmitToOpenAI: reviewPacket.controls.canSubmitToOpenAI && reviewRunner.controls.canRequestOpenAI,
      canRunReadOnlyProof: decisionTurn.controls.canRunSelectedProof && experimentObserver.controls.canObserveProof && experimentMemory.controls.canRunObserver && loopReceipt.controls.canRunSelectedProof,
      canRenderPublicAnswer: releasePacket.controls.canRenderPublicAnswer,
      canRetainShadowSignals: learningQuarantine.controls.canRetainReadOnlySignals,
      canDraftOutcomeLabel: outcomeLabelGate.controls.canDraftShadowLabel,
      canRunCalibration: shadowCalibrationBridge.controls.canStageShadowCalibration,
      canSimulateShadowPromotion: promotionFirewall.controls.canSimulateShadowPromotion,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      allowedScope
    },
    nextAction,
    proofUrls,
    locks: unique(
      [
        "MVP AI circuit state is read-only and cannot persist decisions, training rows, learned weights, public probabilities, picks, stakes, or hidden chain-of-thought.",
        "Provider fixtures, odds, news, lineups, injuries, live scores, and settlement labels must be proven before promotion.",
        "Outcome labels and calibration math must remain shadow-only until sample size, CLV, backtest, and operator approval gates clear.",
        ...experimentMemory.locks,
        ...experimentObserver.locks,
        ...promotionFirewall.locks,
        ...shadowCalibrationBridge.locks,
        ...learningQuarantine.locks
      ],
      12
    )
  };
}
