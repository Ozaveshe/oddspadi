import type { DecisionLearningConsolidator } from "@/lib/sports/prediction/decisionLearningConsolidator";
import type { DecisionOutcomeReplay } from "@/lib/sports/prediction/decisionOutcomeReplay";
import type { LearnedWeightPromotionGovernor } from "@/lib/sports/training/learnedWeightPromotionGovernor";
import type { LearnedWeightShadowComparison } from "@/lib/sports/training/learnedWeightShadowComparison";
import type { TrainingReadiness } from "@/lib/sports/training/trainingReadiness";
import type { Sport } from "@/lib/sports/types";

export type DecisionLearningPromotionGateStatus = "eligible-shadow" | "waiting-outcomes" | "waiting-backtest" | "waiting-governance" | "blocked";
export type DecisionLearningPromotionCheckStatus = "pass" | "watch" | "block";

export type DecisionLearningPromotionCheck = {
  id: string;
  label: string;
  status: DecisionLearningPromotionCheckStatus;
  detail: string;
  evidence: string[];
  requiredAction: string | null;
};

export type DecisionLearningPromotionGate = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-learning-promotion-gate";
  status: DecisionLearningPromotionGateStatus;
  promotionHash: string;
  summary: string;
  checks: DecisionLearningPromotionCheck[];
  selectedCheck: DecisionLearningPromotionCheck | null;
  metrics: {
    replayRows: number;
    maxReplayPressure: number | null;
    pendingOutcomeTickets: number;
    reinforceShadow: number;
    downgradeUntilSettled: number;
    backtestSampleSize: number;
    backtestPickCount: number;
    brierScore: number | null;
    logLoss: number | null;
    closingLineValue: number | null;
    eligibleShadowSports: number;
    shadowRowsCompared: number;
    shadowWouldPass: number;
    shadowWouldDowngrade: number;
  };
  influencePlan: {
    allowedScope: "none" | "shadow-memory";
    canRecordShadowMemory: false;
    canAdjustProbabilities: false;
    canAdjustPublicPicks: false;
    canApplyLearnedWeights: false;
    canPersistWeights: false;
    nextShadowUse: string;
  };
  policy: {
    requiresSettledOutcomes: true;
    requiresRealBacktest: true;
    requiresPositiveOrNeutralClv: true;
    maxReplayPressureForShadow: number;
    maxPublicProbabilityDelta: 0;
    maxStakeUnits: 0;
  };
  controls: {
    canInspectReadOnly: true;
    canPersistMemory: false;
    canPersistOutcomes: false;
    canRunCalibration: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
    canUseHiddenChainOfThought: false;
  };
  proofUrls: string[];
  locks: string[];
};

const MAX_REPLAY_PRESSURE_FOR_SHADOW = 0.46;

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function unique(values: Array<string | null | undefined>, limit = 28): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function check(input: DecisionLearningPromotionCheck): DecisionLearningPromotionCheck {
  return {
    ...input,
    evidence: unique(input.evidence, 8)
  };
}

