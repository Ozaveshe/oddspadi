import type {
  BestPickResult,
  DecisionAbstentionRule,
  DecisionActionabilityAudit,
  DecisionAttribution,
  DecisionCaseMemory,
  DecisionDataCoverageAudit,
  DecisionMarketMovement,
  DecisionMonitoringPlan,
  DecisionProbabilityTrace,
  DecisionReviewLoop,
  DecisionRobustnessAudit,
  DecisionUncertaintyComponent,
  DecisionUncertaintyDecomposition,
  FootballModelDiagnostics
} from "@/lib/sports/types";
import { formatPercent, formatSignedPercent } from "./format";

function boundScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function uncertaintyLevel(score: number): DecisionUncertaintyComponent["level"] {
  if (score >= 64) return "high";
  if (score >= 34) return "medium";
  return "low";
}

function uncertaintyComponent(input: {
  id: string;
  category: DecisionUncertaintyComponent["category"];
  label: string;
  score: number;
  weight: number;
  detail: string;
  mitigation: string;
}): DecisionUncertaintyComponent {
  const score = boundScore(input.score);
  const weight = Math.max(0, input.weight);
  return {
    id: input.id,
    category: input.category,
    label: input.label,
    level: uncertaintyLevel(score),
    score,
    weight,
    contribution: score * weight,
    detail: input.detail,
    mitigation: input.mitigation
  };
}

/**
 * Produces the engine's diagnostic evidence-risk index. This is deliberately
 * non-statistical and must not be presented as a probability confidence band.
 */
