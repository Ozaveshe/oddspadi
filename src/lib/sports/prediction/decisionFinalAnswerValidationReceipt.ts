import type { DecisionEngineActivationContract } from "@/lib/sports/prediction/decisionEngineActivationContract";
import type { DecisionAnswerPromotionGate } from "@/lib/sports/prediction/decisionAnswerPromotionGate";
import type { DecisionFinalAnswerContract } from "@/lib/sports/prediction/decisionFinalAnswerContract";
import type { DecisionTrustFirewall } from "@/lib/sports/prediction/decisionTrustFirewall";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

export type DecisionFinalAnswerValidationStatus = "valid" | "watch" | "invalid";
export type DecisionFinalAnswerValidationCheckStatus = "pass" | "watch" | "block";
export type DecisionFinalAnswerValidationCheckId =
  | "public-action-lock"
  | "control-locks"
  | "activation-alignment"
  | "firewall-alignment"
  | "ai-no-upgrade"
  | "promotion-gate"
  | "target-integrity"
  | "next-proof";

export type DecisionFinalAnswerValidationCheck = {
  id: DecisionFinalAnswerValidationCheckId;
  label: string;
  status: DecisionFinalAnswerValidationCheckStatus;
  detail: string;
  evidence: string[];
  repair: string;
};

