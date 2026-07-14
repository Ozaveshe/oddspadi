import type {
  BestPickResult,
  ConfidenceLevel,
  DecisionAbstentionRule,
  DecisionAction,
  DecisionBeliefSignal,
  DecisionBeliefState,
  DecisionCalibration,
  DecisionCaseMemory,
  DecisionContradictionCheck,
  DecisionEvidence,
  DecisionLearningProfile,
  FootballModelDiagnostics,
  Match
} from "@/lib/sports/types";
import { buildDecisionCalibrationInterval } from "./decisionCalibrationInterval";
import { formatPercent, formatSignedPercent } from "./format";

function boundScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function beliefSignalDirection(impact: DecisionEvidence["impact"]): DecisionBeliefSignal["direction"] {
  if (impact === "positive") return "supports";
  if (impact === "negative") return "opposes";
  return "uncertain";
}

function beliefImpactFromEvidence(item: DecisionEvidence): number {
  const qualityWeight = item.quality === "strong" ? 0.04 : item.quality === "acceptable" ? 0.028 : item.quality === "thin" ? 0.016 : 0.01;
  if (item.impact === "positive") return qualityWeight;
  if (item.impact === "negative") return -qualityWeight;
  return 0;
}

function beliefConfidenceFromEvidence(item: DecisionEvidence): ConfidenceLevel {
  if (item.quality === "strong") return "high";
  if (item.quality === "acceptable") return "medium";
  return "low";
}

function beliefTtlMinutes(match: Match, generatedAt: Date): number {
  if (match.status === "finished") return 0;
  if (match.status === "live") return 3;
  const kickoff = Date.parse(match.kickoffTime);
  if (!Number.isFinite(kickoff)) return 30;
  const minutesToKickoff = Math.max(0, Math.round((kickoff - generatedAt.getTime()) / 60000));
  if (minutesToKickoff <= 30) return 10;
  if (minutesToKickoff <= 120) return 30;
  return 60;
}

/**
 * Builds the expiring, auditable belief attached to a decision report.
 * `generatedAt` is injectable so expiry behavior can be tested without a wall-clock dependency.
 */