export function buildDecisionUncertaintyDecomposition({
  diagnostics,
  bestPick,
  missingSignals,
  abstentionRules,
  dataCoverage,
  probabilityTrace,
  attribution,
  marketMovement,
  caseMemory,
  monitoringPlan,
  actionability,
  reviewLoop,
  robustness
}: {
  diagnostics: FootballModelDiagnostics;
  bestPick: BestPickResult;
  missingSignals: string[];
  abstentionRules: DecisionAbstentionRule[];
  dataCoverage: DecisionDataCoverageAudit;
  probabilityTrace: DecisionProbabilityTrace;
  attribution: DecisionAttribution;
  marketMovement: DecisionMarketMovement;
  caseMemory: DecisionCaseMemory;
  monitoringPlan: DecisionMonitoringPlan;
  actionability: DecisionActionabilityAudit;
  reviewLoop: DecisionReviewLoop;
  robustness: DecisionRobustnessAudit;
}): DecisionUncertaintyDecomposition {
  const modelScore = diagnostics.uncertainty === "high" ? 76 : diagnostics.uncertainty === "medium" ? 46 : 18;
  const modelMarketGap = Math.abs(probabilityTrace.disagreement ?? (bestPick.hasValue ? bestPick.edge : 0));
  const marketScore = Math.min(100, modelMarketGap * 520 + (probabilityTrace.conflicts.length ? 12 : 0));
  const dataScore = Math.min(100, 100 - dataCoverage.score + dataCoverage.missingSignals * 7 + dataCoverage.staleSignals * 8);
  const contextScore = Math.min(100, missingSignals.length * 12 + dataCoverage.requiredBeforeTrust.length * 6);
  const priceScore =
    marketMovement.status === "fragile"
      ? 82
      : marketMovement.status === "sensitive"
        ? 48
        : marketMovement.status === "resilient"
          ? 18
          : 70;
  const timingScore =
    monitoringPlan.status === "blocked" || monitoringPlan.status === "expired"
      ? 82
      : monitoringPlan.priority === "critical"
        ? 72
        : monitoringPlan.priority === "high"
          ? 48
          : monitoringPlan.status === "watching"
            ? 34
            : 18;
  const memoryScore =
    caseMemory.adjustment === "abstain"
      ? 86
      : caseMemory.adjustment === "discount"
        ? 58
        : caseMemory.status === "ready"
          ? 22
          : caseMemory.status === "failed"
            ? 46
            : 34;
  const robustnessScore =
    robustness.status === "fragile"
      ? 80
      : robustness.status === "sensitive"
        ? 54
        : reviewLoop.status === "blocked"
          ? 76
          : reviewLoop.status === "downgraded"
            ? 62
            : actionability.status === "blocked"
              ? 72
              : actionability.status === "watch-only"
                ? 46
                : 20;

  const components = [
    uncertaintyComponent({
      id: "model-uncertainty",
      category: "model",
      label: "Model uncertainty",
      score: modelScore,
      weight: 0.14,
      detail: `Model uncertainty is ${diagnostics.uncertainty}; model data quality is ${formatPercent(diagnostics.dataQualityScore)}.`,
      mitigation: "Improve model inputs with provider-backed history, form, team/player availability, and settled calibration."
    }),
    uncertaintyComponent({
      id: "market-disagreement",
      category: "market",
      label: "Model-market disagreement",
      score: marketScore,
      weight: 0.15,
      detail:
        probabilityTrace.disagreement === null
          ? "No priced candidate exists, so model-market disagreement cannot be measured."
          : `Model and no-vig market differ by ${formatSignedPercent(probabilityTrace.disagreement)}.`,
      mitigation: "Refresh bookmaker odds, compare closing price, and rerun no-vig probability before trusting the edge."
    }),
    uncertaintyComponent({
      id: "data-coverage",
      category: "data",
      label: "Data coverage uncertainty",
      score: dataScore,
      weight: 0.2,
      detail: dataCoverage.summary,
      mitigation: dataCoverage.requiredBeforeTrust[0] ?? "Keep provider-backed data checks connected before production trust."
    }),
    uncertaintyComponent({
      id: "context-gaps",
      category: "context",
      label: "Context uncertainty",
      score: contextScore,
      weight: 0.14,
      detail: missingSignals.length ? `Missing context: ${missingSignals.slice(0, 5).join(", ")}.` : "No major missing context signal is currently flagged.",
      mitigation: missingSignals[0] ? `Fetch or verify ${missingSignals[0]} before raising confidence.` : "Keep lineups, injuries, weather, news, and live events refreshed."
    }),
    uncertaintyComponent({
      id: "price-execution",
      category: "price",
      label: "Price execution uncertainty",
      score: priceScore,
      weight: 0.12,
      detail: marketMovement.summary,
      mitigation: marketMovement.alerts[0] ?? marketMovement.nextAction
    }),
    uncertaintyComponent({
      id: "timing-freshness",
      category: "timing",
      label: "Timing and freshness uncertainty",
      score: timingScore,
      weight: 0.08,
      detail: monitoringPlan.summary,
      mitigation: monitoringPlan.tasks[0]?.action ?? "Rerun the decision before the belief expiry window closes."
    }),
    uncertaintyComponent({
      id: "memory-calibration",
      category: "memory",
      label: "Memory and calibration uncertainty",
      score: memoryScore,
      weight: 0.08,
      detail: caseMemory.summary,
      mitigation:
        caseMemory.status === "ready"
          ? "Use settled comparable decisions to discount or confirm this pattern."
          : "Persist and settle decisions so similar-case memory can replace the neutral fallback."
    }),
    uncertaintyComponent({
      id: "robustness-review",
      category: "robustness",
      label: "Robustness and review uncertainty",
      score: robustnessScore,
      weight: 0.09,
      detail: `${robustness.summary} ${reviewLoop.summary}`,
      mitigation: robustness.requiredRechecks[0] ?? reviewLoop.releaseCriteria[0] ?? "Clear robustness and review-loop rechecks before public trust."
    })
  ];

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const score = totalWeight > 0 ? boundScore(components.reduce((sum, item) => sum + item.contribution, 0) / totalWeight) : 0;
  const triggeredAbstentions = abstentionRules.filter((rule) => rule.triggered);
  const primary = components.slice().sort((a, b) => b.contribution - a.contribution)[0];
  const status: DecisionUncertaintyDecomposition["status"] =
    triggeredAbstentions.length || score >= 66 || actionability.status === "blocked"
      ? "high-risk"
      : score >= 38 || attribution.status === "mixed" || monitoringPlan.status === "watching"
        ? "watchlist"
        : "controlled";
  const mitigations = Array.from(
    new Set(
      components
        .slice()
        .sort((a, b) => b.contribution - a.contribution)
        .map((item) => item.mitigation)
        .filter(Boolean)
    )
  ).slice(0, 6);
  const confidencePenalty = Math.min(0.28, score / 100 * 0.22 + triggeredAbstentions.length * 0.03);

  return {
    status,
    score,
    method: "weighted-evidence-risk-index-v1",
    statistical: false,
    summary:
      status === "controlled"
        ? `Diagnostic uncertainty risk is controlled at ${score}/100; primary uncertainty is ${primary.label}.`
        : status === "watchlist"
          ? `Diagnostic uncertainty risk needs watchlist treatment at ${score}/100; primary uncertainty is ${primary.label}.`
          : `Diagnostic uncertainty risk is high at ${score}/100; primary uncertainty is ${primary.label}.`,
    primaryUncertainty: primary.label,
    confidencePenalty,
    components,
    mitigations,
    decisionImpact:
      status === "controlled"
        ? "Uncertainty does not block the current action, but fresh odds and context still need review."
        : status === "watchlist"
          ? "Keep the decision monitored until the primary uncertainty bucket is reduced."
          : `Downgrade or block public trust until ${primary.label.toLowerCase()} is addressed.`
  };
}