export type DecisionFinalAnswerValidationReceipt = {
  mode: "decision-final-answer-validation-receipt";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionFinalAnswerValidationStatus;
  validationHash: string;
  summary: string;
  answerHash: string;
  activationHash: string;
  firewallHash: string;
  checks: DecisionFinalAnswerValidationCheck[];
  totals: {
    checks: number;
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
    canRepairAutomatically: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
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

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function check(input: DecisionFinalAnswerValidationCheck): DecisionFinalAnswerValidationCheck {
  return input;
}

function totalsFor(checks: DecisionFinalAnswerValidationCheck[]): DecisionFinalAnswerValidationReceipt["totals"] {
  return {
    checks: checks.length,
    pass: checks.filter((item) => item.status === "pass").length,
    watch: checks.filter((item) => item.status === "watch").length,
    block: checks.filter((item) => item.status === "block").length
  };
}

function statusFor(totals: DecisionFinalAnswerValidationReceipt["totals"]): DecisionFinalAnswerValidationStatus {
  if (totals.block > 0) return "invalid";
  if (totals.watch > 0) return "watch";
  return "valid";
}

function summaryFor(status: DecisionFinalAnswerValidationStatus, totals: DecisionFinalAnswerValidationReceipt["totals"]): string {
  if (status === "valid") return `Final answer validation passed all ${totals.checks} coherence and safety checks.`;
  if (status === "watch") return `Final answer validation is watch-only with ${totals.watch} non-blocking check(s) needing stronger proof.`;
  return `Final answer validation blocks trust because ${totals.block} check(s) contradict the safety or evidence contract.`;
}

function nextActionFor(checks: DecisionFinalAnswerValidationCheck[]): DecisionFinalAnswerValidationReceipt["nextAction"] {
  const next = checks.find((item) => item.status === "block") ?? checks.find((item) => item.status === "watch") ?? checks[0];
  const verifyUrl = "/api/sports/decision/final-answer-validation";
  return {
    label: next?.label ?? "Inspect final answer validation",
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    safeToRun: true,
    expectedEvidence: next?.repair ?? "Validation receipt returns pass/watch/block checks for the current final answer."
  };
}

export function buildDecisionFinalAnswerValidationReceipt({
  date,
  sport,
  finalAnswer,
  activationContract,
  trustFirewall,
  answerPromotionGate,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  finalAnswer: DecisionFinalAnswerContract;
  activationContract: DecisionEngineActivationContract;
  trustFirewall: DecisionTrustFirewall;
  answerPromotionGate: DecisionAnswerPromotionGate;
  now?: Date;
}): DecisionFinalAnswerValidationReceipt {
  const controlsLocked =
    !finalAnswer.controls.canDisplayAsPick &&
    !finalAnswer.controls.canPersist &&
    !finalAnswer.controls.canPublish &&
    !finalAnswer.controls.canTrain &&
    !finalAnswer.controls.canStake &&
    !finalAnswer.controls.canUseHiddenChainOfThought &&
    !finalAnswer.controls.canUpgradePublicAction;
  const activationBlocked = activationContract.status === "blocked-storage" || activationContract.totals.block > 0;
  const maximumPublicAction = trustFirewall.actionContract.maximumPublicAction;
  const firewallBlocksMonitor = maximumPublicAction === "avoid" && finalAnswer.publicAnswer.action === "monitor";
  const hasTarget = Boolean(finalAnswer.target.matchId && finalAnswer.target.match);
  const hasSelectionOrAvoid = Boolean(finalAnswer.target.selection) || finalAnswer.publicAnswer.action === "avoid";
  const marketCalibration = answerPromotionGate.checks.find((item) => item.id === "market-calibration") ?? null;
  const checks = [
    check({
      id: "public-action-lock",
      label: "Public action lock",
      status: finalAnswer.publicAnswer.publicPickAllowed ? "block" : "pass",
      detail: `Public pick allowed is ${finalAnswer.publicAnswer.publicPickAllowed}.`,
      evidence: [finalAnswer.publicAnswer.action, `publicPickAllowed:${finalAnswer.publicAnswer.publicPickAllowed}`],
      repair: "Keep publicPickAllowed false until storage, provider, backtest, AI, and operator publish gates all pass."
    }),
    check({
      id: "control-locks",
      label: "Control locks",
      status: controlsLocked ? "pass" : "block",
      detail: "Final answer must not open publish, persist, train, stake, pick display, hidden reasoning, or public-action upgrade controls.",
      evidence: [
        `displayAsPick:${finalAnswer.controls.canDisplayAsPick}`,
        `persist:${finalAnswer.controls.canPersist}`,
        `publish:${finalAnswer.controls.canPublish}`,
        `train:${finalAnswer.controls.canTrain}`,
        `stake:${finalAnswer.controls.canStake}`,
        `hidden:${finalAnswer.controls.canUseHiddenChainOfThought}`,
        `upgrade:${finalAnswer.controls.canUpgradePublicAction}`
      ],
      repair: "Force every final-answer write, train, publish, stake, hidden-reasoning, and upgrade control to false."
    }),
    check({
      id: "activation-alignment",
      label: "Activation alignment",
      status: activationBlocked && finalAnswer.status !== "blocked" ? "block" : activationContract.status === "needs-evidence" && finalAnswer.status === "shadow-candidate" ? "watch" : "pass",
      detail: `Activation ${activationContract.status}; final answer ${finalAnswer.status}; public action ${finalAnswer.publicAnswer.action}.`,
      evidence: [activationContract.contractHash, finalAnswer.answerHash, `activationBlocks:${activationContract.totals.block}`],
      repair: "When activation has blocking gates, the final answer must be blocked/avoid and point to the first activation proof."
    }),
    check({
      id: "firewall-alignment",
      label: "Firewall alignment",
      status: firewallBlocksMonitor ? "block" : trustFirewall.status === "watchlist-only" && finalAnswer.status === "shadow-candidate" ? "watch" : "pass",
      detail: `Trust firewall status ${trustFirewall.status}; maximum public action ${maximumPublicAction}; final public action ${finalAnswer.publicAnswer.action}.`,
      evidence: [trustFirewall.firewallHash, trustFirewall.actionContract.reason],
      repair: "Final answer must not exceed the trust firewall maximum public action."
    }),
    check({
      id: "ai-no-upgrade",
      label: "AI no-upgrade rule",
      status: finalAnswer.aiReview.rule.toLowerCase().includes("cannot upgrade") && !finalAnswer.controls.canUpgradePublicAction ? "pass" : "block",
      detail: finalAnswer.aiReview.rule,
      evidence: [finalAnswer.aiReview.status, finalAnswer.aiReview.model, `canUpgrade:${finalAnswer.controls.canUpgradePublicAction}`],
      repair: "AI review must be same-or-safer only and cannot upgrade monitor/avoid into a public pick."
    }),
    check({
      id: "promotion-gate",
      label: "Promotion gate",
      status: answerPromotionGate.status === "monitor-eligible" ? "pass" : answerPromotionGate.status === "watch-only" ? "watch" : "block",
      detail: `Promotion gate ${answerPromotionGate.status}; market calibration ${marketCalibration?.status ?? "missing"}; ceiling ${answerPromotionGate.actionCeiling.maximumPublicAction}.`,
      evidence: [
        answerPromotionGate.promotionHash,
        `promotion:${answerPromotionGate.status}`,
        `marketCalibration:${marketCalibration?.status ?? "missing"}`,
        marketCalibration?.requiredEvidence ?? "market calibration evidence missing"
      ],
      repair:
        marketCalibration?.status === "block"
          ? marketCalibration.requiredEvidence
          : answerPromotionGate.nextBlockingCheck?.requiredEvidence ?? "Clear provider, model, market, calibration, backtest, AI, council, and public-lock promotion checks."
    }),
    check({
      id: "target-integrity",
      label: "Target integrity",
      status: hasTarget && hasSelectionOrAvoid ? "pass" : hasTarget ? "watch" : "block",
      detail: `Target ${finalAnswer.target.match ?? "missing"}; selection ${finalAnswer.target.selection ?? "none"}; action ${finalAnswer.publicAnswer.action}.`,
      evidence: [
        finalAnswer.target.matchId ?? "missing-match-id",
        finalAnswer.target.match ?? "missing-match",
        finalAnswer.target.market ?? "missing-market",
        finalAnswer.target.selection ?? "no-selection"
      ],
      repair: "Load a valid target match and either a priced selection or an explicit avoid answer."
    }),
    check({
      id: "next-proof",
      label: "Next proof",
      status: finalAnswer.nextAction.safeToRun && finalAnswer.nextAction.verifyUrl ? "pass" : "watch",
      detail: `${finalAnswer.nextAction.label}: ${finalAnswer.nextAction.expectedEvidence}`,
      evidence: [finalAnswer.nextAction.command, finalAnswer.nextAction.verifyUrl, `safe:${finalAnswer.nextAction.safeToRun}`],
      repair: "Expose one safe read-only next proof that an operator can run before any trust change."
    })
  ];
  const totals = totalsFor(checks);
  const status = statusFor(totals);
  const validationHash = stableHash({
    date,
    sport,
    status,
    answer: finalAnswer.answerHash,
    activation: activationContract.contractHash,
    firewall: trustFirewall.firewallHash,
    promotion: answerPromotionGate.promotionHash,
    checks: checks.map((item) => [item.id, item.status])
  });

  return {
    mode: "decision-final-answer-validation-receipt",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    validationHash,
    summary: summaryFor(status, totals),
    answerHash: finalAnswer.answerHash,
    activationHash: activationContract.contractHash,
    firewallHash: trustFirewall.firewallHash,
    checks,
    totals,
    nextAction: nextActionFor(checks),
    controls: {
      canInspectReadOnly: true,
      canRepairAutomatically: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/final-answer-validation",
      "/api/sports/decision/final-answer-contract",
      "/api/sports/decision/engine-activation-contract",
      "/api/sports/decision/trust-firewall",
      "/api/sports/decision/answer-promotion-gate",
      ...answerPromotionGate.proofUrls,
      "/api/sports/decision/market-calibrated-fusion"
    ], 64),
    locks: unique([
      "Validation is read-only and cannot repair, persist, publish, train, stake, expose hidden reasoning, or upgrade public action.",
      "Final answer validation must honor the answer-promotion gate, including market-calibration blocks.",
      ...finalAnswer.locks,
      ...activationContract.locks,
      ...answerPromotionGate.locks,
      ...trustFirewall.locks
    ])
  };
}
