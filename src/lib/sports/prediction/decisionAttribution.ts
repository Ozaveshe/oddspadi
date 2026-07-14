import type {
  BestPickResult,
  DecisionAbstentionRule,
  DecisionAction,
  DecisionActionabilityAudit,
  DecisionAttribution,
  DecisionAttributionDriver,
  DecisionCalibration,
  DecisionCaseMemory,
  DecisionDataCoverageAudit,
  DecisionMarketMovement,
  DecisionOddsIntelligence,
  DecisionProbabilityTrace,
  DecisionProbabilityTraceStep,
  DecisionReviewLoop
} from "@/lib/sports/types";
import { formatSignedPercent } from "./format";

function boundScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function attributionDirection(value: number): DecisionAttributionDriver["direction"] {
  if (value > 0.002) return "positive";
  if (value < -0.002) return "negative";
  return "neutral";
}

function attributionCategoryFromTrace(kind: DecisionProbabilityTraceStep["kind"]): DecisionAttributionDriver["category"] {
  if (kind === "model-evidence") return "model";
  if (kind === "context") return "context";
  if (kind === "market-calibration" || kind === "market-prior") return "market";
  if (kind === "data-quality") return "data";
  if (kind === "case-memory") return "memory";
  if (kind === "calibration") return "calibration";
  if (kind === "abstention") return "risk";
  return "operator";
}

function attributionDriver(input: {
  id: string;
  category: DecisionAttributionDriver["category"];
  label: string;
  direction: DecisionAttributionDriver["direction"];
  impactScore: number;
  probabilityImpact: number | null;
  detail: string;
}): DecisionAttributionDriver {
  return {
    id: input.id,
    category: input.category,
    label: input.label,
    direction: input.direction,
    impactScore: boundScore(input.impactScore),
    probabilityImpact: input.probabilityImpact,
    detail: input.detail
  };
}

