import type { DecisionAbstentionAudit } from "@/lib/sports/prediction/decisionAbstentionAudit";
import type { DecisionFinalAnswerAIReview } from "@/lib/sports/prediction/decisionFinalAnswerAIReview";
import type { DecisionFinalAnswerContract } from "@/lib/sports/prediction/decisionFinalAnswerContract";
import type { DecisionFinalAnswerCouncil } from "@/lib/sports/prediction/decisionFinalAnswerCouncil";
import type { DecisionEplFixtureIntake } from "@/lib/sports/prediction/decisionEplFixtureIntake";
import type { DecisionMarketAuditMatrix } from "@/lib/sports/prediction/decisionMarketAuditMatrix";
import type { DecisionMarketCalibratedFusion } from "@/lib/sports/prediction/decisionMarketCalibratedFusion";
import type { DecisionModelReasoningLedger } from "@/lib/sports/prediction/decisionModelReasoningLedger";
import type { DecisionProviderEvidenceLedger } from "@/lib/sports/prediction/decisionProviderEvidenceLedger";
import type { DecisionShadowBacktestLedger } from "@/lib/sports/prediction/decisionShadowBacktestLedger";
import type { DecisionTrustFirewall } from "@/lib/sports/prediction/decisionTrustFirewall";
import type { FootballDataModelPromotionDecision } from "@/lib/sports/training/footballDataModelPromotionDecision";
import type { PublicHistoryBacktestBridge } from "@/lib/sports/training/publicHistoryBacktestBridge";
import type { Sport } from "@/lib/sports/types";

export type DecisionAnswerPromotionGateStatus = "blocked" | "watch-only" | "monitor-eligible";
export type DecisionAnswerPromotionGateCheckStatus = "pass" | "watch" | "block";
export type DecisionAnswerPromotionGateCheckId =
  | "provider-evidence"
  | "model-reasoning"
  | "market-value"
  | "market-calibration"
  | "public-history-bridge"
  | "model-promotion-decision"
  | "epl-fixture-intake"
  | "shadow-backtest"
  | "ai-review"
  | "risk-council"
  | "abstention-guard"
  | "public-lock";

export type DecisionAnswerPromotionGateCheck = {
  id: DecisionAnswerPromotionGateCheckId;
  label: string;
  status: DecisionAnswerPromotionGateCheckStatus;
  detail: string;
  requiredEvidence: string;
  proofUrl: string;
};