export function buildDecisionBeliefState({
  match,
  diagnostics,
  bestPick,
  evidence,
  missingSignals,
  contradictionChecks,
  abstentionRules,
  calibration,
  action,
  caseMemory,
  learningProfile,
  generatedAt = new Date()
}: {
  match: Match;
  diagnostics: FootballModelDiagnostics;
  bestPick: BestPickResult;
  evidence: DecisionEvidence[];
  missingSignals: string[];
  contradictionChecks: DecisionContradictionCheck[];
  abstentionRules: DecisionAbstentionRule[];
  calibration: DecisionCalibration;
  action: DecisionAction;
  caseMemory: DecisionCaseMemory;
  learningProfile?: DecisionLearningProfile;
  generatedAt?: Date;
}): DecisionBeliefState {
  const ttlMinutes = beliefTtlMinutes(match, generatedAt);
  const expiresAtDate = new Date(generatedAt.getTime() + ttlMinutes * 60000);
  const triggeredRules = abstentionRules.filter((rule) => rule.triggered);
  const conflicts = contradictionChecks.filter((check) => check.status === "conflict").length;
  const watches = contradictionChecks.filter((check) => check.status === "watch").length;
  const evidenceSignals: DecisionBeliefSignal[] = evidence
    .filter((item) => item.impact !== "neutral" || item.quality === "missing")
    .slice(0, 7)
    .map((item, index) => ({
      id: `evidence-${index + 1}`,
      label: item.label,
      direction: beliefSignalDirection(item.impact),
      probabilityImpact: beliefImpactFromEvidence(item),
      confidence: beliefConfidenceFromEvidence(item),
      source: item.category,
      detail: item.detail
    }));
  const selectionSignals: DecisionBeliefSignal[] = bestPick.hasValue
    ? [
        {
          id: "model-belief",
          label: `${bestPick.label} model belief`,
          direction: bestPick.edge > 0 && bestPick.expectedValue > 0 ? "supports" : "opposes",
          probabilityImpact: bestPick.edge,
          confidence: bestPick.confidence,
          source: "model-and-market",
          detail: `Model ${formatPercent(bestPick.modelProbability)}, no-vig ${formatPercent(bestPick.noVigImpliedProbability)}, EV ${formatSignedPercent(
            bestPick.expectedValue
          )}.`
        }
      ]
    : [
        {
          id: "no-value-belief",
          label: "No value belief",
          direction: "opposes",
          probabilityImpact: -0.04,
          confidence: "low",
          source: "model-and-market",
          detail: "No selection passed positive-edge and confidence filters."
        }
      ];
  const memorySignal: DecisionBeliefSignal = {
    id: "case-memory-belief",
    label: "Case memory belief",
    direction: caseMemory.adjustment === "abstain" || caseMemory.adjustment === "discount" ? "opposes" : caseMemory.status === "ready" ? "supports" : "uncertain",
    probabilityImpact: caseMemory.adjustment === "abstain" ? -0.06 : caseMemory.adjustment === "discount" ? -0.03 : caseMemory.status === "ready" ? 0.015 : 0,
    confidence: caseMemory.status === "ready" ? "medium" : "low",
    source: "decision-memory",
    detail: caseMemory.summary
  };
  const calibrationSignal: DecisionBeliefSignal = {
    id: "calibration-belief",
    label: "Calibration belief",
    direction: calibration.action === "trust" ? "supports" : calibration.action === "discount" ? "uncertain" : "opposes",
    probabilityImpact: calibration.action === "trust" ? 0.025 : calibration.action === "discount" ? -0.015 : -0.05,
    confidence: calibration.health === "stable" ? "high" : calibration.health === "review" ? "medium" : "low",
    source: "calibration",
    detail: calibration.detail
  };
  const signals = [...selectionSignals, calibrationSignal, memorySignal, ...evidenceSignals].slice(0, 10);
  const evidenceBalance = signals.reduce(
    (acc, signal) => {
      acc[signal.direction] += 1;
      return acc;
    },
    { supports: 0, opposes: 0, uncertain: 0 }
  );
  const uncertaintyScore = boundScore(
    (1 - diagnostics.dataQualityScore) * 34 +
      missingSignals.length * 4 +
      conflicts * 14 +
      watches * 7 +
      triggeredRules.length * 13 +
      (caseMemory.adjustment === "abstain" ? 18 : caseMemory.adjustment === "discount" ? 9 : 0) +
      (match.status === "live" ? 16 : match.status === "finished" ? 22 : 0)
  );
  const confidenceInterval = buildDecisionCalibrationInterval({
    probability: bestPick.hasValue ? bestPick.modelProbability : null,
    learningProfile
  });
  const grade: DecisionBeliefState["grade"] =
    action === "consider" && calibration.health === "stable" && uncertaintyScore <= 38 && !triggeredRules.length
      ? "strong"
      : action !== "avoid" && uncertaintyScore <= 64
        ? "moderate"
        : "fragile";
  const invalidationTriggers = [
    bestPick.hasValue
      ? `Invalidate if ${bestPick.label} no-vig edge falls to zero or EV turns negative.`
      : "Invalidate if fresh odds create a positive no-vig edge with acceptable confidence.",
    "Invalidate if confirmed lineups, injuries, suspensions, weather, or live events materially oppose the current thesis.",
    "Invalidate if bookmaker prices move before the next refresh window.",
    ...(caseMemory.adjustment === "none" ? [] : [`Invalidate or downgrade because case memory says ${caseMemory.adjustment}.`]),
    ...triggeredRules.map((rule) => `Blocking gate: ${rule.label}.`)
  ].slice(0, 7);

  return {
    status: "ready",
    grade,
    generatedAt: generatedAt.toISOString(),
    expiresAt: expiresAtDate.toISOString(),
    ttlMinutes,
    baseModelProbability: bestPick.hasValue ? bestPick.modelProbability : null,
    marketImpliedProbability: bestPick.hasValue ? bestPick.noVigImpliedProbability : null,
    believedProbability: bestPick.hasValue ? bestPick.modelProbability : null,
    probabilityEdge: bestPick.hasValue ? bestPick.edge : null,
    expectedValue: bestPick.hasValue ? bestPick.expectedValue : null,
    confidenceInterval,
    uncertaintyScore,
    evidenceBalance,
    signals,
    invalidationTriggers,
    summary: bestPick.hasValue
      ? `Belief is ${grade}: ${bestPick.label} at ${formatPercent(bestPick.modelProbability)} with ${formatSignedPercent(
          bestPick.edge
        )} edge, ${formatSignedPercent(bestPick.expectedValue)} EV, uncertainty ${uncertaintyScore}/100, expires in ${ttlMinutes} minutes.`
      : `Belief is ${grade}: no selection is trusted yet; uncertainty ${uncertaintyScore}/100, expires in ${ttlMinutes} minutes.`
  };
}
