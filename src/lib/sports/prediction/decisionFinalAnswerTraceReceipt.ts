import type { DecisionAILiveCycleReceipt } from "@/lib/sports/prediction/decisionAILiveCycleReceipt";
import type { DecisionDataBackbone } from "@/lib/sports/prediction/decisionDataBackbone";
import type { DecisionEngineActivationContract } from "@/lib/sports/prediction/decisionEngineActivationContract";
import type { DecisionAnswerPromotionGate } from "@/lib/sports/prediction/decisionAnswerPromotionGate";
import type { DecisionFinalAnswerContract } from "@/lib/sports/prediction/decisionFinalAnswerContract";
import type { DecisionFinalAnswerValidationReceipt } from "@/lib/sports/prediction/decisionFinalAnswerValidationReceipt";
import type { DecisionMarketAuditMatrix } from "@/lib/sports/prediction/decisionMarketAuditMatrix";
import type { DecisionModelReasoningLedger } from "@/lib/sports/prediction/decisionModelReasoningLedger";
import type { DecisionTrustFirewall } from "@/lib/sports/prediction/decisionTrustFirewall";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

export type DecisionFinalAnswerTraceStatus = "valid-trace" | "watch-trace" | "blocked-trace";
export type DecisionFinalAnswerTraceStepStatus = "pass" | "watch" | "block";

export type DecisionFinalAnswerTraceStep = {
  id:
    | "data-backbone"
    | "model-reasoning"
    | "market-edge"
    | "ai-rule"
    | "activation-contract"
    | "final-answer"
    | "promotion-gate"
    | "validation";
  label: string;
  status: DecisionFinalAnswerTraceStepStatus;
  sourceHash: string;
  claim: string;
  evidence: string;
  proofUrl: string;
  nextAction: string;
};