function buildChecks({
  outcomeReplay,
  learningConsolidator,
  promotionGovernor,
  shadowComparison,
  trainingReadiness
}: {
  outcomeReplay: DecisionOutcomeReplay;
  learningConsolidator: DecisionLearningConsolidator;
  promotionGovernor: LearnedWeightPromotionGovernor;
  shadowComparison: LearnedWeightShadowComparison;
  trainingReadiness: TrainingReadiness;
}): DecisionLearningPromotionCheck[] {
  const maxReplayPressure = outcomeReplay.rows.length ? Math.max(...outcomeReplay.rows.map((row) => row.replayPressure)) : null;
  const hasBacktest = Boolean(outcomeReplay.historicalSignal.backtestId);
  const clv = outcomeReplay.historicalSignal.closingLineValue;
  const replayPasses = maxReplayPressure !== null && maxReplayPressure <= MAX_REPLAY_PRESSURE_FOR_SHADOW && outcomeReplay.totals.avoid === 0;
  return [
    check({
      id: "outcome-replay-pressure",
      label: "Replay pressure gate",
      status: replayPasses ? "pass" : outcomeReplay.rows.length ? "watch" : "block",
      detail:
        maxReplayPressure === null
          ? "No replay rows are available for promotion gating."
          : `Max replay pressure is ${maxReplayPressure.toFixed(2)} across ${outcomeReplay.rows.length} candidate(s).`,
      evidence: [outcomeReplay.replayHash, outcomeReplay.status, String(maxReplayPressure ?? "none")],
      requiredAction: replayPasses ? null : "Keep learning quarantined until replay pressure drops after settled outcomes or stronger evidence."
    }),
    check({
      id: "outcome-labels",
      label: "Settled outcome labels",
      status: outcomeReplay.totals.pendingOutcomeTickets === 0 ? "pass" : "watch",
      detail: `${outcomeReplay.totals.pendingOutcomeTickets} pending outcome ticket(s) remain draft-only.`,
      evidence: [learningConsolidator.activeSignal?.id ?? "no-active-signal", learningConsolidator.status, String(outcomeReplay.totals.pendingOutcomeTickets)],
      requiredAction: outcomeReplay.totals.pendingOutcomeTickets === 0 ? null : "Persist and settle outcome labels through the approved outcomes flow before learned signals can affect public decisions."
    }),
    check({
      id: "historical-backtest",
      label: "Historical backtest evidence",
      status: hasBacktest && outcomeReplay.historicalSignal.sampleSize >= 1000 && outcomeReplay.historicalSignal.pickCount >= 30 ? "pass" : hasBacktest ? "watch" : "block",
      detail: `Backtest ${outcomeReplay.historicalSignal.backtestId ?? "missing"} sample=${outcomeReplay.historicalSignal.sampleSize}, picks=${outcomeReplay.historicalSignal.pickCount}.`,
      evidence: [
        outcomeReplay.historicalSignal.backtestId ?? "no-backtest",
        String(outcomeReplay.historicalSignal.brierScore ?? "no-brier"),
        String(outcomeReplay.historicalSignal.logLoss ?? "no-log-loss")
      ],
      requiredAction:
        hasBacktest && outcomeReplay.historicalSignal.sampleSize >= 1000 && outcomeReplay.historicalSignal.pickCount >= 30
          ? null
          : "Store a real-data backtest with at least 1,000 samples and 30 evaluated picks."
    }),
    check({
      id: "closing-line-value",
      label: "Closing-line value",
      status: clv === null ? "watch" : clv >= 0 ? "pass" : "block",
      detail: `Historical CLV is ${clv === null ? "not available" : clv.toFixed(4)}.`,
      evidence: [String(clv ?? "missing"), outcomeReplay.historicalSignal.backtestId ?? "no-backtest"],
      requiredAction: clv === null ? "Add closing odds to the historical outcomes/backtest set." : clv >= 0 ? null : "Do not promote learned behavior while historical CLV is negative."
    }),
    check({
      id: "shadow-comparison",
      label: "Learned-weight shadow comparison",
      status: shadowComparison.status === "ready-shadow" && shadowComparison.totals.wouldPassShadow > 0 ? "pass" : shadowComparison.status === "blocked" ? "block" : "watch",
      detail: `${shadowComparison.status}; pass=${shadowComparison.totals.wouldPassShadow}, downgrade=${shadowComparison.totals.wouldDowngrade}, compared=${shadowComparison.totals.compared}.`,
      evidence: [shadowComparison.comparisonHash, String(shadowComparison.totals.wouldPassShadow), String(shadowComparison.totals.wouldDowngrade)],
      requiredAction:
        shadowComparison.status === "ready-shadow"
          ? null
          : shadowComparison.blockers[0] ?? "Run shadow comparison after backtest candidate and promotion-governor gates are ready."
    }),
    check({
      id: "promotion-governance",
      label: "Promotion governance",
      status: promotionGovernor.status === "eligible-shadow" ? "pass" : promotionGovernor.status === "blocked" ? "block" : "watch",
      detail: `${promotionGovernor.status}; eligible sports=${promotionGovernor.totals.eligibleShadow}, learned weights=${promotionGovernor.totals.learnedWeights}.`,
      evidence: [promotionGovernor.governorHash, promotionGovernor.status, String(promotionGovernor.totals.eligibleShadow)],
      requiredAction: promotionGovernor.status === "eligible-shadow" ? null : promotionGovernor.blockers[0] ?? promotionGovernor.summary
    }),
    check({
      id: "operator-lock",
      label: "Operator/public action lock",
      status: "pass",
      detail: "Learning promotion gate can only authorize shadow-memory influence; public picks, probabilities, stakes, and model weights remain locked.",
      evidence: [trainingReadiness.readinessHash, learningConsolidator.consolidatorHash],
      requiredAction: null
    })
  ];
}

function statusFor(checks: DecisionLearningPromotionCheck[], outcomeReplay: DecisionOutcomeReplay): DecisionLearningPromotionGateStatus {
  if (checks.some((item) => item.status === "block" && item.id !== "historical-backtest")) return "blocked";
  if (checks.find((item) => item.id === "historical-backtest")?.status === "block") return "waiting-backtest";
  if (checks.find((item) => item.id === "outcome-labels")?.status === "watch" || outcomeReplay.status === "waiting-outcomes") return "waiting-outcomes";
  if (checks.some((item) => item.status === "watch")) return "waiting-governance";
  return "eligible-shadow";
}