/** Converts the probability trace and governance checks into ranked decision drivers. */
export function buildDecisionAttribution({
  bestPick,
  action,
  probabilityTrace,
  oddsIntelligence,
  marketMovement,
  dataCoverage,
  caseMemory,
  calibration,
  abstentionRules,
  actionability,
  reviewLoop
}: {
  bestPick: BestPickResult;
  action: DecisionAction;
  probabilityTrace: DecisionProbabilityTrace;
  oddsIntelligence: DecisionOddsIntelligence;
  marketMovement: DecisionMarketMovement;
  dataCoverage: DecisionDataCoverageAudit;
  caseMemory: DecisionCaseMemory;
  calibration: DecisionCalibration;
  abstentionRules: DecisionAbstentionRule[];
  actionability: DecisionActionabilityAudit;
  reviewLoop: DecisionReviewLoop;
}): DecisionAttribution {
  const drivers: DecisionAttributionDriver[] = probabilityTrace.steps
    .filter((step) => step.kind !== "market-prior" && step.kind !== "posterior")
    .map((step) => {
      const probabilityImpact = step.probabilityDelta ?? 0;
      return attributionDriver({
        id: `trace-${step.id}`,
        category: attributionCategoryFromTrace(step.kind),
        label: step.label,
        direction: step.status === "skipped" ? "neutral" : attributionDirection(probabilityImpact),
        impactScore: Math.abs(probabilityImpact) * 520 + step.weight * 18,
        probabilityImpact,
        detail: step.detail
      });
    });

  if (bestPick.hasValue) {
    drivers.push(
      attributionDriver({
        id: "best-value-edge",
        category: "market",
        label: `${bestPick.label} value edge`,
        direction: bestPick.edge > 0 && bestPick.expectedValue > 0 ? "positive" : "negative",
        impactScore: Math.abs(bestPick.edge) * 360 + Math.abs(bestPick.expectedValue) * 220,
        probabilityImpact: bestPick.edge,
        detail: `${bestPick.label} has no-vig edge ${formatSignedPercent(bestPick.edge)} and EV ${formatSignedPercent(bestPick.expectedValue)}.`
      })
    );
  } else {
    drivers.push(
      attributionDriver({
        id: "no-value-edge",
        category: "market",
        label: "No value edge",
        direction: "negative",
        impactScore: 70,
        probabilityImpact: null,
        detail: "No selection cleared positive edge, positive expected value, and confidence guardrails."
      })
    );
  }

  drivers.push(
    attributionDriver({
      id: "odds-intelligence",
      category: "market",
      label: "Odds intelligence",
      direction: oddsIntelligence.actionableSelections > 0 ? "positive" : oddsIntelligence.status === "no-value" ? "negative" : "neutral",
      impactScore: oddsIntelligence.actionableSelections * 12 + oddsIntelligence.positiveExpectedValueSelections * 8,
      probabilityImpact: oddsIntelligence.bestSelection?.edge ?? null,
      detail: oddsIntelligence.summary
    }),
    attributionDriver({
      id: "market-movement",
      category: "price",
      label: "Market movement",
      direction: marketMovement.status === "resilient" ? "positive" : marketMovement.status === "no-market" ? "neutral" : "negative",
      impactScore:
        marketMovement.status === "resilient"
          ? 32
          : marketMovement.status === "sensitive"
            ? 24
            : marketMovement.status === "fragile"
              ? 38
              : 10,
      probabilityImpact: marketMovement.currentEdge,
      detail: marketMovement.summary
    }),
    attributionDriver({
      id: "data-coverage",
      category: "data",
      label: "Data coverage",
      direction: dataCoverage.status === "provider-backed" ? "positive" : dataCoverage.requiredBeforeTrust.length ? "negative" : "neutral",
      impactScore: dataCoverage.status === "provider-backed" ? dataCoverage.score / 2 : dataCoverage.requiredBeforeTrust.length * 10 + dataCoverage.missingSignals * 5,
      probabilityImpact: null,
      detail: dataCoverage.summary
    }),
    attributionDriver({
      id: "actionability",
      category: "risk",
      label: "Actionability",
      direction: actionability.status === "actionable" ? "positive" : actionability.status === "blocked" ? "negative" : "neutral",
      impactScore: actionability.status === "actionable" ? actionability.score / 2 : 100 - actionability.score,
      probabilityImpact: null,
      detail: actionability.summary
    }),
    attributionDriver({
      id: "review-loop",
      category: "risk",
      label: "Review loop",
      direction: reviewLoop.status === "cleared" ? "positive" : reviewLoop.status === "blocked" || reviewLoop.status === "downgraded" ? "negative" : "neutral",
      impactScore: Math.abs(reviewLoop.scoreDelta) + (reviewLoop.unresolvedIssues.length + reviewLoop.releaseCriteria.length) * 4,
      probabilityImpact: null,
      detail: reviewLoop.summary
    }),
    attributionDriver({
      id: "calibration-health",
      category: "calibration",
      label: "Calibration health",
      direction: calibration.action === "trust" ? "positive" : calibration.action === "abstain" ? "negative" : "neutral",
      impactScore: calibration.action === "trust" ? calibration.reliabilityScore / 2 : 100 - calibration.reliabilityScore,
      probabilityImpact: null,
      detail: calibration.detail
    }),
    attributionDriver({
      id: "case-memory",
      category: "memory",
      label: "Case memory",
      direction: caseMemory.adjustment === "none" ? "neutral" : "negative",
      impactScore: caseMemory.adjustment === "abstain" ? 75 : caseMemory.adjustment === "discount" ? 44 : caseMemory.status === "ready" ? 18 : 8,
      probabilityImpact: null,
      detail: caseMemory.summary
    })
  );

  drivers.push(
    ...abstentionRules
      .filter((rule) => rule.triggered)
      .map((rule) =>
        attributionDriver({
          id: `abstention-${rule.id}`,
          category: "risk",
          label: rule.label,
          direction: "negative",
          impactScore: 82,
          probabilityImpact: null,
          detail: rule.detail
        })
      )
  );

  const missingDataDrag = dataCoverage.requiredBeforeTrust.slice(0, 5).map((item, index) =>
    attributionDriver({
      id: `missing-data-${index + 1}`,
      category: "data",
      label: item.split(":")[0] || `Missing data ${index + 1}`,
      direction: "negative",
      impactScore: 34 - index * 3,
      probabilityImpact: null,
      detail: item
    })
  );
  drivers.push(...missingDataDrag);

  const positiveDrivers = drivers
    .filter((driver) => driver.direction === "positive")
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 6);
  const negativeDrivers = drivers
    .filter((driver) => driver.direction === "negative")
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 6);
  const neutralDrivers = drivers
    .filter((driver) => driver.direction === "neutral")
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 4);
  const netProbabilityMovement =
    probabilityTrace.basePriorProbability === null || probabilityTrace.posteriorProbability === null
      ? null
      : probabilityTrace.posteriorProbability - probabilityTrace.basePriorProbability;
  const valueScore = bestPick.hasValue
    ? boundScore(bestPick.edge * 360 + bestPick.expectedValue * 280 + oddsIntelligence.actionableSelections * 7 + (marketMovement.status === "resilient" ? 12 : 0))
    : 0;
  const riskScore = boundScore(
    dataCoverage.missingSignals * 7 +
      dataCoverage.staleSignals * 8 +
      abstentionRules.filter((rule) => rule.triggered).length * 24 +
      (marketMovement.status === "fragile" ? 24 : marketMovement.status === "sensitive" ? 12 : 0) +
      (actionability.status === "blocked" ? 35 : actionability.status === "watch-only" ? 18 : 0) +
      (reviewLoop.status === "blocked" ? 28 : reviewLoop.status === "downgraded" ? 18 : reviewLoop.status === "repaired" ? 8 : 0) +
      (caseMemory.adjustment === "abstain" ? 30 : caseMemory.adjustment === "discount" ? 16 : 0)
  );
  const status: DecisionAttribution["status"] =
    action === "avoid" || actionability.status === "blocked" || abstentionRules.some((rule) => rule.triggered)
      ? "blocked"
      : negativeDrivers.length && riskScore >= Math.max(24, valueScore)
        ? "mixed"
        : "supportive";
  const strongestPositive = positiveDrivers[0];
  const strongestNegative = negativeDrivers[0];
  const decisiveFactor =
    status === "blocked"
      ? strongestNegative?.label ?? "Blocking guardrail"
      : strongestPositive && (!strongestNegative || strongestPositive.impactScore >= strongestNegative.impactScore)
        ? strongestPositive.label
        : strongestNegative?.label ?? "Balanced evidence";

  return {
    status,
    summary:
      status === "supportive"
        ? `Attribution is supportive: ${decisiveFactor} is the strongest driver, with value score ${valueScore}/100 and risk score ${riskScore}/100.`
        : status === "mixed"
          ? `Attribution is mixed: ${decisiveFactor} needs review, with value score ${valueScore}/100 and risk score ${riskScore}/100.`
          : `Attribution is blocked: ${decisiveFactor} prevents a trusted public recommendation.`,
    decisiveFactor,
    netProbabilityMovement,
    modelMarketGap: probabilityTrace.disagreement,
    valueScore,
    riskScore,
    positiveDrivers,
    negativeDrivers,
    neutralDrivers,
    missingDataDrag,
    explanation:
      status === "supportive"
        ? "The final action is mainly supported by model-vs-market edge, posterior probability, odds intelligence, and reliability checks."
        : status === "mixed"
          ? "The final action needs monitoring because positive value evidence is sharing the decision with material data, price, memory, or risk drag."
          : "The final action is constrained by a blocker; do not treat the selected side as public value until the negative driver clears."
  };
}