export type DecisionFinalAnswerTraceReceipt = {
  mode: "decision-final-answer-trace-receipt";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionFinalAnswerTraceStatus;
  traceHash: string;
  summary: string;
  target: {
    matchId: string | null;
    match: string | null;
    market: string | null;
    selection: string | null;
    action: DecisionFinalAnswerContract["publicAnswer"]["action"];
  };
  lineage: {
    dataBackboneHash: string;
    modelReasoningHash: string;
    marketMatrixHash: string;
    aiReceiptHash: string;
    activationHash: string;
    firewallHash: string;
    finalAnswerHash: string;
    promotionHash: string;
    validationHash: string;
  };
  steps: DecisionFinalAnswerTraceStep[];
  totals: {
    steps: number;
    pass: number;
    watch: number;
    block: number;
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canAlterFinalAnswer: false;
    canUseHiddenChainOfThought: false;
    canUpgradePublicAction: false;
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

function compact(value: string | null | undefined, maxLength = 240): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No public detail available.";
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function step(input: DecisionFinalAnswerTraceStep): DecisionFinalAnswerTraceStep {
  return {
    ...input,
    claim: compact(input.claim, 220),
    evidence: compact(input.evidence, 240),
    nextAction: compact(input.nextAction, 220)
  };
}

function statusFor(steps: DecisionFinalAnswerTraceStep[]): DecisionFinalAnswerTraceStatus {
  if (steps.some((item) => item.status === "block")) return "blocked-trace";
  if (steps.some((item) => item.status === "watch")) return "watch-trace";
  return "valid-trace";
}

function totalsFor(steps: DecisionFinalAnswerTraceStep[]): DecisionFinalAnswerTraceReceipt["totals"] {
  return {
    steps: steps.length,
    pass: steps.filter((item) => item.status === "pass").length,
    watch: steps.filter((item) => item.status === "watch").length,
    block: steps.filter((item) => item.status === "block").length
  };
}

function summaryFor(status: DecisionFinalAnswerTraceStatus, totals: DecisionFinalAnswerTraceReceipt["totals"]): string {
  if (status === "valid-trace") return `Final answer trace links all ${totals.steps} evidence steps without contradictions.`;
  if (status === "watch-trace") return `Final answer trace is coherent, with ${totals.watch} watch step(s) needing stronger evidence.`;
  return `Final answer trace is blocked by ${totals.block} upstream evidence step(s); keep the public answer locked.`;
}

function dataStatus(status: DecisionDataBackbone["status"]): DecisionFinalAnswerTraceStepStatus {
  if (status === "ready-provider-dry-run") return "pass";
  if (status === "needs-provider-env" || status === "needs-corpus" || status === "needs-storage-proof") return "watch";
  return "block";
}

function reasoningStatus(status: DecisionModelReasoningLedger["status"]): DecisionFinalAnswerTraceStepStatus {
  if (status === "ready-shadow") return "pass";
  if (status === "needs-training" || status === "needs-provider") return "watch";
  return "block";
}

function marketStatus(status: DecisionMarketAuditMatrix["status"]): DecisionFinalAnswerTraceStepStatus {
  if (status === "positive-ev") return "pass";
  if (status === "watch") return "watch";
  return "block";
}

function aiStatus(status: DecisionAILiveCycleReceipt["status"]): DecisionFinalAnswerTraceStepStatus {
  if (status === "reviewed" || status === "ready-live-review" || status === "ready-readonly") return "pass";
  if (status === "waiting-openai" || status === "needs-evidence") return "watch";
  return "block";
}

function finalAnswerStatus(status: DecisionFinalAnswerContract["status"]): DecisionFinalAnswerTraceStepStatus {
  if (status === "shadow-candidate") return "pass";
  if (status === "monitor" || status === "avoid") return "watch";
  return "block";
}

function promotionStatus(status: DecisionAnswerPromotionGate["status"]): DecisionFinalAnswerTraceStepStatus {
  if (status === "monitor-eligible") return "pass";
  if (status === "watch-only") return "watch";
  return "block";
}

function validationStatus(status: DecisionFinalAnswerValidationReceipt["status"]): DecisionFinalAnswerTraceStepStatus {
  if (status === "valid") return "pass";
  if (status === "watch") return "watch";
  return "block";
}

function nextActionFor(steps: DecisionFinalAnswerTraceStep[]): DecisionFinalAnswerTraceReceipt["nextAction"] {
  const next = steps.find((item) => item.status === "block") ?? steps.find((item) => item.status === "watch") ?? steps[0];
  const verifyUrl = "/api/sports/decision/final-answer-trace";
  return {
    label: next?.label ?? "Inspect final answer trace",
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    safeToRun: true,
    expectedEvidence: next?.nextAction ?? "Trace receipt returns the data, model, market, AI, activation, final-answer, and validation chain."
  };
}

export function buildDecisionFinalAnswerTraceReceipt({
  date,
  sport,
  dataBackbone,
  modelReasoningLedger,
  marketAuditMatrix,
  aiLiveCycleReceipt,
  engineActivationContract,
  trustFirewall,
  finalAnswer,
  answerPromotionGate,
  validation,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  dataBackbone: DecisionDataBackbone;
  modelReasoningLedger: DecisionModelReasoningLedger;
  marketAuditMatrix: DecisionMarketAuditMatrix;
  aiLiveCycleReceipt: DecisionAILiveCycleReceipt;
  engineActivationContract: DecisionEngineActivationContract;
  trustFirewall: DecisionTrustFirewall;
  finalAnswer: DecisionFinalAnswerContract;
  answerPromotionGate: DecisionAnswerPromotionGate;
  validation: DecisionFinalAnswerValidationReceipt;
  now?: Date;
}): DecisionFinalAnswerTraceReceipt {
  const activationStatus: DecisionFinalAnswerTraceStepStatus =
    engineActivationContract.totals.block > 0 || engineActivationContract.status === "blocked-storage"
      ? "block"
      : engineActivationContract.totals.watch > 0 || engineActivationContract.status === "needs-evidence"
        ? "watch"
        : "pass";
  const aiRuleStatus =
    finalAnswer.aiReview.rule.toLowerCase().includes("cannot upgrade") && !finalAnswer.controls.canUpgradePublicAction
      ? aiStatus(aiLiveCycleReceipt.status)
      : "block";
  const steps = [
    step({
      id: "data-backbone",
      label: "Data backbone",
      status: dataStatus(dataBackbone.status),
      sourceHash: dataBackbone.backboneHash,
      claim: "Fixture, provider, coverage, storage, and historical corpus readiness are recorded before the answer is trusted.",
      evidence: dataBackbone.summary,
      proofUrl: "/api/sports/decision/data-backbone",
      nextAction: dataBackbone.nextAction.expectedEvidence
    }),
    step({
      id: "model-reasoning",
      label: "Model reasoning",
      status: reasoningStatus(modelReasoningLedger.status),
      sourceHash: modelReasoningLedger.ledgerHash,
      claim: "The math prior and model explanation are traceable before market or AI review can influence the final answer.",
      evidence: modelReasoningLedger.summary,
      proofUrl: "/api/sports/decision/model-reasoning-ledger",
      nextAction: modelReasoningLedger.nextSafeCommand.expectedEvidence
    }),
    step({
      id: "market-edge",
      label: "Market edge",
      status: marketStatus(marketAuditMatrix.status),
      sourceHash: marketAuditMatrix.matrixHash,
      claim: "Odds are converted to implied probability, bookmaker margin is separated, and model probability is compared for value.",
      evidence: marketAuditMatrix.summary,
      proofUrl: "/api/sports/decision/market-audit-matrix",
      nextAction: "Keep positive EV candidates in shadow mode until storage, backtests, and operator publish controls pass."
    }),
    step({
      id: "ai-rule",
      label: "AI rule",
      status: aiRuleStatus,
      sourceHash: aiLiveCycleReceipt.receiptHash,
      claim: "AI review can explain or challenge the deterministic answer, but cannot upgrade avoid or monitor into a public pick.",
      evidence: `${aiLiveCycleReceipt.summary} Rule: ${finalAnswer.aiReview.rule}`,
      proofUrl: "/api/sports/decision/ai-live-cycle-receipt",
      nextAction: aiLiveCycleReceipt.nextSafeAction.expectedEvidence
    }),
    step({
      id: "activation-contract",
      label: "Activation contract",
      status: activationStatus,
      sourceHash: engineActivationContract.contractHash,
      claim: "Storage, fixture context, model math, market edge, AI review, backtest, and public locks gate the engine.",
      evidence: engineActivationContract.summary,
      proofUrl: "/api/sports/decision/engine-activation-contract",
      nextAction: engineActivationContract.nextAction.expectedEvidence
    }),
    step({
      id: "final-answer",
      label: "Final answer",
      status: finalAnswerStatus(finalAnswer.status),
      sourceHash: finalAnswer.answerHash,
      claim: "The final public answer stays at avoid or monitor and cannot become a displayed pick while locks are active.",
      evidence: finalAnswer.summary,
      proofUrl: "/api/sports/decision/final-answer-contract",
      nextAction: finalAnswer.nextAction.expectedEvidence
    }),
    step({
      id: "promotion-gate",
      label: "Answer promotion gate",
      status: promotionStatus(answerPromotionGate.status),
      sourceHash: answerPromotionGate.promotionHash,
      claim: "Provider evidence, model reasoning, market value, market calibration, backtests, AI review, risk council, and public locks decide whether the answer can be promoted.",
      evidence: answerPromotionGate.summary,
      proofUrl: "/api/sports/decision/answer-promotion-gate",
      nextAction: answerPromotionGate.nextBlockingCheck?.requiredEvidence ?? answerPromotionGate.actionCeiling.reason
    }),
    step({
      id: "validation",
      label: "Validation",
      status: validationStatus(validation.status),
      sourceHash: validation.validationHash,
      claim: "The final answer is checked for action locks, activation alignment, firewall alignment, AI no-upgrade, target integrity, and next proof.",
      evidence: validation.summary,
      proofUrl: "/api/sports/decision/final-answer-validation",
      nextAction: validation.nextAction.expectedEvidence
    })
  ];
  const totals = totalsFor(steps);
  const status = statusFor(steps);
  const lineage = {
    dataBackboneHash: dataBackbone.backboneHash,
    modelReasoningHash: modelReasoningLedger.ledgerHash,
    marketMatrixHash: marketAuditMatrix.matrixHash,
    aiReceiptHash: aiLiveCycleReceipt.receiptHash,
    activationHash: engineActivationContract.contractHash,
    firewallHash: trustFirewall.firewallHash,
    finalAnswerHash: finalAnswer.answerHash,
    promotionHash: answerPromotionGate.promotionHash,
    validationHash: validation.validationHash
  };
  const traceHash = stableHash({
    date,
    sport,
    status,
    target: finalAnswer.target,
    lineage,
    steps: steps.map((item) => [item.id, item.status, item.sourceHash])
  });

  return {
    mode: "decision-final-answer-trace-receipt",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    traceHash,
    summary: summaryFor(status, totals),
    target: {
      matchId: finalAnswer.target.matchId,
      match: finalAnswer.target.match,
      market: finalAnswer.target.market,
      selection: finalAnswer.target.selection,
      action: finalAnswer.publicAnswer.action
    },
    lineage,
    steps,
    totals,
    nextAction: nextActionFor(steps),
    controls: {
      canInspectReadOnly: true,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canAlterFinalAnswer: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/final-answer-trace",
      "/api/sports/decision/data-backbone",
      "/api/sports/decision/model-reasoning-ledger",
      "/api/sports/decision/market-audit-matrix",
      "/api/sports/decision/ai-live-cycle-receipt",
      "/api/sports/decision/engine-activation-contract",
      "/api/sports/decision/final-answer-contract",
      "/api/sports/decision/answer-promotion-gate",
      ...answerPromotionGate.proofUrls,
      "/api/sports/decision/final-answer-validation",
      ...validation.proofUrls
    ], 64),
    locks: unique([
      "Trace receipt is read-only and cannot alter the final answer.",
      "Trace receipt cannot persist decisions, publish picks, train models, stake, expose hidden reasoning, or upgrade public action.",
      ...dataBackbone.locks,
      ...engineActivationContract.locks,
      ...finalAnswer.locks,
      ...answerPromotionGate.locks,
      ...validation.locks
    ])
  };
}