export type DecisionAnswerPromotionGate = {
  mode: "decision-answer-promotion-gate";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionAnswerPromotionGateStatus;
  promotionHash: string;
  summary: string;
  currentAnswer: {
    action: DecisionFinalAnswerContract["publicAnswer"]["action"];
    headline: string;
    targetMatch: string | null;
    selection: string | null;
    publicPickAllowed: false;
  };
  actionCeiling: {
    maximumPublicAction: "avoid" | "monitor";
    reason: string;
    canPromoteToMonitor: boolean;
    canPublishPick: false;
    canStake: false;
    canTrain: false;
  };
  checks: DecisionAnswerPromotionGateCheck[];
  nextBlockingCheck: DecisionAnswerPromotionGateCheck | null;
  totals: {
    checks: number;
    pass: number;
    watch: number;
    block: number;
    positiveEvSelections: number;
    providerFeedsBlocked: number;
    backtestSampleSize: number;
  };
  controls: {
    canInspectReadOnly: true;
    canRequestAIReview: boolean;
    canDisplayMonitor: boolean;
    canPersistDecision: false;
    canPublish: false;
    canStake: false;
    canTrain: false;
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
  if (!normalized) return "No detail available.";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function check(input: DecisionAnswerPromotionGateCheck): DecisionAnswerPromotionGateCheck {
  return {
    ...input,
    detail: compact(input.detail),
    requiredEvidence: compact(input.requiredEvidence, 280)
  };
}

function providerCheck(providerEvidenceLedger: DecisionProviderEvidenceLedger): DecisionAnswerPromotionGateCheck {
  const status: DecisionAnswerPromotionGateCheckStatus =
    providerEvidenceLedger.status === "evidence-ready"
      ? "pass"
      : providerEvidenceLedger.status === "dry-run-ready" || providerEvidenceLedger.status === "needs-keys"
        ? "watch"
        : "block";
  return check({
    id: "provider-evidence",
    label: "Provider evidence",
    status,
    detail: `${providerEvidenceLedger.summary} First blocker: ${providerEvidenceLedger.firstBlockingFeed?.label ?? "none"}.`,
    requiredEvidence: providerEvidenceLedger.firstBlockingFeed?.nextProof ?? "Keep every required feed source-stamped before promotion.",
    proofUrl: "/api/sports/decision/provider-evidence-ledger"
  });
}

function modelCheck(modelReasoningLedger: DecisionModelReasoningLedger): DecisionAnswerPromotionGateCheck {
  const status: DecisionAnswerPromotionGateCheckStatus =
    modelReasoningLedger.status === "ready-shadow"
      ? "pass"
      : modelReasoningLedger.status === "blocked"
        ? "block"
        : "watch";
  const next = modelReasoningLedger.reasoningSteps.find((step) => step.status !== "pass") ?? null;
  return check({
    id: "model-reasoning",
    label: "Model reasoning",
    status,
    detail: modelReasoningLedger.summary,
    requiredEvidence: next?.nextAction ?? modelReasoningLedger.nextSafeCommand.expectedEvidence,
    proofUrl: "/api/sports/decision/model-reasoning-ledger"
  });
}

function marketCheck(marketAuditMatrix: DecisionMarketAuditMatrix): DecisionAnswerPromotionGateCheck {
  const status: DecisionAnswerPromotionGateCheckStatus =
    marketAuditMatrix.totals.positiveEv > 0 && (marketAuditMatrix.totals.bestExpectedValue ?? 0) > 0
      ? "pass"
      : marketAuditMatrix.status === "watch"
        ? "watch"
        : "block";
  return check({
    id: "market-value",
    label: "Market value",
    status,
    detail: `${marketAuditMatrix.totals.positiveEv} positive-EV selection(s), best EV ${marketAuditMatrix.totals.bestExpectedValue ?? "none"}, best edge ${marketAuditMatrix.totals.bestEdge ?? "none"}.`,
    requiredEvidence: marketAuditMatrix.locks[1] ?? "Require no-vig probability, model probability, edge, EV, and market margin evidence.",
    proofUrl: "/api/sports/decision/market-audit-matrix"
  });
}

function marketCalibrationCheck(marketCalibratedFusion: DecisionMarketCalibratedFusion): DecisionAnswerPromotionGateCheck {
  const status: DecisionAnswerPromotionGateCheckStatus =
    marketCalibratedFusion.action === "allow-shadow-candidate-review" && marketCalibratedFusion.totals.shadowValue > 0
      ? "pass"
      : marketCalibratedFusion.action === "run-market-benchmark" || marketCalibratedFusion.status === "waiting-benchmark"
        ? "watch"
        : "block";
  return check({
    id: "market-calibration",
    label: "Market calibration",
    status,
    detail: `${marketCalibratedFusion.summary} Benchmark verdict: ${marketCalibratedFusion.benchmark.verdict ?? "pending"}.`,
    requiredEvidence:
      status === "pass"
        ? "Keep calibrated market/model/posterior probabilities attached to final-answer promotion."
        : marketCalibratedFusion.action === "defer-to-market-prior"
          ? "Historical benchmark says market consensus is stronger; do not promote raw model value until provider-enriched retests beat market."
          : "Run the market-calibrated fusion proof with a model-vs-market benchmark before answer promotion.",
    proofUrl: "/api/sports/decision/market-calibrated-fusion"
  });
}

function publicHistoryBridgeCheck(publicHistoryBacktestBridge: PublicHistoryBacktestBridge): DecisionAnswerPromotionGateCheck {
  const status: DecisionAnswerPromotionGateCheckStatus =
    publicHistoryBacktestBridge.status === "provider-retest-ready" || publicHistoryBacktestBridge.status === "diagnostic-shadow-ready"
      ? "watch"
      : "block";
  return check({
    id: "public-history-bridge",
    label: "Public-history bridge",
    status,
    detail: `${publicHistoryBacktestBridge.summary} Diagnostic ${publicHistoryBacktestBridge.evidence.diagnosticScore}/100; benchmark ${publicHistoryBacktestBridge.evidence.benchmarkVerdict}; storage ${publicHistoryBacktestBridge.storageBridge.multiSportBacktestStatus}.`,
    requiredEvidence:
      publicHistoryBacktestBridge.status === "market-prior-dominant"
        ? "Public history says market prior dominates; keep final-answer promotion blocked until provider-enriched retests overturn the benchmark."
        : publicHistoryBacktestBridge.status === "storage-blocked"
          ? "Fix Supabase storage proof before public history can be paired with stored backtest authority."
          : publicHistoryBacktestBridge.nextAction.expectedEvidence,
    proofUrl: "/api/sports/decision/training/public-history-backtest-bridge"
  });
}

function modelPromotionDecisionCheck(modelPromotionDecision: FootballDataModelPromotionDecision): DecisionAnswerPromotionGateCheck {
  const status: DecisionAnswerPromotionGateCheckStatus =
    modelPromotionDecision.status === "shadow-eligible"
      ? "pass"
      : modelPromotionDecision.status === "provider-retest-ready" ||
          modelPromotionDecision.status === "waiting-provider-rows" ||
          modelPromotionDecision.status === "demo-preview-only" ||
          modelPromotionDecision.status === "collect-more-data"
        ? "watch"
        : "block";
  return check({
    id: "model-promotion-decision",
    label: "Model promotion decision",
    status,
    detail: `${modelPromotionDecision.summary} Market verdict ${modelPromotionDecision.publicEvidence.marketVerdict}; provider rows ${modelPromotionDecision.providerEvidence.normalizedRows}; runner ${modelPromotionDecision.providerEvidence.runnerStatus}.`,
    requiredEvidence:
      status === "pass"
        ? "Keep promotion shadow-only until separate learning-promotion governance approves learned influence."
        : modelPromotionDecision.status === "blocked-market-prior"
          ? "Historical model-promotion proof says market prior dominates; do not promote model probabilities until provider-enriched retests beat market gates."
          : modelPromotionDecision.verdict.reason,
    proofUrl: "/api/sports/decision/training/football-data-model-promotion-decision"
  });
}

function eplFixtureIntakeCheck(eplFixtureIntake: DecisionEplFixtureIntake): DecisionAnswerPromotionGateCheck {
  const status: DecisionAnswerPromotionGateCheckStatus = eplFixtureIntake.status === "ready-dry-run" ? "watch" : "block";
  const next = eplFixtureIntake.nextTask;
  return check({
    id: "epl-fixture-intake",
    label: "EPL fixture intake",
    status,
    detail: `${eplFixtureIntake.summary} ${eplFixtureIntake.season.totalFixtures} fixtures released ${eplFixtureIntake.season.fixtureReleaseDate}; season starts ${eplFixtureIntake.season.seasonStartDate}; ${eplFixtureIntake.season.daysUntilStart} day(s) until kickoff.`,
    requiredEvidence:
      status === "watch"
        ? "Keep EPL fixture promotion watch-only until provider dry-run, storage proof, odds event linkage, and preseason context are source-stamped."
        : next?.expectedEvidence ?? "Clear EPL provider, storage, odds, and preseason-context fixture intake before answer promotion.",
    proofUrl: "/api/sports/decision/epl-fixture-intake"
  });
}

function backtestCheck(shadowBacktestLedger: DecisionShadowBacktestLedger): DecisionAnswerPromotionGateCheck {
  const status: DecisionAnswerPromotionGateCheckStatus =
    shadowBacktestLedger.status === "ready-shadow"
      ? "pass"
      : shadowBacktestLedger.status === "needs-settlement" || shadowBacktestLedger.status === "needs-backtest"
        ? "watch"
        : "block";
  return check({
    id: "shadow-backtest",
    label: "Backtests and settlement",
    status,
    detail: `${shadowBacktestLedger.summary} Historical sample size: ${shadowBacktestLedger.historicalBacktest.sampleSize}.`,
    requiredEvidence: shadowBacktestLedger.nextSafeAction.expectedEvidence,
    proofUrl: "/api/sports/decision/shadow-backtest-ledger"
  });
}

function aiCheck(finalAnswerAIReview: DecisionFinalAnswerAIReview): DecisionAnswerPromotionGateCheck {
  const status: DecisionAnswerPromotionGateCheckStatus =
    finalAnswerAIReview.status === "reviewed"
      ? "pass"
      : finalAnswerAIReview.status === "ready-to-run" || finalAnswerAIReview.status === "not-requested"
        ? "watch"
        : "block";
  return check({
    id: "ai-review",
    label: "Final-answer AI review",
    status,
    detail: finalAnswerAIReview.summary,
    requiredEvidence: finalAnswerAIReview.appliedReview.requiredEvidence[0] ?? finalAnswerAIReview.locks[0] ?? "Run guarded final-answer AI review.",
    proofUrl: "/api/sports/decision/final-answer-ai-review"
  });
}

function councilCheck(finalAnswerCouncil: DecisionFinalAnswerCouncil, trustFirewall: DecisionTrustFirewall): DecisionAnswerPromotionGateCheck {
  const status: DecisionAnswerPromotionGateCheckStatus =
    finalAnswerCouncil.status === "monitor-ready"
      ? "pass"
      : finalAnswerCouncil.status === "watching"
        ? "watch"
        : "block";
  return check({
    id: "risk-council",
    label: "Risk council",
    status,
    detail: `${finalAnswerCouncil.summary} Firewall: ${trustFirewall.summary}`,
    requiredEvidence: finalAnswerCouncil.requiredBeforeMonitor[0] ?? finalAnswerCouncil.locks[0] ?? trustFirewall.locks[0],
    proofUrl: "/api/sports/decision/final-answer-council"
  });
}

function publicLockCheck(finalAnswerContract: DecisionFinalAnswerContract): DecisionAnswerPromotionGateCheck {
  return check({
    id: "public-lock",
    label: "Public lock",
    status: "watch",
    detail: "The current MVP may display monitor evidence, but publishing, staking, persistence, training, and public-action upgrades are intentionally locked.",
    requiredEvidence: finalAnswerContract.nextAction.expectedEvidence,
    proofUrl: "/api/sports/decision/final-answer-contract"
  });
}

function abstentionGuardCheck(abstentionAudit: DecisionAbstentionAudit): DecisionAnswerPromotionGateCheck {
  const candidate = abstentionAudit.topCandidate;
  const status: DecisionAnswerPromotionGateCheckStatus = candidate?.publicDecision === "monitor-only" ? "watch" : "block";
  return check({
    id: "abstention-guard",
    label: "Abstention guard",
    status,
    detail: candidate ? `${candidate.match} ${candidate.market} ${candidate.selection}: ${candidate.whyAvoidOrWait}` : abstentionAudit.summary,
    requiredEvidence:
      candidate?.missingEvidence[0] ??
      "Attach provider freshness, injuries/news, lineups, odds, backtest, and trust evidence before promotion.",
    proofUrl: "/api/sports/decision/abstention-audit"
  });
}

function statusFor(checks: DecisionAnswerPromotionGateCheck[]): DecisionAnswerPromotionGateStatus {
  if (checks.some((item) => item.status === "block")) return "blocked";
  if (checks.some((item) => item.status === "watch")) return "watch-only";
  return "monitor-eligible";
}

function summaryFor(status: DecisionAnswerPromotionGateStatus, next: DecisionAnswerPromotionGateCheck | null): string {
  if (status === "monitor-eligible") return "The answer can be displayed as a monitored shadow candidate, but publish, staking, persistence, and training remain locked.";
  if (status === "watch-only") return `The answer remains watch-only until ${next?.label ?? "remaining evidence"} clears.`;
  return `The answer cannot be promoted because ${next?.label ?? "one or more required gates"} is blocking.`;
}

export function buildDecisionAnswerPromotionGate({
  date,
  sport,
  finalAnswer,
  finalAnswerCouncil,
  finalAnswerAIReview,
  providerEvidenceLedger,
  modelReasoningLedger,
  marketAuditMatrix,
  marketCalibratedFusion,
  shadowBacktestLedger,
  trustFirewall,
  abstentionAudit,
  publicHistoryBacktestBridge = null,
  modelPromotionDecision = null,
  eplFixtureIntake = null,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  finalAnswer: DecisionFinalAnswerContract;
  finalAnswerCouncil: DecisionFinalAnswerCouncil;
  finalAnswerAIReview: DecisionFinalAnswerAIReview;
  providerEvidenceLedger: DecisionProviderEvidenceLedger;
  modelReasoningLedger: DecisionModelReasoningLedger;
  marketAuditMatrix: DecisionMarketAuditMatrix;
  marketCalibratedFusion: DecisionMarketCalibratedFusion;
  shadowBacktestLedger: DecisionShadowBacktestLedger;
  trustFirewall: DecisionTrustFirewall;
  abstentionAudit: DecisionAbstentionAudit;
  publicHistoryBacktestBridge?: PublicHistoryBacktestBridge | null;
  modelPromotionDecision?: FootballDataModelPromotionDecision | null;
  eplFixtureIntake?: DecisionEplFixtureIntake | null;
  now?: Date;
}): DecisionAnswerPromotionGate {
  const checks = [
    providerCheck(providerEvidenceLedger),
    modelCheck(modelReasoningLedger),
    marketCheck(marketAuditMatrix),
    marketCalibrationCheck(marketCalibratedFusion),
    ...(publicHistoryBacktestBridge ? [publicHistoryBridgeCheck(publicHistoryBacktestBridge)] : []),
    ...(modelPromotionDecision ? [modelPromotionDecisionCheck(modelPromotionDecision)] : []),
    ...(eplFixtureIntake ? [eplFixtureIntakeCheck(eplFixtureIntake)] : []),
    backtestCheck(shadowBacktestLedger),
    aiCheck(finalAnswerAIReview),
    councilCheck(finalAnswerCouncil, trustFirewall),
    abstentionGuardCheck(abstentionAudit),
    publicLockCheck(finalAnswer)
  ];
  const nextBlockingCheck = checks.find((item) => item.status === "block") ?? checks.find((item) => item.status === "watch") ?? null;
  const status = statusFor(checks);
  const totals = {
    checks: checks.length,
    pass: checks.filter((item) => item.status === "pass").length,
    watch: checks.filter((item) => item.status === "watch").length,
    block: checks.filter((item) => item.status === "block").length,
    positiveEvSelections: marketAuditMatrix.totals.positiveEv,
    providerFeedsBlocked: providerEvidenceLedger.totals.blocked + providerEvidenceLedger.totals.missing + providerEvidenceLedger.totals.needsStorageProof,
    backtestSampleSize: shadowBacktestLedger.historicalBacktest.sampleSize
  };
  const canPromoteToMonitor = status === "monitor-eligible" && finalAnswerCouncil.finalPublicAction === "monitor";
  const promotionHash = stableHash({
    date,
    sport,
    status,
    checks: checks.map((item) => [item.id, item.status]),
    finalAnswer: finalAnswer.answerHash,
    council: finalAnswerCouncil.councilHash,
    abstention: abstentionAudit.auditHash,
    marketCalibration: [marketCalibratedFusion.fusionHash, marketCalibratedFusion.status, marketCalibratedFusion.action],
    publicHistoryBridge: publicHistoryBacktestBridge ? [publicHistoryBacktestBridge.bridgeHash, publicHistoryBacktestBridge.status] : null,
    modelPromotionDecision: modelPromotionDecision ? [modelPromotionDecision.decisionHash, modelPromotionDecision.status] : null,
    eplFixtureIntake: eplFixtureIntake ? [eplFixtureIntake.intakeHash, eplFixtureIntake.status, eplFixtureIntake.season.daysUntilStart] : null,
    provider: providerEvidenceLedger.ledgerHash
  });

  return {
    mode: "decision-answer-promotion-gate",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    promotionHash,
    summary: summaryFor(status, nextBlockingCheck),
    currentAnswer: {
      action: finalAnswer.publicAnswer.action,
      headline: finalAnswer.publicAnswer.headline,
      targetMatch: finalAnswer.target.match,
      selection: finalAnswer.target.selection,
      publicPickAllowed: false
    },
    actionCeiling: {
      maximumPublicAction: canPromoteToMonitor ? "monitor" : "avoid",
      reason: nextBlockingCheck?.requiredEvidence ?? finalAnswerCouncil.summary,
      canPromoteToMonitor,
      canPublishPick: false,
      canStake: false,
      canTrain: false
    },
    checks,
    nextBlockingCheck,
    totals,
    controls: {
      canInspectReadOnly: true,
      canRequestAIReview: finalAnswerAIReview.controls.canRequestOpenAI,
      canDisplayMonitor: canPromoteToMonitor,
      canPersistDecision: false,
      canPublish: false,
      canStake: false,
      canTrain: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/answer-promotion-gate",
      "/api/sports/decision/provider-evidence-ledger",
      "/api/sports/decision/model-reasoning-ledger",
      "/api/sports/decision/market-audit-matrix",
      "/api/sports/decision/market-calibrated-fusion",
      publicHistoryBacktestBridge ? "/api/sports/decision/training/public-history-backtest-bridge" : null,
      modelPromotionDecision ? "/api/sports/decision/training/football-data-model-promotion-decision" : null,
      eplFixtureIntake ? "/api/sports/decision/epl-fixture-intake" : null,
      "/api/sports/decision/shadow-backtest-ledger",
      "/api/sports/decision/final-answer-ai-review",
      "/api/sports/decision/final-answer-council",
      "/api/sports/decision/final-answer-contract",
      ...providerEvidenceLedger.proofUrls,
      ...(publicHistoryBacktestBridge?.proofUrls ?? []),
      ...(modelPromotionDecision?.proofUrls ?? []),
      ...(eplFixtureIntake?.proofUrls ?? []),
      ...modelReasoningLedger.proofUrls,
      ...shadowBacktestLedger.proofUrls,
      ...abstentionAudit.proofUrls,
      ...finalAnswerCouncil.proofUrls
    ], 80),
    locks: unique([
      "Promotion gate cannot publish picks, stake, persist decisions, train models, apply learned weights, or reveal hidden chain-of-thought.",
      "Monitor promotion requires provider evidence, model reasoning, market value, backtests, AI review, and risk council checks to clear together.",
      "Market-calibrated fusion can cap raw value candidates when historical benchmark evidence favors market consensus.",
      publicHistoryBacktestBridge
        ? "Public-history bridge can add diagnostic AI evidence, but it cannot satisfy stored backtest authority or promote final answers by itself."
        : null,
      modelPromotionDecision
        ? "Model promotion decision can explain shadow or provider-retest eligibility, but it cannot apply learned weights, promote live probabilities, publish picks, or stake."
        : null,
      eplFixtureIntake
        ? "EPL 2026/27 fixture intake can seed the upcoming slate, but it cannot promote picks without provider dry-run proof, storage proof, odds linkage, and preseason context."
        : null,
      "Abstention guard must clear before a positive-EV candidate can be promoted beyond avoid or watch-only.",
      "A positive EV selection alone cannot promote the final answer.",
      ...finalAnswer.locks,
      ...abstentionAudit.locks,
      ...finalAnswerCouncil.locks,
      ...providerEvidenceLedger.locks,
      ...(eplFixtureIntake?.locks ?? [])
    ])
  };
}