function summaryFor(status: DecisionLearningPromotionGateStatus): string {
  if (status === "eligible-shadow") return "Learning signals are eligible for shadow-memory comparison only; public prediction changes remain locked.";
  if (status === "waiting-outcomes") return "Learning promotion is waiting on settled outcome labels and replay pressure before any shadow influence is trusted.";
  if (status === "waiting-backtest") return "Learning promotion is waiting on a real historical backtest with enough samples and evaluated picks.";
  if (status === "waiting-governance") return "Learning promotion is waiting on shadow comparison, CLV, or model-governance evidence.";
  return "Learning promotion is blocked by replay, CLV, shadow-comparison, or governance checks.";
}

export function buildDecisionLearningPromotionGate({
  date,
  sport,
  outcomeReplay,
  learningConsolidator,
  promotionGovernor,
  shadowComparison,
  trainingReadiness,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  outcomeReplay: DecisionOutcomeReplay;
  learningConsolidator: DecisionLearningConsolidator;
  promotionGovernor: LearnedWeightPromotionGovernor;
  shadowComparison: LearnedWeightShadowComparison;
  trainingReadiness: TrainingReadiness;
  now?: Date;
}): DecisionLearningPromotionGate {
  const checks = buildChecks({ outcomeReplay, learningConsolidator, promotionGovernor, shadowComparison, trainingReadiness });
  const status = statusFor(checks, outcomeReplay);
  const selectedCheck = checks.find((item) => item.status === "block") ?? checks.find((item) => item.status === "watch") ?? checks[0] ?? null;
  const maxReplayPressure = outcomeReplay.rows.length ? round(Math.max(...outcomeReplay.rows.map((row) => row.replayPressure))) : null;
  const allowedScope = status === "eligible-shadow" ? "shadow-memory" : "none";

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-learning-promotion-gate",
    status,
    promotionHash: stableHash({
      date,
      sport,
      replay: outcomeReplay.replayHash,
      learning: learningConsolidator.consolidatorHash,
      governor: promotionGovernor.governorHash,
      shadow: shadowComparison.comparisonHash,
      checks: checks.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status),
    checks,
    selectedCheck,
    metrics: {
      replayRows: outcomeReplay.rows.length,
      maxReplayPressure,
      pendingOutcomeTickets: outcomeReplay.totals.pendingOutcomeTickets,
      reinforceShadow: outcomeReplay.totals.reinforceShadow,
      downgradeUntilSettled: outcomeReplay.totals.downgradeUntilSettled,
      backtestSampleSize: outcomeReplay.historicalSignal.sampleSize,
      backtestPickCount: outcomeReplay.historicalSignal.pickCount,
      brierScore: outcomeReplay.historicalSignal.brierScore,
      logLoss: outcomeReplay.historicalSignal.logLoss,
      closingLineValue: outcomeReplay.historicalSignal.closingLineValue,
      eligibleShadowSports: promotionGovernor.totals.eligibleShadow,
      shadowRowsCompared: shadowComparison.totals.compared,
      shadowWouldPass: shadowComparison.totals.wouldPassShadow,
      shadowWouldDowngrade: shadowComparison.totals.wouldDowngrade
    },
    influencePlan: {
      allowedScope,
      canRecordShadowMemory: false,
      canAdjustProbabilities: false,
      canAdjustPublicPicks: false,
      canApplyLearnedWeights: false,
      canPersistWeights: false,
      nextShadowUse:
        allowedScope === "shadow-memory"
          ? "Compare the learning signal in shadow memory during the next supervised cycle; do not alter public probabilities."
          : selectedCheck?.requiredAction ?? "Keep learning signals quarantined."
    },
    policy: {
      requiresSettledOutcomes: true,
      requiresRealBacktest: true,
      requiresPositiveOrNeutralClv: true,
      maxReplayPressureForShadow: MAX_REPLAY_PRESSURE_FOR_SHADOW,
      maxPublicProbabilityDelta: 0,
      maxStakeUnits: 0
    },
    controls: {
      canInspectReadOnly: true,
      canPersistMemory: false,
      canPersistOutcomes: false,
      canRunCalibration: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/learning-promotion-gate",
      "/api/sports/decision/outcome-replay",
      "/api/sports/decision/learning-consolidator",
      "/api/sports/decision/training/promotion-governor",
      "/api/sports/decision/training/shadow-comparison",
      ...outcomeReplay.proofUrls,
      ...promotionGovernor.proofUrls,
      ...shadowComparison.proofUrls
    ]),
    locks: unique([
      "Learning promotion gate cannot persist memory, outcomes, calibration, training rows, or model weights.",
      "Shadow eligibility is advisory and cannot change public probabilities, picks, stakes, or published actions.",
      "Settled outcomes, real backtests, non-negative CLV, and governance must pass before learned signals leave quarantine.",
      ...outcomeReplay.locks,
      ...learningConsolidator.locks,
      ...promotionGovernor.blockers,
      ...shadowComparison.blockers
    ], 30)
  };
}
