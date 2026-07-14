import type {
  BestPickResult,
  ConfidenceLevel,
  DecisionAbstentionRule,
  DecisionAction,
  DecisionActionabilityAudit,
  DecisionActionabilityGate,
  DecisionActionabilityGateStatus,
  DecisionAgentStage,
  DecisionAiProtocol,
  DecisionAiProtocolCheck,
  DecisionAiProtocolQuestion,
  DecisionAiProtocolToolRequest,
  DecisionAttribution,
  DecisionBeliefState,
  DecisionBoundary,
  DecisionCalibration,
  DecisionCaseMemory,
  DecisionCaseMemoryBank,
  DecisionCaseMemoryRun,
  DecisionCommittee,
  DecisionCommitteeMember,
  DecisionContradictionCheck,
  DecisionControlGate,
  DecisionControlGateStatus,
  DecisionControlPolicy,
  DecisionDataCoverageAudit,
  DecisionDataCoverageSignal,
  DecisionDeliberation,
  DecisionEngineReport,
  DecisionEvidence,
  DecisionFactor,
  DecisionHealth,
  DecisionHistoricalDiscipline,
  DecisionLearningProfile,
  DecisionMonitoringPlan,
  DecisionMonitoringPriority,
  DecisionMonitoringTask,
  DecisionMarketMovement,
  DecisionOddsIntelligence,
  DecisionProbabilityTrace,
  DecisionReasoningEdge,
  DecisionReasoningGraph,
  DecisionReasoningNode,
  DecisionReasoningNodeStatus,
  DecisionReviewLoop,
  DecisionReviewLoopStep,
  DecisionRobustnessAudit,
  DecisionScenario,
  DecisionSensitivityCheck,
  DecisionToolOrchestrationPlan,
  DecisionToolExecutionAttempt,
  DecisionToolExecutionAttemptStatus,
  DecisionToolExecutionAudit,
  DecisionToolTask,
  DecisionToolTaskStatus,
  DecisionUncertaintyDecomposition,
  DecisionVerdict,
  FootballModelDiagnostics,
  Match,
  MatchContextAdjustment,
  LearnedProbabilityCalibrationAdjustment,
  MarketPriorAdjustment,
  PredictionMarket,
  RiskLevel,
  SaferAlternative,
  ValueEdge
} from "@/lib/sports/types";
import { isRequiredProductionDataSignalBlocked } from "./contextSignalPolicy";
import type { PublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";
import { formatOdds, formatPercent, formatSignedPercent } from "./format";
import { selectBestPick } from "./odds";
import { buildDecisionHistoricalDiscipline } from "./decisionHistoricalEvidence";
import { buildDecisionDataCoverageAudit } from "./decisionDataCoverage";
import {
  buildDecisionProbabilityTrace,
  type DecisionProbabilityRuntimeStages
} from "./decisionProbabilityTrace";
import { buildDecisionBeliefState } from "./decisionBeliefState";
import { buildDecisionUncertaintyDecomposition } from "./decisionUncertainty";
import { buildDecisionEvidence, findCoreModelContextSignal, hasLiveInPlayModel } from "./decisionEvidence";
import { buildDecisionAttribution } from "./decisionAttribution";
import {
  buildDecisionMarketMovement,
  buildDecisionOddsIntelligence,
  edgeAfterOddsMultiplier,
  fairOdds,
  formatFairOdds
} from "./decisionMarketIntelligence";
import { buildDecisionBoundary } from "./decisionBoundary";
import { buildDecisionRobustnessAudit } from "./decisionRobustness";
import { buildDecisionEvaluationPlan } from "./decisionEvaluationPlan";
import { buildDecisionResearchBrief } from "./decisionResearchBrief";
import { buildDecisionNotebook } from "./decisionNotebook";

export const DECISION_ENGINE_VERSION = "decision-engine-v1";

function confidenceScore(confidence: ConfidenceLevel): number {
  if (confidence === "high") return 3;
  if (confidence === "medium") return 2;
  return 1;
}

function winnerProbabilities(markets: PredictionMarket[]) {
  return markets.find((market) => market.marketId === "match_winner")?.probabilities ?? {};
}

function marketProbability(markets: PredictionMarket[], marketId: string, selectionId: string): number {
  return markets.find((market) => market.marketId === marketId)?.probabilities[selectionId] ?? 0;
}

function riskFromProbability(probability: number): RiskLevel {
  if (probability >= 0.68) return "low";
  if (probability >= 0.48) return "medium";
  return "high";
}

function boundScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function learnedNumber(value: number | null | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function activeLearnedNumber(
  profile: DecisionLearningProfile | undefined,
  value: number | null | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  return profile?.active ? learnedNumber(value, fallback, min, max) : fallback;
}

function average(numbers: number[]): number | null {
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function stageStatus(score: number): "passed" | "warning" | "failed" {
  if (score >= 70) return "passed";
  if (score >= 45) return "warning";
  return "failed";
}

function alternative(
  market: string,
  selection: string,
  modelProbability: number,
  rationale: string,
  availableInMvp: boolean
): SaferAlternative {
  return {
    market,
    selection,
    modelProbability,
    fairOdds: fairOdds(modelProbability),
    rationale,
    risk: riskFromProbability(modelProbability),
    availableInMvp
  };
}

function buildSaferAlternatives(match: Match, markets: PredictionMarket[], bestPick: BestPickResult): SaferAlternative[] {
  const winner = winnerProbabilities(markets);
  const home = winner.home ?? 0;
  const draw = winner.draw ?? 0;
  const away = winner.away ?? 0;
  let alternatives: SaferAlternative[] = [];

  if (match.sport === "basketball") {
    const homeCover = marketProbability(markets, "spread", "home_cover");
    const awayCover = marketProbability(markets, "spread", "away_cover");
    const over = marketProbability(markets, "total_points", "over");
    const under = marketProbability(markets, "total_points", "under");
    alternatives = [
      alternative("Moneyline", match.homeTeam.name, home, "Lower-complexity side market; compare with fresh moneyline before action.", true),
      alternative("Moneyline", match.awayTeam.name, away, "Lower-complexity side market; useful when spread edge is fragile.", true),
      alternative("Spread", `${match.homeTeam.name} cover`, homeCover, "Review against the posted spread; sensitive to injury/rest news.", true),
      alternative("Spread", `${match.awayTeam.name} cover`, awayCover, "Review against the posted spread; sensitive to injury/rest news.", true),
      alternative("Total points", "Over", over, "Useful when projected pace and efficiency clear the posted total.", true),
      alternative("Total points", "Under", under, "Useful when projected pace or offensive efficiency trails the posted total.", true)
    ];
  } else if (match.sport === "tennis") {
    const homeSets = marketProbability(markets, "set_handicap", "home_sets");
    const awaySets = marketProbability(markets, "set_handicap", "away_sets");
    const overGames = marketProbability(markets, "total_games", "over");
    const underGames = marketProbability(markets, "total_games", "under");
    alternatives = [
      alternative("Match winner", match.homeTeam.name, home, "Primary side market from surface-adjusted Elo and recent form.", true),
      alternative("Match winner", match.awayTeam.name, away, "Primary side market from surface-adjusted Elo and recent form.", true),
      alternative("Set handicap", `${match.homeTeam.name} sets`, homeSets, "Higher variance than moneyline; verify fitness and matchup before action.", true),
      alternative("Set handicap", `${match.awayTeam.name} sets`, awaySets, "Higher variance than moneyline; verify fitness and matchup before action.", true),
      alternative("Total games", "Over", overGames, "Useful when projected match competitiveness points to longer sets.", true),
      alternative("Total games", "Under", underGames, "Useful when dominance signal points to shorter match length.", true)
    ];
  } else {
    const over25 = marketProbability(markets, "over_under_25", "over_25");
    const under25 = marketProbability(markets, "over_under_25", "under_25");
    const bttsYes = marketProbability(markets, "both_teams_to_score", "yes");
    const bttsNo = marketProbability(markets, "both_teams_to_score", "no");

    alternatives = [
      alternative(
        "Double chance",
        `${match.homeTeam.name} or Draw`,
        home + draw,
        "Covers the home side avoiding defeat; useful when home edge exists but outright win variance is high.",
        false
      ),
      alternative(
        "Double chance",
        `Draw or ${match.awayTeam.name}`,
        draw + away,
        "Covers the away side avoiding defeat; useful when away win probability is competitive.",
        false
      )
    ];

    if (home + away > 0) {
      alternatives.push(
        alternative(
          "Draw no bet",
          match.homeTeam.name,
          home / (home + away),
          "Removes draw exposure from the home-side view; requires a bookmaker DNB price before edge can be confirmed.",
          false
        ),
        alternative(
          "Draw no bet",
          match.awayTeam.name,
          away / (home + away),
          "Removes draw exposure from the away-side view; requires a bookmaker DNB price before edge can be confirmed.",
          false
        )
      );
    }

    alternatives.push(
      alternative("Goals", "Over 2.5 Goals", over25, "Useful if model goal expectation is high enough versus available odds.", true),
      alternative("Goals", "Under 2.5 Goals", under25, "Useful if expected goals and score matrix point toward a tighter match.", true),
      alternative("Both Teams To Score", "BTTS Yes", bttsYes, "Useful when both attack signals are strong enough.", true),
      alternative("Both Teams To Score", "BTTS No", bttsNo, "Useful when one side's scoring probability is weak or defensive signal is strong.", true)
    );
  }

  return alternatives
    .filter((item) => item.modelProbability > 0)
    .sort((a, b) => {
      if (a.availableInMvp !== b.availableInMvp) return Number(b.availableInMvp) - Number(a.availableInMvp);
      return b.modelProbability - a.modelProbability;
    })
    .slice(0, bestPick.hasValue ? 5 : 4);
}

function buildRisks(
  match: Match,
  diagnostics: FootballModelDiagnostics,
  bestPick: BestPickResult,
  contextAdjustment?: MatchContextAdjustment
): string[] {
  const risks = [
    "Sports outcomes are uncertain; the decision engine is an analysis layer, not a guarantee.",
    "Bookmaker prices can move quickly, so stale odds can erase a calculated edge."
  ];

  if (diagnostics.uncertainty !== "low") {
    risks.push(`Data quality creates ${diagnostics.uncertainty} model uncertainty for this match.`);
  }
  if (bestPick.hasValue && bestPick.odds >= 3.5) {
    risks.push("The selection has high decimal odds, which usually means higher outcome variance.");
  }
  if (match.status === "live") {
    if (hasLiveInPlayModel(match, diagnostics)) {
      risks.push("The match is live; the football model uses score and minute, but cards, substitutions, shot pressure, and late injuries can still invalidate it.");
    } else {
      risks.push(
        match.sport === "basketball"
          ? "The match is live; a proper in-play model should account for clock, score, possession, fouls, timeouts, lineup, and pace."
          : match.sport === "tennis"
            ? "The match is live; a proper in-play model should account for set score, serve state, break points, fatigue, and retirement risk."
            : "The match is live; a proper in-play model should account for minute, score, cards, substitutions, and shot pressure."
      );
    }
  }
  if (contextAdjustment?.riskFlags.length) {
    risks.push(...contextAdjustment.riskFlags.slice(0, 3));
  }

  return risks;
}

function buildAvoidReasons(bestPick: BestPickResult, diagnostics: FootballModelDiagnostics): string[] {
  const reasons: string[] = [];
  if (!bestPick.hasValue) reasons.push("No selection passed the positive value-edge and confidence threshold.");
  if (diagnostics.dataQualityScore < 0.62) reasons.push("Data quality is too low for a confident decision.");
  if (bestPick.hasValue && bestPick.confidence === "low") reasons.push("Edge exists, but confidence remains low after data-quality adjustment.");
  return reasons;
}

function emptyCaseMemory(status: DecisionCaseMemory["status"], configured: boolean, summary: string, notes: string[] = []): DecisionCaseMemory {
  return {
    status,
    configured,
    sampleSize: 0,
    similarCases: [],
    actionMix: {
      consider: 0,
      monitor: 0,
      avoid: 0
    },
    averageSimilarity: null,
    averageReliabilityScore: null,
    averageDecisionScore: null,
    adjustment: "none",
    summary,
    notes
  };
}

function similarityFromDifference(a: number | null, b: number | null, tolerance: number): number {
  if (a === null || b === null) return 0;
  return Math.max(0, 1 - Math.abs(a - b) / tolerance);
}

function caseSimilarity(
  currentBestPick: BestPickResult,
  diagnostics: FootballModelDiagnostics,
  run: DecisionCaseMemoryRun
): { score: number; rationale: string } {
  const parts: Array<{ weight: number; score: number; reason: string }> = [];

  if (currentBestPick.hasValue && run.bestPick.hasValue) {
    parts.push({
      weight: 0.18,
      score: currentBestPick.marketId === run.bestPick.marketId ? 1 : 0.15,
      reason:
        currentBestPick.marketId === run.bestPick.marketId
          ? `same market ${currentBestPick.marketId}`
          : `different market ${run.bestPick.marketId}`
    });
    parts.push({
      weight: 0.14,
      score: currentBestPick.label === run.bestPick.label ? 1 : 0.35,
      reason: currentBestPick.label === run.bestPick.label ? "same selection label" : "different selection label"
    });
    parts.push({
      weight: 0.16,
      score: similarityFromDifference(currentBestPick.modelProbability, run.bestPick.modelProbability, 0.16),
      reason: "model probability distance"
    });
    parts.push({
      weight: 0.16,
      score: similarityFromDifference(currentBestPick.edge, run.bestPick.edge, 0.12),
      reason: "edge distance"
    });
    parts.push({
      weight: 0.16,
      score: similarityFromDifference(currentBestPick.expectedValue, run.bestPick.expectedValue, 0.18),
      reason: "EV distance"
    });
    parts.push({
      weight: 0.08,
      score: currentBestPick.confidence === run.confidence ? 1 : 0.35,
      reason: "confidence match"
    });
    parts.push({
      weight: 0.08,
      score: currentBestPick.risk === run.risk ? 1 : 0.35,
      reason: "risk match"
    });
  } else {
    parts.push({
      weight: 0.5,
      score: currentBestPick.hasValue === run.bestPick.hasValue ? 1 : 0.15,
      reason: currentBestPick.hasValue === run.bestPick.hasValue ? "same value/no-value state" : "different value/no-value state"
    });
  }

  parts.push({
    weight: 0.04,
    score: similarityFromDifference(diagnostics.dataQualityScore, run.reliabilityScore === null ? null : run.reliabilityScore / 100, 0.35),
    reason: "quality and reliability proximity"
  });

  const totalWeight = parts.reduce((sum, item) => sum + item.weight, 0);
  const score = totalWeight > 0 ? parts.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight : 0;
  const strongest = parts
    .slice()
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .slice(0, 3)
    .map((item) => item.reason)
    .join(", ");

  return {
    score: Math.max(0, Math.min(1, score)),
    rationale: strongest || "limited comparable features"
  };
}

function buildCaseMemory({
  bestPick,
  diagnostics,
  caseMemoryBank
}: {
  bestPick: BestPickResult;
  diagnostics: FootballModelDiagnostics;
  caseMemoryBank?: DecisionCaseMemoryBank;
}): DecisionCaseMemory {
  if (!caseMemoryBank) {
    return emptyCaseMemory(
      "not-configured",
      false,
      "Case memory was not loaded for this decision.",
      ["The engine can score the current match, but cannot compare it to stored decisions in this run."]
    );
  }

  if (caseMemoryBank.status !== "ready") {
    return emptyCaseMemory(caseMemoryBank.status, caseMemoryBank.configured, caseMemoryBank.reason ?? "No case-memory comparison is available.", [
      caseMemoryBank.projectRef ? `Supabase project ${caseMemoryBank.projectRef}` : "Supabase project not available"
    ]);
  }

  const similarCases = caseMemoryBank.runs
    .map((run) => {
      const similarity = caseSimilarity(bestPick, diagnostics, run);
      return {
        id: run.id,
        fixtureExternalId: run.fixtureExternalId,
        similarity: Number(similarity.score.toFixed(3)),
        verdict: run.verdict,
        action: run.action,
        health: run.health,
        confidence: run.confidence,
        risk: run.risk,
        decisionScore: run.decisionScore,
        reliabilityScore: run.reliabilityScore,
        recommendedSelection: run.recommendedSelection,
        expectedValue: run.bestPick.hasValue ? run.bestPick.expectedValue : null,
        edge: run.bestPick.hasValue ? run.bestPick.edge : null,
        createdAt: run.createdAt,
        rationale: similarity.rationale
      };
    })
    .filter((item) => item.similarity >= 0.2)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  if (!similarCases.length) {
    return {
      ...emptyCaseMemory(
        "ready",
        true,
        `Loaded ${caseMemoryBank.runs.length} stored decisions, but none are similar enough to affect this decision.`,
        ["Case memory stayed neutral because comparable examples are weak."]
      ),
      sampleSize: caseMemoryBank.runs.length
    };
  }

  const actionMix = {
    consider: similarCases.filter((item) => item.action === "consider").length,
    monitor: similarCases.filter((item) => item.action === "monitor").length,
    avoid: similarCases.filter((item) => item.action === "avoid").length
  };
  const reliabilityScores = similarCases
    .map((item) => item.reliabilityScore)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  const averageReliabilityScore = average(reliabilityScores);
  const averageDecisionScore = average(similarCases.map((item) => item.decisionScore));
  const averageSimilarity = average(similarCases.map((item) => item.similarity));
  const avoidShare = similarCases.length ? actionMix.avoid / similarCases.length : 0;
  const adjustment =
    avoidShare >= 0.75 && (averageReliabilityScore ?? 100) < 45
      ? "abstain"
      : avoidShare >= 0.55 || (averageReliabilityScore !== null && averageReliabilityScore < 50)
        ? "discount"
        : "none";

  return {
    status: "ready",
    configured: true,
    sampleSize: caseMemoryBank.runs.length,
    similarCases,
    actionMix,
    averageSimilarity: averageSimilarity === null ? null : Number(averageSimilarity.toFixed(3)),
    averageReliabilityScore: averageReliabilityScore === null ? null : Math.round(averageReliabilityScore),
    averageDecisionScore: averageDecisionScore === null ? null : Math.round(averageDecisionScore),
    adjustment,
    summary:
      adjustment === "abstain"
        ? `Case memory found ${similarCases.length} similar stored decisions with a strong avoid pattern, so the engine should abstain.`
        : adjustment === "discount"
          ? `Case memory found ${similarCases.length} similar stored decisions with weak reliability or avoid pressure, so confidence is discounted.`
          : `Case memory found ${similarCases.length} similar stored decisions and did not find enough historical pressure to downgrade.`,
    notes: [
      `Compared against ${caseMemoryBank.runs.length} stored ${caseMemoryBank.runs[0]?.sport ?? "sport"} decisions.`,
      averageReliabilityScore === null
        ? "Stored cases do not yet have enough reliability scoring from outcomes."
        : `Average similar-case reliability is ${Math.round(averageReliabilityScore)}/100.`
    ]
  };
}

function factor(
  key: string,
  label: string,
  score: number,
  weight: number,
  explanation: string
): DecisionFactor {
  const boundedScore = Math.max(-100, Math.min(100, score));
  return {
    key,
    label,
    score: Math.round(boundedScore),
    weight,
    weightedScore: Math.round(boundedScore * weight),
    explanation
  };
}

function buildDecisionFactors(
  match: Match,
  diagnostics: FootballModelDiagnostics,
  bestPick: BestPickResult,
  learningProfile?: DecisionLearningProfile,
  caseMemory?: DecisionCaseMemory,
  historicalDiscipline?: DecisionHistoricalDiscipline
): DecisionFactor[] {
  const missingSignalPenalty = diagnostics.dataQualityScore >= 0.78 ? -8 : -14;
  const liveInPlayModel = hasLiveInPlayModel(match, diagnostics);
  const livePenalty = match.status === "live" ? (liveInPlayModel ? -3 : -10) : 0;
  const valueEdgeWeight = activeLearnedNumber(learningProfile, learningProfile?.valueEdgeWeight, 0.32, 0.22, 0.44);
  const dataQualityWeight = activeLearnedNumber(learningProfile, learningProfile?.dataQualityWeight, 0.18, 0.16, 0.26);
  const marketAdjustmentWeight = activeLearnedNumber(learningProfile, learningProfile?.marketAdjustmentWeight, 0.14, 0.08, 0.24);
  const learningScore = learningProfile?.active
    ? Math.max(-30, Math.min(35, (learningProfile.yield ?? 0) * 140 + (learningProfile.closingLineValue ?? 0) * 80))
    : 0;
  const memoryScore =
    caseMemory?.status === "ready"
      ? caseMemory.adjustment === "abstain"
        ? -55
        : caseMemory.adjustment === "discount"
          ? -24
          : Math.max(-12, Math.min(28, (caseMemory.averageReliabilityScore ?? 58) - 50 + (caseMemory.actionMix.consider - caseMemory.actionMix.avoid) * 4))
      : 0;
  const historicalScore =
    historicalDiscipline?.status === "market-prior-dominant" && bestPick.hasValue
      ? -45
      : historicalDiscipline?.status === "provider-retest-ready"
        ? -12
        : historicalDiscipline?.status === "blocked"
          ? -38
          : historicalDiscipline?.attached
            ? -6
            : 0;

  return [
    factor(
      "value_edge",
      "Value edge",
      bestPick.hasValue ? Math.min(100, bestPick.edge * 900) : -35,
      valueEdgeWeight,
      bestPick.hasValue
        ? `Positive no-vig edge of ${formatSignedPercent(bestPick.edge)} versus margin-adjusted implied probability${
            learningProfile?.active ? `; historical learning weight ${valueEdgeWeight}.` : "."
          }`
        : "No selection cleared the positive-edge guardrail."
    ),
    factor(
      "expected_value",
      "Expected value",
      bestPick.hasValue ? Math.min(100, bestPick.expectedValue * 650) : -35,
      0.16,
      bestPick.hasValue
        ? `Expected return is ${formatSignedPercent(bestPick.expectedValue)} per unit at decimal odds ${formatOdds(bestPick.odds)}.`
        : "No selection cleared the positive-EV guardrail."
    ),
    factor(
      "confidence",
      "Confidence guardrail",
      bestPick.hasValue ? (bestPick.confidence === "high" ? 85 : bestPick.confidence === "medium" ? 55 : 10) : -25,
      0.2,
      bestPick.hasValue ? `${bestPick.confidence} confidence after edge, probability, and data-quality checks.` : "No viable pick means confidence stays low."
    ),
    factor(
      "data_quality",
      "Data quality",
      diagnostics.dataQualityScore * 100 - 45,
      dataQualityWeight,
      `Data quality is ${formatPercent(diagnostics.dataQualityScore)}${
        learningProfile?.active ? `; historical learning weight ${dataQualityWeight}.` : "."
      }`
    ),
    factor(
      "variance",
      "Outcome variance",
      bestPick.hasValue ? (bestPick.risk === "low" ? 35 : bestPick.risk === "medium" ? 5 : -30) : -20,
      marketAdjustmentWeight,
      bestPick.hasValue ? `${bestPick.risk} risk based on confidence and odds level.` : "No clear value creates no acceptable variance profile."
    ),
    factor(
      "missing_context",
      "Missing context",
      missingSignalPenalty,
      0.1,
      "Lineups, injury/suspension news, and weather are not connected yet."
    ),
    factor(
      "live_state",
      "Live state",
      livePenalty,
      0.06,
      match.status === "live"
        ? liveInPlayModel
          ? "Match is live; football score/minute in-play recalibration is active, with event-feed risk still monitored."
          : "Match is live, but the engine does not yet have a full in-play event model."
        : "Pre-match state avoids in-play recalibration risk."
    ),
    factor(
      "historical_learning",
      "Historical learning",
      learningScore,
      learningProfile?.active ? 0.06 : 0,
      learningProfile ? learningProfile.reason : "No historical learning profile was loaded; default guardrails are active."
    ),
    factor(
      "case_memory",
      "Case memory",
      memoryScore,
      caseMemory?.status === "ready" ? 0.07 : 0,
      caseMemory?.summary ?? "Case memory was not loaded for this decision."
    ),
    factor(
      "historical_discipline",
      "Historical discipline",
      historicalScore,
      historicalDiscipline?.attached ? 0.08 : 0,
      historicalDiscipline?.instruction ?? "No 10-year public historical evidence is attached to this decision."
    )
  ];
}

function scoreToVerdict(
  score: number,
  bestPick: BestPickResult,
  diagnostics: FootballModelDiagnostics
): { verdict: DecisionVerdict; action: DecisionAction } {
  if (diagnostics.dataQualityScore < 0.62) return { verdict: "insufficient-data", action: "avoid" };
  if (!bestPick.hasValue || score < 8) return { verdict: "avoid", action: "avoid" };
  if (score >= 42 && bestPick.confidence === "high" && bestPick.risk !== "high") return { verdict: "strong-value", action: "consider" };
  if (score >= 24) return { verdict: "lean-value", action: "consider" };
  return { verdict: "watchlist", action: "monitor" };
}

function applyAbstentionVerdict(
  base: { verdict: DecisionVerdict; action: DecisionAction },
  abstentionRules: DecisionAbstentionRule[]
): { verdict: DecisionVerdict; action: DecisionAction } {
  const dataQualityFloor = abstentionRules.find((rule) => rule.id === "data-quality-floor")?.triggered;
  const hardStop = abstentionRules.some(
    (rule) =>
      rule.triggered &&
      [
        "no-positive-edge",
        "data-quality-floor",
        "live-without-inplay-model",
        "future-fixture-synthetic-market",
        "learned-minimum-edge",
        "case-memory-abstention",
        "historical-market-prior"
      ].includes(
        rule.id
      )
  );

  if (dataQualityFloor) return { verdict: "insufficient-data", action: "avoid" };
  if (hardStop) return { verdict: "avoid", action: "avoid" };
  return base;
}

function applyPublicActionInvariant(
  base: { verdict: DecisionVerdict; action: DecisionAction },
  bestPick: BestPickResult,
  abstentionRules: DecisionAbstentionRule[],
  dataCoverage: DecisionDataCoverageAudit,
  calibration: DecisionCalibration,
  actionability: DecisionActionabilityAudit
): { verdict: DecisionVerdict; action: DecisionAction } {
  if (base.action !== "consider") return base;

  const hasTriggeredAbstention = abstentionRules.some((rule) => rule.triggered);
  const hasRequiredProductionBlocker = dataCoverage.signals.some(isRequiredProductionDataSignalBlocked);

  if (!bestPick.hasValue || hasTriggeredAbstention || calibration.action === "abstain" || actionability.status === "blocked") {
    return { verdict: "avoid", action: "avoid" };
  }
  if (hasRequiredProductionBlocker || actionability.status !== "actionable") {
    return { verdict: "watchlist", action: "monitor" };
  }
  return base;
}

function hasFutureFixtureSyntheticMarketGate(match: Match): boolean {
  const oddsProvider = match.dataSource?.oddsProvider?.toLowerCase() ?? "";
  const fixtureProvider = match.dataSource?.fixtureProvider?.toLowerCase() ?? "";
  return (
    oddsProvider.includes("synthetic") ||
    fixtureProvider.includes("official-2026-seed") ||
    Boolean(match.providerContextSignals?.some((signal) => signal.id.includes("preseason-horizon-risk") || signal.label.toLowerCase().includes("preseason horizon")))
  );
}

function buildSensitivityChecks(bestPick: BestPickResult, diagnostics: FootballModelDiagnostics, decisionScore: number): DecisionSensitivityCheck[] {
  if (!bestPick.hasValue) {
    return [
      {
        label: "Odds movement",
        effect: "requires-review",
        detail: "A materially better price could create value, but the current market does not pass the guardrail."
      },
      {
        label: "Team news",
        effect: "requires-review",
        detail: "Confirmed absences, player fitness, or lineup surprises could change the projection enough to rerun the decision."
      },
      {
        label: "Data quality",
        effect: diagnostics.dataQualityScore < 0.62 ? "requires-review" : "keeps-verdict",
        detail: "More complete provider data is needed before raising confidence."
      }
    ];
  }

  const edgeAfterFivePercentOddsDrop = edgeAfterOddsMultiplier(bestPick, 0.95);
  const edgeEffect = edgeAfterFivePercentOddsDrop > 0.025 ? "keeps-verdict" : "downgrades-verdict";
  const adverseNewsScore = decisionScore - 18;

  return [
    {
      label: "Odds shorten by 5%",
      effect: edgeEffect,
      detail:
        edgeAfterFivePercentOddsDrop > 0
          ? `Edge would shrink to about ${formatSignedPercent(edgeAfterFivePercentOddsDrop)}.`
          : "A 5% shorter price would remove the positive edge."
    },
    {
      label: "Adverse lineup or injury news",
      effect: adverseNewsScore >= 24 ? "keeps-verdict" : "downgrades-verdict",
      detail: "A moderate negative availability or context adjustment would reduce the decision score by about 18 points."
    },
    {
      label: "Data-quality upgrade",
      effect: diagnostics.dataQualityScore >= 0.78 ? "keeps-verdict" : "upgrades-verdict",
      detail: "Confirmed availability, lineups, injuries, weather, or sport-specific context can improve confidence if they support the existing model signal."
    }
  ];
}

function buildAbstentionRules(
  match: Match,
  diagnostics: FootballModelDiagnostics,
  bestPick: BestPickResult,
  missingSignals: string[],
  learningProfile?: DecisionLearningProfile,
  caseMemory?: DecisionCaseMemory,
  historicalDiscipline?: DecisionHistoricalDiscipline
): DecisionAbstentionRule[] {
  const weakEdgeWithMissingContext =
    bestPick.hasValue && bestPick.edge < 0.06 && diagnostics.dataQualityScore < 0.78 && missingSignals.length >= 3;
  const learnedMinimumEdge = learningProfile?.active ? learnedNumber(learningProfile.minimumEdge, 0.035, 0.02, 0.09) : null;
  const liveInPlayModel = hasLiveInPlayModel(match, diagnostics);
  const futureFixtureSyntheticMarket = hasFutureFixtureSyntheticMarketGate(match);

  return [
    {
      id: "no-positive-edge",
      label: "Positive edge and EV required",
      triggered: !bestPick.hasValue,
      detail: bestPick.hasValue
        ? `${bestPick.label} clears the positive-edge filter at ${formatSignedPercent(bestPick.edge)} and EV ${formatSignedPercent(
            bestPick.expectedValue
          )}.`
        : "The agent refuses to force a pick when no market selection clears both the edge and positive-EV thresholds."
    },
    {
      id: "data-quality-floor",
      label: "Data quality floor",
      triggered: diagnostics.dataQualityScore < 0.62,
      detail: `Data quality is ${formatPercent(diagnostics.dataQualityScore)}; below 62% the agent abstains.`
    },
    {
      id: "high-variance-edge",
      label: "High-variance edge",
      triggered: bestPick.hasValue && bestPick.risk === "high" && bestPick.edge < 0.08,
      detail: bestPick.hasValue
        ? `${bestPick.label} risk is ${bestPick.risk}; high-risk picks need a wider edge before consideration.`
        : "No selection is available for variance review."
    },
    {
      id: "live-without-inplay-model",
      label: "Live model requirement",
      triggered: match.status === "live" && !liveInPlayModel,
      detail:
        match.status === "live"
          ? liveModelRequirementDetail(match, diagnostics)
          : "Pre-match fixture; in-play event model is not required yet."
    },
    {
      id: "thin-context-edge",
      label: "Thin context around edge",
      triggered: weakEdgeWithMissingContext,
      detail: weakEdgeWithMissingContext
        ? "The edge is not wide enough to ignore missing availability, lineup, news, and environment context."
        : "Missing context is noted but does not force abstention at the current edge/data-quality level."
    },
    {
      id: "future-fixture-synthetic-market",
      label: "Future fixture synthetic market",
      triggered: futureFixtureSyntheticMarket,
      detail: futureFixtureSyntheticMarket
        ? "Fixture is using an official future-season seed and/or synthetic preseason odds; keep analysis monitor-only until provider event IDs, real bookmaker snapshots, lineups, injuries, news, and weather are refreshed."
        : "Fixture has no future-season seed or synthetic market flag."
    },
    {
      id: "learned-minimum-edge",
      label: "Learned minimum edge",
      triggered: Boolean(learnedMinimumEdge !== null && (!bestPick.hasValue || bestPick.edge < learnedMinimumEdge)),
      detail:
        bestPick.hasValue && learnedMinimumEdge !== null
          ? `${bestPick.label} edge is ${formatSignedPercent(bestPick.edge)} versus learned minimum ${formatSignedPercent(learnedMinimumEdge)}.`
          : learningProfile?.active
            ? `No selected pick is available after applying the learned minimum-edge gate at ${formatSignedPercent(learnedMinimumEdge ?? 0)}.`
            : "No real-data training profile is active; default minimum-edge guardrail is used."
    },
    {
      id: "case-memory-abstention",
      label: "Case memory abstention",
      triggered: caseMemory?.adjustment === "abstain",
      detail:
        caseMemory?.adjustment === "abstain"
          ? caseMemory.summary
          : caseMemory?.status === "ready"
            ? "Case memory did not find enough similar stored pressure to force abstention."
            : "Case memory is unavailable, so this gate stays neutral."
    },
    {
      id: "historical-market-prior",
      label: "Historical market-prior discipline",
      triggered: Boolean(historicalDiscipline?.cappedByMarketPrior && bestPick.hasValue),
      detail:
        historicalDiscipline?.cappedByMarketPrior && bestPick.hasValue
          ? `${bestPick.label} is capped because ${historicalDiscipline.summary}`
          : historicalDiscipline?.attached
            ? historicalDiscipline.instruction
            : "No public historical discipline evidence is attached, so this gate stays neutral."
    }
  ];
}

function liveModelRequirementDetail(match: Match, diagnostics: FootballModelDiagnostics): string {
  if (hasLiveInPlayModel(match, diagnostics)) {
    return "Live football score/minute in-play Poisson is active; refresh event data for cards, substitutions, injuries, and shot pressure before trusting the edge.";
  }
  if (match.sport === "basketball") {
    return "The match is live, but clock, possession, fouls, substitutions, pace, and lineup-adjusted projections are not connected.";
  }
  if (match.sport === "tennis") {
    return "The match is live, but set score, serve state, break points, fatigue, and retirement-risk data are not connected.";
  }
  return "The match is live, but cards, shots, substitutions, pressure, and minute-adjusted xG are not connected.";
}

function buildContradictionChecks(
  match: Match,
  diagnostics: FootballModelDiagnostics,
  bestPick: BestPickResult,
  missingSignals: string[],
  action: DecisionAction
): DecisionContradictionCheck[] {
  const probabilityDeviation = Math.abs(diagnostics.homeDrawAwayTotal - 1);
  const highConfidenceLowData = bestPick.hasValue && bestPick.confidence === "high" && diagnostics.dataQualityScore < 0.7;
  const missingCriticalContext = action === "consider" && missingSignals.length >= 3;
  const highRiskConsider = bestPick.hasValue && action === "consider" && bestPick.risk === "high";
  const liveInPlayModel = hasLiveInPlayModel(match, diagnostics);

  return [
    {
      id: "probability-normalization",
      label: "Probability normalization",
      status: probabilityDeviation <= 0.01 ? "clear" : probabilityDeviation <= 0.03 ? "watch" : "conflict",
      detail: `${match.sport === "football" ? "Home/draw/away" : "Winner"} probabilities sum to ${diagnostics.homeDrawAwayTotal.toFixed(3)}.`
    },
    {
      id: "confidence-vs-data-quality",
      label: "Confidence versus data quality",
      status: highConfidenceLowData ? "conflict" : diagnostics.dataQualityScore < 0.78 ? "watch" : "clear",
      detail: highConfidenceLowData
        ? "High confidence conflicts with low data quality."
        : `Confidence is ${bestPick.hasValue ? bestPick.confidence : "low"} with ${formatPercent(diagnostics.dataQualityScore)} data quality.`
    },
    {
      id: "recommendation-vs-missing-context",
      label: "Recommendation versus missing context",
      status: missingCriticalContext ? "watch" : "clear",
      detail: missingCriticalContext
        ? `Recommendation is live, but ${missingSignals.length} key context signals are still missing.`
        : "Missing context does not contradict the current action."
    },
    {
      id: "risk-vs-action",
      label: "Risk versus action",
      status: highRiskConsider ? "conflict" : bestPick.hasValue && bestPick.risk === "medium" ? "watch" : "clear",
      detail: bestPick.hasValue
        ? `${bestPick.label} is ${bestPick.risk} risk while action is ${action}.`
        : "No selected pick; risk/action contradiction is not present."
    },
    {
      id: "live-state-vs-model",
      label: "Live state versus model",
      status: match.status === "live" && !liveInPlayModel ? "conflict" : match.status === "live" ? "watch" : "clear",
      detail:
        match.status === "live" && !liveInPlayModel
          ? "A live fixture requires an in-play event model before consideration."
          : match.status === "live"
            ? "Live football score/minute recalibration is active, but event-feed refresh remains required."
            : "Fixture is not live, so pre-match modeling is coherent."
    }
  ];
}

function buildAgentStages(
  match: Match,
  diagnostics: FootballModelDiagnostics,
  bestPick: BestPickResult,
  missingSignals: string[],
  decisionScore: number,
  contradictionChecks: DecisionContradictionCheck[],
  abstentionRules: DecisionAbstentionRule[]
): DecisionAgentStage[] {
  const modelIntegrityScore = boundScore(100 - Math.abs(diagnostics.homeDrawAwayTotal - 1) * 1000);
  const marketScore = boundScore(bestPick.hasValue ? 54 + bestPick.edge * 520 + confidenceScore(bestPick.confidence) * 8 : 24);
  const contextScore = boundScore(diagnostics.dataQualityScore * 100 - missingSignals.length * 7);
  const riskScore = boundScore(bestPick.hasValue ? (bestPick.risk === "low" ? 82 : bestPick.risk === "medium" ? 58 : 31) : 35);
  const selfCritiqueScore = boundScore(
    86 -
      contradictionChecks.filter((check) => check.status === "conflict").length * 22 -
      contradictionChecks.filter((check) => check.status === "watch").length * 9 -
      abstentionRules.filter((rule) => rule.triggered).length * 13
  );
  const finalScore = boundScore(50 + decisionScore);
  const modelIntegrityDetail =
    diagnostics.expectedScoreLabel ??
    `Model produced ${diagnostics.expectedGoals.home.toFixed(2)}-${diagnostics.expectedGoals.away.toFixed(2)} expected ${
      diagnostics.scoreUnit ?? "goals"
    } and winner total ${diagnostics.homeDrawAwayTotal.toFixed(3)}.`;

  return [
    {
      id: "intake",
      label: "Fixture and market intake",
      status: stageStatus(contextScore),
      score: contextScore,
      detail: `${match.homeTeam.name} vs ${match.awayTeam.name}; data quality ${formatPercent(
        diagnostics.dataQualityScore
      )}; missing signals ${missingSignals.length}.`
    },
    {
      id: "model-integrity",
      label: "Model integrity check",
      status: stageStatus(modelIntegrityScore),
      score: modelIntegrityScore,
      detail: modelIntegrityDetail
    },
    {
      id: "market-edge",
      label: "Market edge search",
      status: stageStatus(marketScore),
      score: marketScore,
      detail: bestPick.hasValue
        ? `${bestPick.label} is the current best edge at ${formatSignedPercent(bestPick.edge)}.`
        : "No selection survived the value-edge search."
    },
    {
      id: "risk-gate",
      label: "Risk and variance gate",
      status: stageStatus(riskScore),
      score: riskScore,
      detail: bestPick.hasValue ? `${bestPick.label} is classified as ${bestPick.risk} risk.` : "No pick means the risk gate remains defensive."
    },
    {
      id: "self-critique",
      label: "Contradiction and abstention review",
      status: stageStatus(selfCritiqueScore),
      score: selfCritiqueScore,
      detail: `${contradictionChecks.filter((check) => check.status !== "clear").length} watch/conflict checks and ${
        abstentionRules.filter((rule) => rule.triggered).length
      } triggered abstention gates.`
    },
    {
      id: "final-arbitration",
      label: "Final arbitration",
      status: stageStatus(finalScore),
      score: finalScore,
      detail: `Weighted decision score ${decisionScore}; the agent will ${
        bestPick.hasValue ? "only surface the selection if guardrails agree" : "abstain rather than invent a pick"
      }.`
    }
  ];
}

function buildScenarioMatrix(
  decisionScore: number,
  bestPick: BestPickResult,
  diagnostics: FootballModelDiagnostics
): DecisionScenario[] {
  const edgeAfterFivePercentOddsDrop = edgeAfterOddsMultiplier(bestPick, 0.95);
  const oddsImpact = bestPick.hasValue ? (edgeAfterFivePercentOddsDrop > 0.025 ? -7 : -18) : -4;
  const dataQualityImpact = diagnostics.dataQualityScore >= 0.78 ? 3 : 12;

  const scenarios = [
    {
      id: "base-case",
      label: "Base case",
      scoreImpact: 0,
      detail: "Current model, odds, data-quality, and missing-context state."
    },
    {
      id: "odds-shortening",
      label: "Odds shorten by 5%",
      scoreImpact: oddsImpact,
      detail:
        bestPick.hasValue && edgeAfterFivePercentOddsDrop > 0
          ? `Projected edge would be ${formatSignedPercent(edgeAfterFivePercentOddsDrop)}.`
          : "A shorter price would remove or further weaken the edge."
    },
    {
      id: "adverse-team-news",
      label: "Adverse team news",
      scoreImpact: -18,
      detail: "A moderate adverse injury, suspension, or lineup shock is applied to the selected side."
    },
    {
      id: "context-upgrade",
      label: "Confirmed context supports model",
      scoreImpact: dataQualityImpact,
      detail: "Lineups, injury/suspension news, and weather arrive and support the existing model signal."
    }
  ];

  return scenarios.map((scenario) => {
    const projectedScore = decisionScore + scenario.scoreImpact;
    const projected = scoreToVerdict(projectedScore, bestPick, diagnostics);
    return {
      id: scenario.id,
      label: scenario.label,
      scoreImpact: scenario.scoreImpact,
      projectedScore,
      projectedAction: projected.action,
      detail: scenario.detail
    };
  });
}

function buildCalibration(
  decisionScore: number,
  action: DecisionAction,
  diagnostics: FootballModelDiagnostics,
  contradictionChecks: DecisionContradictionCheck[],
  abstentionRules: DecisionAbstentionRule[]
): DecisionCalibration {
  const conflicts = contradictionChecks.filter((check) => check.status === "conflict").length;
  const watches = contradictionChecks.filter((check) => check.status === "watch").length;
  const triggeredAbstentions = abstentionRules.filter((rule) => rule.triggered).length;
  const reliabilityScore = boundScore(44 + decisionScore * 0.5 + diagnostics.dataQualityScore * 32 - conflicts * 20 - watches * 8 - triggeredAbstentions * 12);
  const health: DecisionHealth = reliabilityScore >= 72 && conflicts === 0 ? "stable" : reliabilityScore >= 46 && conflicts <= 1 ? "review" : "fragile";
  const calibrationAction = action === "avoid" ? "abstain" : health === "stable" ? "trust" : "discount";

  return {
    reliabilityScore,
    health,
    action: calibrationAction,
    detail:
      calibrationAction === "trust"
        ? "Decision can be shown with normal responsible-use language, while still requiring fresh odds before action."
        : calibrationAction === "discount"
          ? "Decision has enough signal to inspect, but missing context or self-critique means confidence should be discounted."
      : "Decision should abstain or avoid until the blocking condition changes."
  };
}

function aiProtocolQuestion(input: DecisionAiProtocolQuestion): DecisionAiProtocolQuestion {
  return input;
}

function aiProtocolCheck(input: DecisionAiProtocolCheck): DecisionAiProtocolCheck {
  return input;
}

function aiProtocolToolRequest(input: DecisionAiProtocolToolRequest): DecisionAiProtocolToolRequest {
  return input;
}

function buildDecisionAiProtocol({
  match,
  bestPick,
  action,
  risk,
  oddsIntelligence,
  marketMovement,
  probabilityTrace,
  attribution,
  uncertainty,
  decisionBoundary,
  dataCoverage,
  monitoringPlan,
  actionability,
  reviewLoop,
  robustness,
  saferAlternatives,
  caseMemory,
  learningProfile,
  abstentionRules,
  historicalDiscipline
}: {
  match: Match;
  bestPick: BestPickResult;
  action: DecisionAction;
  risk: RiskLevel;
  oddsIntelligence: DecisionOddsIntelligence;
  marketMovement: DecisionMarketMovement;
  probabilityTrace: DecisionProbabilityTrace;
  attribution: DecisionAttribution;
  uncertainty: DecisionUncertaintyDecomposition;
  decisionBoundary: DecisionBoundary;
  dataCoverage: DecisionDataCoverageAudit;
  monitoringPlan: DecisionMonitoringPlan;
  actionability: DecisionActionabilityAudit;
  reviewLoop: DecisionReviewLoop;
  robustness: DecisionRobustnessAudit;
  saferAlternatives: SaferAlternative[];
  caseMemory: DecisionCaseMemory;
  learningProfile?: DecisionLearningProfile;
  abstentionRules: DecisionAbstentionRule[];
  historicalDiscipline: DecisionHistoricalDiscipline;
}): DecisionAiProtocol {
  const hasPick = bestPick.hasValue;
  const selectedLabel = hasPick ? bestPick.label : "No clear value found";
  const triggeredAbstentions = abstentionRules.filter((rule) => rule.triggered);
  const historicalAuditStatus: DecisionAiProtocolCheck["status"] =
    historicalDiscipline.trustEffect === "cap-raw-edge" || historicalDiscipline.trustEffect === "block"
      ? "fail"
      : historicalDiscipline.trustEffect === "queue-provider-retest"
        ? "watch"
        : "pass";
  const evidenceRefs = [
    {
      id: "probability-trace-summary",
      label: "Probability trace",
      source: "probability-trace",
      claim: probabilityTrace.summary
    },
    {
      id: "odds-intelligence-summary",
      label: "Odds intelligence",
      source: "odds-intelligence",
      claim: oddsIntelligence.summary
    },
    {
      id: "market-movement-summary",
      label: "Market movement",
      source: "market-movement",
      claim: marketMovement.summary
    },
    {
      id: "attribution-summary",
      label: "Decision attribution",
      source: "decision-attribution",
      claim: attribution.summary
    },
    {
      id: "uncertainty-summary",
      label: "Uncertainty decomposition",
      source: "uncertainty-decomposition",
      claim: uncertainty.summary
    },
    {
      id: "decision-boundary-summary",
      label: "Decision boundary",
      source: "decision-boundary",
      claim: decisionBoundary.summary
    },
    {
      id: "data-coverage-summary",
      label: "Data coverage",
      source: "data-coverage",
      claim: dataCoverage.summary
    },
    {
      id: "robustness-summary",
      label: "Robustness stress test",
      source: "robustness",
      claim: robustness.summary
    },
    {
      id: "review-loop-summary",
      label: "Review loop",
      source: "review-loop",
      claim: reviewLoop.summary
    },
    {
      id: "historical-discipline-summary",
      label: "Historical discipline",
      source: "historical-discipline",
      claim: `${historicalDiscipline.summary} ${historicalDiscipline.instruction}`
    }
  ];

  const questions = [
    aiProtocolQuestion({
      id: "value-question",
      prompt: "Is there a measurable model-vs-market value edge?",
      status: hasPick ? "answered" : "blocked",
      answer: hasPick
        ? `${selectedLabel} has model probability ${formatPercent(bestPick.modelProbability)}, no-vig probability ${formatPercent(
            bestPick.noVigImpliedProbability
          )}, edge ${formatSignedPercent(bestPick.edge)}, and EV ${formatSignedPercent(bestPick.expectedValue)}.`
        : "No selection cleared positive edge and positive expected value.",
      evidenceIds: ["probability-trace-summary", "odds-intelligence-summary"],
      followUp: hasPick ? "Refresh bookmaker odds before public display." : "Wait for a better price or stronger model-market disagreement."
    }),
    aiProtocolQuestion({
      id: "price-question",
      prompt: "Can the current price survive normal market movement?",
      status: marketMovement.status === "resilient" ? "answered" : marketMovement.status === "no-market" ? "blocked" : "needs-data",
      answer: marketMovement.summary,
      evidenceIds: ["market-movement-summary", "decision-boundary-summary"],
      followUp: marketMovement.nextAction
    }),
    aiProtocolQuestion({
      id: "boundary-question",
      prompt: "What would flip this action?",
      status: decisionBoundary.status === "blocked" ? "blocked" : decisionBoundary.status === "comfortable" ? "answered" : "needs-data",
      answer: decisionBoundary.nearestFlip,
      evidenceIds: ["decision-boundary-summary"],
      followUp: decisionBoundary.nextAction
    }),
    aiProtocolQuestion({
      id: "data-question",
      prompt: "Which data gaps could change the thesis?",
      status: dataCoverage.requiredBeforeTrust.length ? "needs-data" : "answered",
      answer: dataCoverage.requiredBeforeTrust[0] ?? "No required-before-trust provider gap is currently open.",
      evidenceIds: ["data-coverage-summary", "uncertainty-summary"],
      followUp: dataCoverage.requiredBeforeTrust[0] ?? "Keep fixtures, odds, context, and live signals fresh."
    }),
    aiProtocolQuestion({
      id: "risk-question",
      prompt: "Do risk, actionability, or review checks block the decision?",
      status: actionability.status === "blocked" || reviewLoop.status === "blocked" ? "blocked" : actionability.status === "watch-only" ? "needs-data" : "answered",
      answer: `${actionability.summary} ${reviewLoop.summary}`,
      evidenceIds: ["attribution-summary", "uncertainty-summary", "review-loop-summary"],
      followUp: reviewLoop.releaseCriteria[0] ?? actionability.requiredBeforeAction[0] ?? "Keep the lower-risk action if checks disagree."
    }),
    aiProtocolQuestion({
      id: "historical-discipline-question",
      prompt: "Does historical backtest discipline allow this decision to be promoted?",
      status:
        historicalAuditStatus === "fail"
          ? "blocked"
          : historicalAuditStatus === "watch"
            ? "needs-data"
            : "answered",
      answer: `${historicalDiscipline.summary} ${historicalDiscipline.instruction}`,
      evidenceIds: ["historical-discipline-summary"],
      followUp:
        historicalAuditStatus === "pass"
          ? "Keep historical discipline attached to the audit trail."
          : historicalDiscipline.requiredBeforePromotion[0] ?? historicalDiscipline.instruction
    }),
    aiProtocolQuestion({
      id: "alternative-question",
      prompt: "Is there a safer alternative if the main pick is fragile?",
      status: saferAlternatives.length ? "answered" : "needs-data",
      answer: saferAlternatives[0]
        ? `${saferAlternatives[0].market}: ${saferAlternatives[0].selection} at model ${formatPercent(saferAlternatives[0].modelProbability)}.`
        : "No safer alternative is available in the current market snapshot.",
      evidenceIds: ["odds-intelligence-summary", "robustness-summary"],
      followUp: saferAlternatives[0]?.rationale ?? "Fetch a broader market snapshot before offering an alternative."
    })
  ];

  const checks = [
    aiProtocolCheck({
      id: "math-audit",
      label: "Probability and EV math",
      status: hasPick && probabilityTrace.status === "ready" ? "pass" : hasPick ? "watch" : "fail",
      detail: hasPick ? probabilityTrace.summary : "No priced candidate exists for probability and EV audit.",
      evidenceIds: ["probability-trace-summary", "odds-intelligence-summary"]
    }),
    aiProtocolCheck({
      id: "market-audit",
      label: "Market and price audit",
      status: marketMovement.status === "resilient" ? "pass" : marketMovement.status === "no-market" ? "fail" : "watch",
      detail: marketMovement.summary,
      evidenceIds: ["market-movement-summary"]
    }),
    aiProtocolCheck({
      id: "data-audit",
      label: "Provider data audit",
      status: dataCoverage.status === "provider-backed" ? "pass" : dataCoverage.status === "insufficient" ? "fail" : "watch",
      detail: dataCoverage.summary,
      evidenceIds: ["data-coverage-summary"]
    }),
    aiProtocolCheck({
      id: "uncertainty-audit",
      label: "Uncertainty audit",
      status: uncertainty.status === "controlled" ? "pass" : uncertainty.status === "high-risk" ? "fail" : "watch",
      detail: uncertainty.summary,
      evidenceIds: ["uncertainty-summary"]
    }),
    aiProtocolCheck({
      id: "boundary-audit",
      label: "Decision-boundary audit",
      status: decisionBoundary.status === "comfortable" || decisionBoundary.status === "at-risk" ? "pass" : decisionBoundary.status === "near-flip" ? "watch" : "fail",
      detail: decisionBoundary.summary,
      evidenceIds: ["decision-boundary-summary"]
    }),
    aiProtocolCheck({
      id: "guardrail-audit",
      label: "Actionability and abstention audit",
      status: triggeredAbstentions.length || actionability.status === "blocked" || reviewLoop.status === "blocked" ? "fail" : actionability.status === "watch-only" ? "watch" : "pass",
      detail: triggeredAbstentions[0]?.detail ?? `${actionability.summary} ${reviewLoop.summary}`,
      evidenceIds: ["review-loop-summary", "attribution-summary"]
    }),
    aiProtocolCheck({
      id: "learning-audit",
      label: "Learning and memory audit",
      status: learningProfile?.active && caseMemory.status === "ready" ? "pass" : caseMemory.adjustment === "abstain" ? "fail" : "watch",
      detail: `${learningProfile?.reason ?? "No active historical learning profile."} ${caseMemory.summary}`,
      evidenceIds: ["data-coverage-summary"]
    }),
    aiProtocolCheck({
      id: "historical-discipline-audit",
      label: "Historical discipline audit",
      status: historicalAuditStatus,
      detail: `${historicalDiscipline.summary} ${historicalDiscipline.instruction}`,
      evidenceIds: ["historical-discipline-summary"]
    })
  ];

  const toolRequests = [
    aiProtocolToolRequest({
      id: "fresh-odds",
      label: "Refresh bookmaker odds",
      priority: hasPick ? "critical" : "high",
      status: marketMovement.status === "no-market" ? "missing" : "ready",
      provider: "Bookmaker odds provider",
      reason: marketMovement.nextAction,
      unlocks: "Recalculates implied probability, no-vig edge, EV, boundary margins, and closing-line-value target."
    }),
    aiProtocolToolRequest({
      id: "context-feed",
      label: "Fetch lineups, injuries, suspensions, and news",
      priority: dataCoverage.requiredBeforeTrust.length || uncertainty.status !== "controlled" ? "high" : "medium",
      status: dataCoverage.requiredBeforeTrust.length ? "missing" : "ready",
      provider: "Sport-specific context providers",
      reason: dataCoverage.requiredBeforeTrust[0] ?? "Context signals are currently clear enough for this decision.",
      unlocks: "Reduces data/context uncertainty and reruns the actionability and review-loop gates."
    }),
    aiProtocolToolRequest({
      id: "live-state",
      label: "Fetch live score and match events",
      priority: match.status === "live" ? "critical" : "medium",
      status: match.status === "live" && dataCoverage.signals.some((signal) => signal.category === "live-scores" && signal.status === "missing") ? "missing" : "ready",
      provider: "Live score and event provider",
      reason: match.status === "live" ? "Live state can invalidate pre-match probability and edge." : "Keep ready for in-play rechecks.",
      unlocks: "Updates live-state model inputs and hard in-play abstention gates."
    }),
    aiProtocolToolRequest({
      id: "historical-learning",
      label: "Load historical training profile",
      priority: learningProfile?.active ? "low" : "medium",
      status: learningProfile?.active ? "ready" : "missing",
      provider: "Supabase training corpus",
      reason: learningProfile?.reason ?? "No active real-data learning profile is available.",
      unlocks: "Tunes learned minimum edge, data-quality weight, market-adjustment weight, and calibration thresholds."
    }),
    aiProtocolToolRequest({
      id: "historical-discipline",
      label: "Run historical discipline retest",
      priority:
        historicalDiscipline.trustEffect === "cap-raw-edge" || historicalDiscipline.trustEffect === "block"
          ? "critical"
          : historicalDiscipline.trustEffect === "queue-provider-retest"
            ? "high"
            : "medium",
      status:
        historicalDiscipline.trustEffect === "cap-raw-edge" || historicalDiscipline.trustEffect === "block"
          ? "blocked"
          : historicalDiscipline.trustEffect === "queue-provider-retest"
            ? "missing"
            : "ready",
      provider: historicalDiscipline.source ?? "Historical backtest corpus",
      reason: historicalDiscipline.requiredBeforePromotion[0] ?? historicalDiscipline.instruction,
      unlocks: "Confirms whether provider-enriched historical results beat market consensus before any raw edge can be promoted."
    }),
    aiProtocolToolRequest({
      id: "openai-reviewer",
      label: "Run guarded AI reviewer",
      priority: action === "consider" ? "high" : "medium",
      status: "ready",
      provider: "OpenAI Responses API",
      reason: "The deterministic evidence packet and public protocol are ready for an external AI audit when OPENAI_API_KEY is configured.",
      unlocks: "Adds a cited second-opinion audit that can agree, downgrade, abstain, or require more data, without upgrading weak local decisions."
    })
  ];

  const failingChecks = checks.filter((check) => check.status === "fail");
  const watchChecks = checks.filter((check) => check.status === "watch");
  const missingTools = toolRequests.filter((tool) => tool.status === "missing");
  const status: DecisionAiProtocol["status"] =
    action === "avoid" || failingChecks.length || decisionBoundary.status === "blocked" ? "blocked" : watchChecks.length || missingTools.length ? "needs-data" : "ready";
  const answeredQuestions = questions.filter((question) => question.status === "answered").length;

  return {
    status,
    mode: "deterministic-public-audit",
    objective: `Decide whether ${match.homeTeam.name} vs ${match.awayTeam.name} can show ${selectedLabel} as a responsible value candidate.`,
    summary:
      status === "ready"
        ? `AI protocol is ready: ${answeredQuestions}/${questions.length} questions answered, ${checks.length - watchChecks.length - failingChecks.length}/${checks.length} checks passing, and ${missingTools.length} missing tool request(s).`
        : status === "needs-data"
          ? `AI protocol needs data: ${answeredQuestions}/${questions.length} questions answered, ${watchChecks.length} watch check(s), and ${missingTools.length} missing tool request(s).`
          : `AI protocol is blocked: ${failingChecks.length} failed check(s), ${triggeredAbstentions.length} triggered abstention gate(s), and current action ${action}.`,
    questions,
    checks,
    evidenceRefs,
    toolRequests,
    guardrails: [
      "Use only supplied evidence IDs and model artifacts.",
      "Do not invent injuries, lineups, weather, news, odds, scores, or private facts.",
      "Do not expose hidden chain-of-thought; return public audit notes only.",
      "Do not upgrade a local avoid or monitor action into a stronger recommendation.",
      "Downgrade or abstain when safety gates, boundary breaches, or unsupported material claims remain."
    ],
    reviewerInstructions:
      `Review ${selectedLabel} for ${match.homeTeam.name} vs ${match.awayTeam.name}. Cite supplied evidence IDs, audit probability/EV math, data gaps, market movement, decision boundary, uncertainty, actionability, and robustness. Return agree, downgrade, abstain, or needs-data only.`
  };
}

function reasoningNode(input: Omit<DecisionReasoningNode, "strength"> & { strength: number }): DecisionReasoningNode {
  return {
    ...input,
    strength: boundScore(input.strength)
  };
}

function reasoningEdge(input: DecisionReasoningEdge): DecisionReasoningEdge {
  return input;
}

function nodeStatusFromCheck(status: DecisionAiProtocolCheck["status"]): DecisionReasoningNodeStatus {
  if (status === "pass") return "supporting";
  if (status === "watch") return "watch";
  return "blocking";
}

function buildDecisionReasoningGraph({
  match,
  bestPick,
  action,
  decisionScore,
  probabilityTrace,
  oddsIntelligence,
  marketMovement,
  dataCoverage,
  attribution,
  uncertainty,
  decisionBoundary,
  actionability,
  reviewLoop,
  robustness,
  aiProtocol,
  caseMemory,
  historicalDiscipline
}: {
  match: Match;
  bestPick: BestPickResult;
  action: DecisionAction;
  decisionScore: number;
  probabilityTrace: DecisionProbabilityTrace;
  oddsIntelligence: DecisionOddsIntelligence;
  marketMovement: DecisionMarketMovement;
  dataCoverage: DecisionDataCoverageAudit;
  attribution: DecisionAttribution;
  uncertainty: DecisionUncertaintyDecomposition;
  decisionBoundary: DecisionBoundary;
  actionability: DecisionActionabilityAudit;
  reviewLoop: DecisionReviewLoop;
  robustness: DecisionRobustnessAudit;
  aiProtocol: DecisionAiProtocol;
  caseMemory: DecisionCaseMemory;
  historicalDiscipline: DecisionHistoricalDiscipline;
}): DecisionReasoningGraph {
  const selectedLabel = bestPick.hasValue ? bestPick.label : "No clear value found";
  const mathCheck = aiProtocol.checks.find((check) => check.id === "math-audit");
  const marketCheck = aiProtocol.checks.find((check) => check.id === "market-audit");
  const dataCheck = aiProtocol.checks.find((check) => check.id === "data-audit");
  const uncertaintyCheck = aiProtocol.checks.find((check) => check.id === "uncertainty-audit");
  const boundaryCheck = aiProtocol.checks.find((check) => check.id === "boundary-audit");
  const guardrailCheck = aiProtocol.checks.find((check) => check.id === "guardrail-audit");
  const learningCheck = aiProtocol.checks.find((check) => check.id === "learning-audit");
  const historicalCheck = aiProtocol.checks.find((check) => check.id === "historical-discipline-audit");
  const missingToolCount = aiProtocol.toolRequests.filter((tool) => tool.status === "missing").length;
  const actionStatus: DecisionReasoningNodeStatus = action === "avoid" ? "blocking" : action === "monitor" ? "watch" : "supporting";

  const nodes = [
    reasoningNode({
      id: "objective",
      type: "objective",
      label: "Decision objective",
      status: "neutral",
      strength: 100,
      detail: aiProtocol.objective,
      evidenceIds: []
    }),
    reasoningNode({
      id: "model-probability",
      type: "model",
      label: "Model probability",
      status: nodeStatusFromCheck(mathCheck?.status ?? "fail"),
      strength: bestPick.hasValue ? Math.round(bestPick.modelProbability * 100) : 0,
      detail: probabilityTrace.summary,
      evidenceIds: ["probability-trace-summary"]
    }),
    reasoningNode({
      id: "market-value",
      type: "market",
      label: "Market value",
      status: nodeStatusFromCheck(marketCheck?.status ?? "fail"),
      strength: bestPick.hasValue ? Math.round(Math.max(0, bestPick.edge + bestPick.expectedValue) * 240) : 0,
      detail: oddsIntelligence.summary,
      evidenceIds: ["odds-intelligence-summary", "market-movement-summary"]
    }),
    reasoningNode({
      id: "data-coverage",
      type: "data",
      label: "Data coverage",
      status: nodeStatusFromCheck(dataCheck?.status ?? "fail"),
      strength: dataCoverage.score,
      detail: dataCoverage.summary,
      evidenceIds: ["data-coverage-summary"]
    }),
    reasoningNode({
      id: "uncertainty",
      type: "uncertainty",
      label: "Uncertainty budget",
      status: nodeStatusFromCheck(uncertaintyCheck?.status ?? "fail"),
      strength: 100 - uncertainty.score,
      detail: uncertainty.summary,
      evidenceIds: ["uncertainty-summary"]
    }),
    reasoningNode({
      id: "boundary",
      type: "boundary",
      label: "Decision boundary",
      status: nodeStatusFromCheck(boundaryCheck?.status ?? "fail"),
      strength: decisionBoundary.status === "comfortable" ? 92 : decisionBoundary.status === "at-risk" ? 70 : decisionBoundary.status === "near-flip" ? 45 : 8,
      detail: decisionBoundary.summary,
      evidenceIds: ["decision-boundary-summary"]
    }),
    reasoningNode({
      id: "attribution",
      type: "review",
      label: "Decision attribution",
      status: attribution.status === "supportive" ? "supporting" : attribution.status === "mixed" ? "watch" : "blocking",
      strength: attribution.status === "blocked" ? 10 : Math.max(0, attribution.valueScore - Math.round(attribution.riskScore / 2)),
      detail: attribution.summary,
      evidenceIds: ["attribution-summary"]
    }),
    reasoningNode({
      id: "actionability",
      type: "risk",
      label: "Actionability guardrail",
      status: nodeStatusFromCheck(guardrailCheck?.status ?? "fail"),
      strength: actionability.score,
      detail: actionability.summary,
      evidenceIds: ["review-loop-summary", "attribution-summary"]
    }),
    reasoningNode({
      id: "robustness",
      type: "review",
      label: "Robustness stress test",
      status: robustness.status === "robust" ? "supporting" : robustness.status === "sensitive" ? "watch" : "blocking",
      strength: robustness.score,
      detail: robustness.summary,
      evidenceIds: ["robustness-summary"]
    }),
    reasoningNode({
      id: "learning-memory",
      type: "review",
      label: "Learning and memory",
      status: nodeStatusFromCheck(learningCheck?.status ?? "watch"),
      strength: caseMemory.status === "ready" ? 70 : caseMemory.adjustment === "abstain" ? 5 : 35,
      detail: caseMemory.summary,
      evidenceIds: ["data-coverage-summary"]
    }),
    reasoningNode({
      id: "historical-discipline",
      type: "risk",
      label: "Historical discipline",
      status: nodeStatusFromCheck(historicalCheck?.status ?? "watch"),
      strength:
        historicalDiscipline.trustEffect === "cap-raw-edge" || historicalDiscipline.trustEffect === "block"
          ? 8
          : historicalDiscipline.trustEffect === "queue-provider-retest"
            ? 44
            : historicalDiscipline.attached
              ? 72
              : 58,
      detail: `${historicalDiscipline.summary} ${historicalDiscipline.instruction}`,
      evidenceIds: ["historical-discipline-summary"]
    }),
    reasoningNode({
      id: "tool-requests",
      type: "tool",
      label: "Tool and data requests",
      status: missingToolCount ? "watch" : "supporting",
      strength: 100 - missingToolCount * 18,
      detail: missingToolCount
        ? `${missingToolCount} missing tool/data request(s): ${aiProtocol.toolRequests
            .filter((tool) => tool.status === "missing")
            .map((tool) => tool.label)
            .join(", ")}.`
        : "No missing tool request blocks the current protocol.",
      evidenceIds: ["ai-protocol-summary"]
    }),
    reasoningNode({
      id: "final-action",
      type: "action",
      label: `Final action: ${action}`,
      status: actionStatus,
      strength: action === "consider" ? decisionScore : action === "monitor" ? Math.min(70, decisionScore) : Math.min(25, decisionScore),
      detail: `${selectedLabel}; decision score ${decisionScore}/100; review loop ${reviewLoop.status}.`,
      evidenceIds: ["review-loop-summary", "decision-boundary-summary"]
    })
  ];

  const edges = [
    reasoningEdge({
      id: "objective-to-model",
      from: "objective",
      to: "model-probability",
      relation: "requires",
      weight: 0.16,
      detail: "The objective needs model probability before value can be priced."
    }),
    reasoningEdge({
      id: "model-to-market",
      from: "model-probability",
      to: "market-value",
      relation: bestPick.hasValue ? "supports" : "blocks",
      weight: 0.18,
      detail: bestPick.hasValue ? `${selectedLabel} clears model-vs-market comparison.` : "No model-market value candidate cleared the filter."
    }),
    reasoningEdge({
      id: "market-to-boundary",
      from: "market-value",
      to: "boundary",
      relation: decisionBoundary.status === "blocked" ? "blocks" : decisionBoundary.status === "near-flip" ? "challenges" : "supports",
      weight: 0.14,
      detail: decisionBoundary.nearestFlip
    }),
    reasoningEdge({
      id: "data-to-uncertainty",
      from: "data-coverage",
      to: "uncertainty",
      relation: dataCoverage.requiredBeforeTrust.length ? "challenges" : "supports",
      weight: 0.14,
      detail: dataCoverage.requiredBeforeTrust[0] ?? "Data coverage does not add a blocking provider gap."
    }),
    reasoningEdge({
      id: "uncertainty-to-actionability",
      from: "uncertainty",
      to: "actionability",
      relation: uncertainty.status === "high-risk" ? "blocks" : uncertainty.status === "watchlist" ? "challenges" : "supports",
      weight: 0.12,
      detail: uncertainty.decisionImpact
    }),
    reasoningEdge({
      id: "boundary-to-actionability",
      from: "boundary",
      to: "actionability",
      relation: decisionBoundary.status === "blocked" ? "blocks" : decisionBoundary.status === "near-flip" ? "challenges" : "supports",
      weight: 0.12,
      detail: decisionBoundary.nextAction
    }),
    reasoningEdge({
      id: "attribution-to-actionability",
      from: "attribution",
      to: "actionability",
      relation: attribution.status === "blocked" ? "blocks" : attribution.status === "mixed" ? "challenges" : "supports",
      weight: 0.1,
      detail: attribution.decisiveFactor
    }),
    reasoningEdge({
      id: "historical-discipline-to-actionability",
      from: "historical-discipline",
      to: "actionability",
      relation:
        historicalDiscipline.trustEffect === "cap-raw-edge" || historicalDiscipline.trustEffect === "block"
          ? "blocks"
          : historicalDiscipline.trustEffect === "queue-provider-retest"
            ? "requires"
            : "supports",
      weight: 0.14,
      detail: historicalDiscipline.instruction
    }),
    reasoningEdge({
      id: "robustness-to-review",
      from: "robustness",
      to: "final-action",
      relation: robustness.status === "fragile" ? "blocks" : robustness.status === "sensitive" ? "challenges" : "supports",
      weight: 0.1,
      detail: robustness.summary
    }),
    reasoningEdge({
      id: "tools-to-review",
      from: "tool-requests",
      to: "final-action",
      relation: missingToolCount ? "requires" : "supports",
      weight: 0.08,
      detail: aiProtocol.toolRequests.find((tool) => tool.status === "missing")?.reason ?? "Tool plan is ready for AI review."
    }),
    reasoningEdge({
      id: "actionability-to-final",
      from: "actionability",
      to: "final-action",
      relation: actionability.status === "blocked" ? "blocks" : actionability.status === "watch-only" ? "challenges" : "supports",
      weight: 0.2,
      detail: actionability.summary
    })
  ];

  const supportingNodes = nodes.filter((node) => node.status === "supporting").map((node) => node.id);
  const blockingNodes = nodes.filter((node) => node.status === "blocking").map((node) => node.id);
  const unresolvedNodes = nodes.filter((node) => node.status === "watch").map((node) => node.id);
  const prioritizedBlockingNodes = blockingNodes.includes("historical-discipline")
    ? ["historical-discipline", ...blockingNodes.filter((id) => id !== "historical-discipline")]
    : blockingNodes;
  const status: DecisionReasoningGraph["status"] =
    action === "avoid" || blockingNodes.length || edges.some((edge) => edge.relation === "blocks") ? "blocked" : unresolvedNodes.length ? "contested" : "coherent";
  const strongestPath = ["objective", ...supportingNodes.filter((id) => id !== "objective" && id !== "final-action").slice(0, 5), "final-action"];
  const blockingPath = prioritizedBlockingNodes.length
    ? ["objective", ...prioritizedBlockingNodes.filter((id) => id !== "objective" && id !== "final-action").slice(0, 5), "final-action"]
    : unresolvedNodes.length
      ? ["objective", ...unresolvedNodes.slice(0, 5), "final-action"]
      : [];

  return {
    status,
    summary:
      status === "coherent"
        ? `Reasoning graph is coherent: ${supportingNodes.length} supporting node(s), ${unresolvedNodes.length} watch node(s), and no blockers.`
        : status === "contested"
          ? `Reasoning graph is contested: ${supportingNodes.length} supporting node(s), ${unresolvedNodes.length} watch node(s), and ${blockingNodes.length} blocker node(s).`
          : `Reasoning graph is blocked: ${blockingNodes.length} blocker node(s), ${unresolvedNodes.length} watch node(s), and final action ${action}.`,
    entryNodeId: "objective",
    decisionNodeId: "final-action",
    nodes,
    edges,
    strongestPath,
    blockingPath,
    unresolvedNodes
  };
}

function toolTask(input: DecisionToolTask): DecisionToolTask {
  return input;
}

function toolPriorityWeight(priority: DecisionMonitoringPriority): number {
  if (priority === "critical") return 4;
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function toolStatusScore(status: DecisionToolTaskStatus): number {
  if (status === "ready" || status === "complete") return 1;
  if (status === "waiting") return 0.55;
  if (status === "missing-config") return 0.12;
  return 0;
}

function toolStatusRank(status: DecisionToolTaskStatus): number {
  if (status === "blocked") return 0;
  if (status === "missing-config") return 1;
  if (status === "waiting") return 2;
  if (status === "ready") return 3;
  return 4;
}

function statusForCoverageSignal(
  signal: DecisionDataCoverageSignal | undefined,
  options: { requireProvider?: boolean; mockIsReady?: boolean; waitingWhenNotApplicable?: boolean } = {}
): DecisionToolTaskStatus {
  if (!signal) return "missing-config";
  if (signal.status === "not-applicable") return options.waitingWhenNotApplicable ? "waiting" : "complete";
  if (signal.status === "missing" || signal.status === "stale") return "missing-config";
  if (signal.status === "mock") {
    return options.mockIsReady && !options.requireProvider ? "ready" : "missing-config";
  }
  if (options.requireProvider && signal.status !== "provider-backed") return "missing-config";
  return "ready";
}

function combineToolStatuses(statuses: DecisionToolTaskStatus[]): DecisionToolTaskStatus {
  if (!statuses.length) return "missing-config";
  if (statuses.some((status) => status === "blocked")) return "blocked";
  if (statuses.some((status) => status === "missing-config")) return "missing-config";
  if (statuses.some((status) => status === "waiting")) return "waiting";
  if (statuses.some((status) => status === "ready")) return "ready";
  return "complete";
}

function signalGapSummary(signals: Array<DecisionDataCoverageSignal | undefined>, fallback: string): string {
  const gaps = signals
    .filter((signal): signal is DecisionDataCoverageSignal => Boolean(signal))
    .filter((signal) => signal.status === "missing" || signal.status === "stale" || signal.status === "mock")
    .map((signal) => `${signal.label}: ${signal.detail}`);
  return gaps.length ? gaps.slice(0, 2).join(" ") : fallback;
}

function buildDecisionToolOrchestrationPlan({
  match,
  bestPick,
  action,
  aiProtocol,
  dataCoverage,
  marketMovement,
  decisionBoundary,
  uncertainty,
  reasoningGraph,
  learningProfile,
  caseMemory,
  historicalDiscipline
}: {
  match: Match;
  bestPick: BestPickResult;
  action: DecisionAction;
  aiProtocol: DecisionAiProtocol;
  dataCoverage: DecisionDataCoverageAudit;
  marketMovement: DecisionMarketMovement;
  decisionBoundary: DecisionBoundary;
  uncertainty: DecisionUncertaintyDecomposition;
  reasoningGraph: DecisionReasoningGraph;
  learningProfile?: DecisionLearningProfile;
  caseMemory: DecisionCaseMemory;
  historicalDiscipline: DecisionHistoricalDiscipline;
}): DecisionToolOrchestrationPlan {
  const signal = (id: string) => dataCoverage.signals.find((item) => item.id === id);
  const toolRequest = (id: string) => aiProtocol.toolRequests.find((item) => item.id === id);
  const fixturesSignal = signal("fixtures");
  const historicalSignal = signal("historical-results");
  const standingsSignal = signal("league-standings");
  const homeAwaySignal = signal("home-away-performance");
  const formSignal = signal("recent-form");
  const injuriesSignal = signal("injuries");
  const suspensionsSignal = signal("suspensions");
  const lineupsSignal = signal("lineups");
  const oddsSignal = signal("odds");
  const liveScoresSignal = signal("live-scores");
  const matchEventsSignal = signal("match-events");
  const newsSignal = signal("news");
  const weatherSignal = signal("weather");
  const trainingSignal = signal("historical-training");
  const oddsRequest = toolRequest("fresh-odds");
  const contextRequest = toolRequest("context-feed");
  const liveRequest = toolRequest("live-state");
  const learningRequest = toolRequest("historical-learning");
  const historicalDisciplineRequest = toolRequest("historical-discipline");
  const openAiRequest = toolRequest("openai-reviewer");
  const contextSignals = [injuriesSignal, suspensionsSignal, lineupsSignal, newsSignal];
  const contextStatus = combineToolStatuses(contextSignals.map((item) => statusForCoverageSignal(item, { requireProvider: true })));
  const liveStatus =
    match.status === "live"
      ? combineToolStatuses([
          statusForCoverageSignal(liveScoresSignal, { requireProvider: true }),
          statusForCoverageSignal(matchEventsSignal, { requireProvider: true })
        ])
      : "waiting";
  const weatherStatus =
    match.sport === "basketball"
      ? "complete"
      : statusForCoverageSignal(weatherSignal, {
          requireProvider: true
        });
  const memoryStatus: DecisionToolTaskStatus =
    caseMemory.status === "ready" || caseMemory.status === "no-memory"
      ? "ready"
      : caseMemory.status === "failed"
        ? "blocked"
        : "missing-config";
  const openAiStatus: DecisionToolTaskStatus = openAiRequest?.status === "blocked" ? "blocked" : "ready";
  const selectedLabel = bestPick.hasValue ? bestPick.label : "No priced value candidate";
  const tasks = [
    toolTask({
      id: "fixtures-today",
      category: "fixtures",
      label: "Load today's fixture",
      priority: "critical",
      status: statusForCoverageSignal(fixturesSignal, { mockIsReady: true }),
      provider: fixturesSignal?.source ?? "Fixture provider",
      dependsOn: [],
      freshnessMinutes: 30,
      reason: fixturesSignal?.detail ?? "A fixture is required before model, market, and context decisions can run.",
      unlocks: "Creates the match shell for model probability, odds matching, context lookup, and persistence.",
      decisionImpact: "Without the fixture, the decision stays avoid and every downstream task is blocked."
    }),
    toolTask({
      id: "historical-results",
      category: "historical-results",
      label: "Load team/player historical results",
      priority: "high",
      status: statusForCoverageSignal(historicalSignal, { requireProvider: true }),
      provider: historicalSignal?.source ?? "Sports history provider",
      dependsOn: ["fixtures-today"],
      freshnessMinutes: null,
      reason: historicalSignal?.detail ?? "Historical results are needed for ratings, form, and model calibration.",
      unlocks: "Feeds team/player strength, long-run form, and the 10-year training corpus.",
      decisionImpact: "Weak history keeps model strength, form weighting, and learned thresholds conservative."
    }),
    toolTask({
      id: "standings-table",
      category: "standings",
      label: "Load league standings",
      priority: match.sport === "football" ? "high" : "medium",
      status: statusForCoverageSignal(standingsSignal, { requireProvider: true }),
      provider: standingsSignal?.source ?? "Standings provider",
      dependsOn: ["fixtures-today", "historical-results"],
      freshnessMinutes: 360,
      reason: standingsSignal?.detail ?? "League table context is needed for strength sanity checks and motivation notes.",
      unlocks: "Adds table position, league strength cross-checks, and motivation risk notes.",
      decisionImpact: "Missing standings lower data quality and increase context uncertainty."
    }),
    toolTask({
      id: "recent-form-home-away",
      category: "recent-form",
      label: "Compute recent form and home/away profile",
      priority: "high",
      status: combineToolStatuses([
        statusForCoverageSignal(formSignal, { mockIsReady: true }),
        statusForCoverageSignal(homeAwaySignal, { mockIsReady: true })
      ]),
      provider: `${formSignal?.source ?? "Form provider"} + ${homeAwaySignal?.source ?? "model feature builder"}`,
      dependsOn: ["fixtures-today", "historical-results"],
      freshnessMinutes: 180,
      reason: signalGapSummary([formSignal, homeAwaySignal], "Recent form and home/away features are ready for this model run."),
      unlocks: "Updates Elo/team strength, home advantage, recent form weighting, and pace/efficiency adjustments where relevant.",
      decisionImpact: "If form or home/away inputs change, the model probability and value edge are recalculated."
    }),
    toolTask({
      id: "context-availability",
      category: "injuries",
      label: "Fetch injuries, suspensions, lineups, and news",
      priority: contextRequest?.priority ?? (dataCoverage.requiredBeforeTrust.length ? "high" : "medium"),
      status: contextStatus,
      provider: contextRequest?.provider ?? "Sport-specific context providers",
      dependsOn: ["fixtures-today"],
      freshnessMinutes: 15,
      reason: contextRequest?.reason ?? signalGapSummary(contextSignals, "Context signals are current enough for this run."),
      unlocks: contextRequest?.unlocks ?? "Adjusts injury/news factors, lineup confidence, uncertainty, and actionability gates.",
      decisionImpact: "Material team news can downgrade or flip the action before kickoff."
    }),
    toolTask({
      id: "odds-refresh",
      category: "odds",
      label: "Refresh bookmaker odds and no-vig probabilities",
      priority: oddsRequest?.priority ?? (bestPick.hasValue ? "critical" : "high"),
      status:
        oddsRequest?.status === "blocked" || marketMovement.status === "no-market"
          ? "missing-config"
          : statusForCoverageSignal(oddsSignal, { requireProvider: true }),
      provider: oddsRequest?.provider ?? oddsSignal?.source ?? "Bookmaker odds provider",
      dependsOn: ["fixtures-today"],
      freshnessMinutes: 5,
      reason: oddsRequest?.reason ?? marketMovement.nextAction,
      unlocks: oddsRequest?.unlocks ?? "Recalculates implied probability, no-vig margin removal, EV, value edge, and price movement.",
      decisionImpact: "A price move can erase the edge, change the safer alternative, or move the pick to avoid."
    }),
    toolTask({
      id: "live-state-events",
      category: "live-scores",
      label: "Fetch live score and match events",
      priority: liveRequest?.priority ?? (match.status === "live" ? "critical" : "medium"),
      status: liveStatus,
      provider: liveRequest?.provider ?? "Live score and event provider",
      dependsOn: ["fixtures-today", "odds-refresh"],
      freshnessMinutes: 1,
      reason:
        match.status === "live"
          ? liveRequest?.reason ?? signalGapSummary([liveScoresSignal, matchEventsSignal], "Live state is current for this run.")
          : "Wait until kickoff or in-play mode before live score and event polling becomes active.",
      unlocks: liveRequest?.unlocks ?? "Updates in-play probability, red-card/injury state, and hard live abstention gates.",
      decisionImpact: "Live goals, cards, retirements, or tempo shocks can invalidate pre-match value."
    }),
    toolTask({
      id: "weather-context",
      category: "weather",
      label: "Fetch weather where relevant",
      priority: match.sport === "football" || match.sport === "tennis" ? "medium" : "low",
      status: weatherStatus,
      provider: weatherSignal?.source ?? "Weather provider",
      dependsOn: ["fixtures-today"],
      freshnessMinutes: match.sport === "basketball" ? null : 60,
      reason: weatherSignal?.detail ?? "Weather can affect outdoor football totals, tennis conditions, and tempo assumptions.",
      unlocks: "Adjusts weather-sensitive totals, tempo, fatigue, and uncertainty notes.",
      decisionImpact: "Severe weather can move totals, BTTS, fatigue, or model uncertainty."
    }),
    toolTask({
      id: "historical-training",
      category: "training",
      label: "Load 10-year training and backtest profile",
      priority: learningRequest?.priority ?? "medium",
      status: learningProfile?.active ? "ready" : statusForCoverageSignal(trainingSignal, { requireProvider: true }),
      provider: learningRequest?.provider ?? trainingSignal?.source ?? "Supabase training corpus",
      dependsOn: ["historical-results", "odds-refresh"],
      freshnessMinutes: null,
      reason: learningRequest?.reason ?? learningProfile?.reason ?? "No active real-data learning profile is available.",
      unlocks: learningRequest?.unlocks ?? "Tunes learned minimum edge, calibration weights, market adjustment, and backtest thresholds.",
      decisionImpact: "Without real backtests, the engine keeps conservative default thresholds and cannot claim learned calibration."
    }),
    toolTask({
      id: "historical-discipline",
      category: "training",
      label: "Enforce historical discipline",
      priority: historicalDisciplineRequest?.priority ?? (historicalDiscipline.attached ? "high" : "medium"),
      status:
        historicalDiscipline.trustEffect === "cap-raw-edge" || historicalDiscipline.trustEffect === "block"
          ? "blocked"
          : historicalDiscipline.trustEffect === "queue-provider-retest"
            ? "waiting"
            : historicalDiscipline.attached
              ? "ready"
              : "waiting",
      provider: historicalDisciplineRequest?.provider ?? historicalDiscipline.source ?? "Historical backtest corpus",
      dependsOn: ["historical-training", "odds-refresh"],
      freshnessMinutes: null,
      reason: historicalDisciplineRequest?.reason ?? historicalDiscipline.requiredBeforePromotion[0] ?? historicalDiscipline.instruction,
      unlocks:
        historicalDisciplineRequest?.unlocks ??
        "Controls whether public historical evidence can support, cap, or block model-vs-market promotion.",
      decisionImpact:
        historicalDiscipline.trustEffect === "cap-raw-edge"
          ? "Historical discipline blocks raw positive-EV promotion until provider-enriched retests beat the market prior."
          : historicalDiscipline.trustEffect === "queue-provider-retest"
            ? "Historical discipline keeps the decision on watch until provider-enriched retests are complete."
            : "Historical discipline stays attached as audit context without promoting the model."
    }),
    toolTask({
      id: "decision-memory",
      category: "memory",
      label: "Query stored decision memory",
      priority: action === "consider" ? "high" : "medium",
      status: memoryStatus,
      provider: caseMemory.configured ? "Supabase op_decision_runs" : "Supabase decision memory",
      dependsOn: ["fixtures-today", "historical-training"],
      freshnessMinutes: null,
      reason: caseMemory.summary,
      unlocks: "Compares similar previous decisions, reliability, and post-settlement outcomes before final trust.",
      decisionImpact:
        caseMemory.adjustment === "abstain"
          ? "Case memory can force abstention when similar decisions were unreliable."
          : "Case memory can discount or support confidence once enough comparable decisions exist."
    }),
    toolTask({
      id: "openai-review",
      category: "ai-review",
      label: "Run guarded AI reviewer",
      priority: openAiRequest?.priority ?? (action === "consider" ? "high" : "medium"),
      status: openAiStatus,
      provider: openAiRequest?.provider ?? "OpenAI Responses API",
      dependsOn: ["odds-refresh", "context-availability", "decision-memory"],
      freshnessMinutes: null,
      reason: openAiRequest?.reason ?? "The deterministic evidence packet can be reviewed once OPENAI_API_KEY is configured.",
      unlocks: openAiRequest?.unlocks ?? "Adds a cited second-opinion audit with no-upgrade guardrails.",
      decisionImpact: "The reviewer may agree, downgrade, abstain, or request more data, but cannot promote a weak local decision."
    })
  ];
  const weightedTotal = tasks.reduce((sum, task) => sum + toolPriorityWeight(task.priority), 0);
  const weightedReady = tasks.reduce((sum, task) => sum + toolPriorityWeight(task.priority) * toolStatusScore(task.status), 0);
  const readinessScore = weightedTotal ? boundScore(Math.round((weightedReady / weightedTotal) * 100)) : 0;
  const incompleteTasks = tasks
    .filter((task) => task.status !== "ready" && task.status !== "complete")
    .sort((a, b) => toolPriorityWeight(b.priority) - toolPriorityWeight(a.priority) || toolStatusRank(a.status) - toolStatusRank(b.status));
  const blockedHighPriority = tasks.filter((task) => task.status === "blocked" && (task.priority === "critical" || task.priority === "high"));
  const blockingTasks = tasks
    .filter((task) => (task.status === "blocked" || task.status === "missing-config") && (task.priority === "critical" || task.priority === "high"))
    .map((task) => task.id);
  const readyTasks = tasks.filter((task) => task.status === "ready" || task.status === "complete").map((task) => task.id);
  const nextTaskId = incompleteTasks[0]?.id ?? tasks.find((task) => task.priority === "critical" && task.status === "ready")?.id ?? null;
  const readyFreshness = tasks
    .filter((task) => (task.status === "ready" || task.status === "waiting") && task.freshnessMinutes !== null)
    .map((task) => task.freshnessMinutes as number);
  const staleAfterMinutes = readyFreshness.length ? Math.min(...readyFreshness) : null;
  const status: DecisionToolOrchestrationPlan["status"] = blockedHighPriority.length
    ? "blocked"
    : incompleteTasks.length || reasoningGraph.unresolvedNodes.length
      ? "needs-tools"
      : "ready";
  const readyCount = readyTasks.length;
  const nextTask = tasks.find((task) => task.id === nextTaskId);

  return {
    status,
    readinessScore,
    nextTaskId,
    tasks,
    executionOrder: tasks.map((task) => task.id),
    blockingTasks,
    readyTasks,
    staleAfterMinutes,
    summary:
      status === "ready"
        ? `Tool orchestration is ready: ${readyCount}/${tasks.length} task(s) ready for ${selectedLabel}, with freshness checked every ${
            staleAfterMinutes ?? "N/A"
          } minute(s).`
        : status === "needs-tools"
          ? `Tool orchestration needs tools: ${readyCount}/${tasks.length} task(s) ready, ${blockingTasks.length} high-priority config gap(s), next task ${
              nextTask?.label ?? "none"
            }, readiness ${readinessScore}/100.`
          : `Tool orchestration is blocked: ${blockedHighPriority.map((task) => task.label).join(", ")} must be repaired before ${action} can be trusted.`
  };
}

function toolAttemptStatus(task: DecisionToolTask, aiProtocol: DecisionAiProtocol): DecisionToolExecutionAttemptStatus {
  if (task.status === "blocked" || task.status === "missing-config") return "blocked";
  if (task.status === "waiting") return "waiting";
  if (task.id === "openai-review" && aiProtocol.status !== "reviewed") return "skipped";
  return "executed";
}

function toolObservedRecords({
  task,
  match,
  learningProfile,
  caseMemory
}: {
  task: DecisionToolTask;
  match: Match;
  learningProfile?: DecisionLearningProfile;
  caseMemory: DecisionCaseMemory;
}): number | null {
  const contextSignals = match.providerContextSignals ?? [];
  if (task.id === "fixtures-today") return 1;
  if (task.id === "historical-results") return match.homeForm.recentResults.length + match.awayForm.recentResults.length;
  if (task.id === "standings-table") return contextSignals.filter((signal) => signal.category === "standings").length;
  if (task.id === "recent-form-home-away") return match.homeForm.recentResults.length + match.awayForm.recentResults.length + 2;
  if (task.id === "context-availability") {
    return contextSignals.filter((signal) => signal.category === "injury" || signal.category === "suspension" || signal.category === "lineup" || signal.category === "news").length;
  }
  if (task.id === "odds-refresh") return match.oddsMarkets.reduce((sum, market) => sum + market.selections.length, 0);
  if (task.id === "live-state-events") {
    return (match.score ? 1 : 0) + contextSignals.filter((signal) => signal.category === "live-event").length;
  }
  if (task.id === "weather-context") return contextSignals.filter((signal) => signal.category === "weather").length;
  if (task.id === "historical-training") return learningProfile?.sampleSize ?? 0;
  if (task.id === "historical-discipline") return learningProfile?.sampleSize ?? 0;
  if (task.id === "decision-memory") return caseMemory.sampleSize;
  if (task.id === "openai-review") return null;
  return null;
}

function toolOutputSignals(task: DecisionToolTask, match: Match): string[] {
  if (task.id === "fixtures-today") return ["fixture", "kickoff", "teams", "league"];
  if (task.id === "historical-results") return ["team-history", "player-history", "long-form"];
  if (task.id === "standings-table") return ["league-standings", "motivation-context"];
  if (task.id === "recent-form-home-away") return ["recent-form", "home-away-profile", "team-strength"];
  if (task.id === "context-availability") {
    return ["injuries", "suspensions", match.sport === "tennis" ? "player-availability" : "lineups", "news"];
  }
  if (task.id === "odds-refresh") return ["raw-implied-probability", "no-vig-probability", "expected-value", "value-edge"];
  if (task.id === "live-state-events") return ["live-score", "match-events", "in-play-state"];
  if (task.id === "weather-context") return match.sport === "basketball" ? ["not-applicable"] : ["weather", "wind-rain-temperature"];
  if (task.id === "historical-training") return ["backtest-profile", "learned-thresholds", "calibration"];
  if (task.id === "historical-discipline") return ["historical-discipline", "market-prior-benchmark", "provider-retest-requirements"];
  if (task.id === "decision-memory") return ["similar-decisions", "reliability-memory"];
  if (task.id === "openai-review") return ["cited-ai-audit", "safety-gates", "unsupported-claims"];
  return [task.category];
}

function toolExecutionDetail(status: DecisionToolExecutionAttemptStatus, task: DecisionToolTask, observedRecords: number | null): string {
  if (status === "executed") {
    return observedRecords === null
      ? `${task.label} executed from ${task.provider}.`
      : `${task.label} executed from ${task.provider} with ${observedRecords} observed record(s).`;
  }
  if (status === "waiting") return `${task.label} is waiting: ${task.reason}`;
  if (status === "skipped") return `${task.label} was skipped for this deterministic run: request agent=1 and configure the provider to run it.`;
  return `${task.label} is blocked: ${task.reason}`;
}

function buildDecisionToolExecutionAudit({
  match,
  action,
  aiProtocol,
  toolOrchestration,
  learningProfile,
  caseMemory
}: {
  match: Match;
  action: DecisionAction;
  aiProtocol: DecisionAiProtocol;
  toolOrchestration: DecisionToolOrchestrationPlan;
  learningProfile?: DecisionLearningProfile;
  caseMemory: DecisionCaseMemory;
}): DecisionToolExecutionAudit {
  const generatedAt = new Date().toISOString();
  const attempts: DecisionToolExecutionAttempt[] = toolOrchestration.tasks.map((task) => {
    const status = toolAttemptStatus(task, aiProtocol);
    const observedRecords = toolObservedRecords({ task, match, learningProfile, caseMemory });
    return {
      id: `attempt-${task.id}`,
      taskId: task.id,
      label: task.label,
      category: task.category,
      status,
      provider: task.provider,
      priority: task.priority,
      observedRecords,
      outputSignals: toolOutputSignals(task, match),
      startedAt: generatedAt,
      completedAt: status === "executed" ? generatedAt : null,
      detail: toolExecutionDetail(status, task, observedRecords),
      decisionDelta:
        status === "executed"
          ? task.decisionImpact
          : status === "skipped"
            ? "No AI-review delta was applied in this deterministic run."
            : "No decision delta was applied because the task did not execute.",
      nextAction:
        status === "executed"
          ? task.freshnessMinutes
            ? `Refresh within ${task.freshnessMinutes} minute(s).`
            : "Keep this artifact available for the next rerun."
          : task.reason
    };
  });
  const executedTasks = attempts.filter((attempt) => attempt.status === "executed").length;
  const blockedTasks = attempts.filter((attempt) => attempt.status === "blocked").length;
  const waitingTasks = attempts.filter((attempt) => attempt.status === "waiting").length;
  const skippedTasks = attempts.filter((attempt) => attempt.status === "skipped").length;
  const highPriorityBlocked = attempts.filter((attempt) => attempt.status === "blocked" && (attempt.priority === "critical" || attempt.priority === "high"));
  const firstIncomplete = attempts.find((attempt) => attempt.status !== "executed");
  const status: DecisionToolExecutionAudit["status"] = highPriorityBlocked.length ? "blocked" : blockedTasks || waitingTasks || skippedTasks ? "partial" : "complete";

  return {
    status,
    mode: aiProtocol.status === "reviewed" ? "openai-reviewed" : "deterministic-local-audit",
    generatedAt,
    totalTasks: attempts.length,
    executedTasks,
    blockedTasks,
    waitingTasks,
    skippedTasks,
    attempts,
    nextRun: firstIncomplete
      ? `${firstIncomplete.label}: ${firstIncomplete.nextAction}`
      : action === "consider"
        ? "All local tool tasks executed; refresh odds and context before public display."
        : "All local tool tasks executed; rerun when odds, context, or match state changes.",
    publicLog: attempts
      .slice(0, 8)
      .map((attempt) => `${attempt.label}: ${attempt.status}; ${attempt.detail}`),
    summary:
      status === "complete"
        ? `Tool execution audit completed all ${attempts.length} task(s); local artifacts are ready for the current decision.`
        : status === "partial"
          ? `Tool execution audit is partial: ${executedTasks}/${attempts.length} task(s) executed, ${waitingTasks} waiting, ${skippedTasks} skipped, and ${blockedTasks} blocked.`
          : `Tool execution audit is blocked: ${highPriorityBlocked
              .map((attempt) => attempt.label)
              .join(", ")} must run before the current decision can be trusted.`
  };
}

function controlGate(input: DecisionControlGate): DecisionControlGate {
  return input;
}

function controlStatusFromBoolean(blocked: boolean, watch: boolean): DecisionControlGateStatus {
  if (blocked) return "block";
  if (watch) return "watch";
  return "pass";
}

function buildDecisionControlPolicy({
  bestPick,
  action,
  actionability,
  reviewLoop,
  decisionBoundary,
  aiProtocol,
  reasoningGraph,
  toolOrchestration,
  toolExecution,
  dataCoverage,
  marketMovement,
  robustness,
  uncertainty,
  historicalDiscipline
}: {
  bestPick: BestPickResult;
  action: DecisionAction;
  actionability: DecisionActionabilityAudit;
  reviewLoop: DecisionReviewLoop;
  decisionBoundary: DecisionBoundary;
  aiProtocol: DecisionAiProtocol;
  reasoningGraph: DecisionReasoningGraph;
  toolOrchestration: DecisionToolOrchestrationPlan;
  toolExecution: DecisionToolExecutionAudit;
  dataCoverage: DecisionDataCoverageAudit;
  marketMovement: DecisionMarketMovement;
  robustness: DecisionRobustnessAudit;
  uncertainty: DecisionUncertaintyDecomposition;
  historicalDiscipline: DecisionHistoricalDiscipline;
}): DecisionControlPolicy {
  const historicalControlStatus: DecisionControlGateStatus =
    historicalDiscipline.trustEffect === "cap-raw-edge" || historicalDiscipline.trustEffect === "block"
      ? "block"
      : historicalDiscipline.trustEffect === "queue-provider-retest"
        ? "watch"
        : "pass";
  const gates = [
    controlGate({
      id: "value-selection",
      label: "Value selection",
      source: "model",
      status: controlStatusFromBoolean(!bestPick.hasValue || action === "avoid", action === "monitor"),
      detail: bestPick.hasValue
        ? `${bestPick.label} is the current selected market with edge ${formatSignedPercent(bestPick.edge)} and EV ${formatSignedPercent(bestPick.expectedValue)}.`
        : "No selection cleared the value and expected-value filters.",
      requiredAction: bestPick.hasValue ? null : "Wait for a stronger model-market edge before publishing a candidate."
    }),
    controlGate({
      id: "market-state",
      label: "Market state",
      source: "market",
      status: controlStatusFromBoolean(marketMovement.status === "no-market" || marketMovement.status === "fragile", marketMovement.status === "sensitive"),
      detail: marketMovement.summary,
      requiredAction: marketMovement.status === "resilient" ? null : marketMovement.nextAction
    }),
    controlGate({
      id: "data-coverage",
      label: "Data coverage",
      source: "data",
      status: controlStatusFromBoolean(dataCoverage.status === "insufficient", dataCoverage.status !== "provider-backed"),
      detail: dataCoverage.summary,
      requiredAction: dataCoverage.requiredBeforeTrust[0] ?? null
    }),
    controlGate({
      id: "tool-execution",
      label: "Tool execution",
      source: "tools",
      status: controlStatusFromBoolean(toolExecution.status === "blocked", toolExecution.status === "partial" || toolOrchestration.status !== "ready"),
      detail: `${toolExecution.summary} ${toolOrchestration.summary}`,
      requiredAction: toolExecution.status === "complete" && toolOrchestration.status === "ready" ? null : toolExecution.nextRun
    }),
    controlGate({
      id: "decision-boundary",
      label: "Decision boundary",
      source: "risk",
      status: controlStatusFromBoolean(decisionBoundary.status === "blocked", decisionBoundary.status === "near-flip" || decisionBoundary.status === "at-risk"),
      detail: decisionBoundary.summary,
      requiredAction: decisionBoundary.status === "comfortable" ? null : decisionBoundary.nextAction
    }),
    controlGate({
      id: "historical-discipline",
      label: "Historical discipline",
      source: "risk",
      status: historicalControlStatus,
      detail: `${historicalDiscipline.summary} ${historicalDiscipline.instruction}`,
      requiredAction:
        historicalControlStatus === "pass"
          ? null
          : historicalDiscipline.requiredBeforePromotion[0] ?? historicalDiscipline.instruction
    }),
    controlGate({
      id: "ai-review",
      label: "AI review",
      source: "ai-review",
      status: controlStatusFromBoolean(aiProtocol.status === "blocked", aiProtocol.status === "needs-data"),
      detail: aiProtocol.summary,
      requiredAction:
        aiProtocol.status === "reviewed" || aiProtocol.status === "ready"
          ? null
          : aiProtocol.toolRequests.find((tool) => tool.status === "missing")?.reason ?? aiProtocol.reviewerInstructions
    }),
    controlGate({
      id: "reasoning-graph",
      label: "Reasoning graph",
      source: "operator",
      status: controlStatusFromBoolean(reasoningGraph.status === "blocked", reasoningGraph.status === "contested"),
      detail: reasoningGraph.summary,
      requiredAction: reasoningGraph.unresolvedNodes[0] ?? reasoningGraph.blockingPath[1] ?? null
    }),
    controlGate({
      id: "actionability",
      label: "Actionability",
      source: "operator",
      status: controlStatusFromBoolean(actionability.status === "blocked", actionability.status === "watch-only"),
      detail: actionability.summary,
      requiredAction: actionability.requiredBeforeAction[0] ?? actionability.blockers[0] ?? null
    }),
    controlGate({
      id: "review-loop",
      label: "Review loop",
      source: "operator",
      status: controlStatusFromBoolean(reviewLoop.status === "blocked", reviewLoop.status === "downgraded" || reviewLoop.status === "repaired"),
      detail: reviewLoop.summary,
      requiredAction: reviewLoop.releaseCriteria[0] ?? reviewLoop.unresolvedIssues[0] ?? null
    }),
    controlGate({
      id: "robustness",
      label: "Robustness",
      source: "risk",
      status: controlStatusFromBoolean(robustness.status === "fragile" || uncertainty.status === "high-risk", robustness.status === "sensitive" || uncertainty.status === "watchlist"),
      detail: `${robustness.summary} ${uncertainty.summary}`,
      requiredAction: robustness.requiredRechecks[0] ?? uncertainty.mitigations[0] ?? null
    })
  ];
  const blockingGates = gates.filter((gate) => gate.status === "block");
  const watchGates = gates.filter((gate) => gate.status === "watch");
  const primaryBlocker = blockingGates[0] ?? watchGates[0] ?? null;
  const needsRerun =
    toolExecution.status !== "complete" ||
    toolOrchestration.status !== "ready" ||
    aiProtocol.status === "needs-data" ||
    decisionBoundary.status === "near-flip" ||
    decisionBoundary.status === "at-risk" ||
    reasoningGraph.status === "contested";
  const status: DecisionControlPolicy["status"] = blockingGates.length
    ? "blocked"
    : needsRerun
      ? "needs-rerun"
      : action === "monitor" || actionability.status === "watch-only"
        ? "monitor-only"
        : "publishable";
  const visibility: DecisionControlPolicy["visibility"] =
    status === "publishable" ? "public-candidate" : status === "blocked" ? "internal-only" : "watchlist-only";
  const publishAllowed = status === "publishable";
  const safeToDisplay = visibility !== "internal-only";
  const automationMode: DecisionControlPolicy["automationMode"] =
    status === "publishable" ? "auto-monitor" : status === "blocked" ? "blocked" : "operator-review";
  const fixtureContextLoaded = toolExecution.attempts.some((attempt) => attempt.taskId === "fixtures-today" && attempt.status === "executed");
  const persistAllowed = fixtureContextLoaded && safeToDisplay;
  const aiReviewRequired = status !== "blocked" && aiProtocol.status !== "reviewed";
  const allowedActions =
    status === "publishable"
      ? ["show public value candidate", "persist decision run", "schedule monitoring", "request guarded AI reviewer"]
      : status === "monitor-only"
        ? ["show watchlist analysis", "persist decision run", "schedule monitoring", "request guarded AI reviewer"]
        : status === "needs-rerun"
          ? ["refresh blocking tools", "run guarded AI reviewer", "persist audit trail", "keep watchlist internal until rerun"]
          : ["persist blocked audit only", "collect required data", "rerun the decision engine"];
  const forbiddenActions =
    status === "publishable"
      ? ["guarantee outcome", "hide uncertainty", "skip odds refresh"]
      : status === "monitor-only"
        ? ["show as strong value", "claim final recommendation", "skip required rechecks"]
        : status === "needs-rerun"
          ? ["publish as value candidate", "ignore missing tool output", "raise confidence without rerun"]
          : ["publish as value candidate", "show as actionable", "upgrade by AI review", "invent missing data"];
  const releaseCriteria = Array.from(
    new Set(
      [
        ...gates.map((gate) => gate.requiredAction).filter((item): item is string => Boolean(item)),
        ...actionability.requiredBeforeAction,
        ...reviewLoop.releaseCriteria,
        ...decisionBoundary.requiredToStayConsider
      ].slice(0, 10)
    )
  );
  const primaryDirective =
    status === "publishable"
      ? "Show as an inspectable value candidate with monitoring and responsible-use warnings."
      : status === "monitor-only"
        ? "Keep on the public watchlist only; do not present as actionable value."
        : status === "needs-rerun"
          ? "Run the next required tool and rerun the decision before publishing."
          : "Block public display and collect the required evidence first.";
  const nextBestAction = primaryBlocker?.requiredAction ?? toolExecution.nextRun;

  return {
    status,
    visibility,
    automationMode,
    publishAllowed,
    persistAllowed,
    aiReviewRequired,
    rerunRequired: status === "needs-rerun" || status === "blocked",
    safeToDisplay,
    primaryBlockerId: primaryBlocker?.id ?? null,
    summary:
      status === "publishable"
        ? `Control policy is publishable: ${gates.length - watchGates.length}/${gates.length} gates pass and no blocker owns the decision.`
        : status === "monitor-only"
          ? `Control policy is monitor-only: ${watchGates.length} watch gate(s) remain, but no hard blocker owns the decision.`
          : status === "needs-rerun"
            ? `Control policy needs rerun: ${watchGates.length} watch gate(s), next action ${nextBestAction}.`
            : `Control policy blocks public display: ${blockingGates.length} blocker gate(s), primary blocker ${primaryBlocker?.label ?? "unknown"}.`,
    primaryDirective,
    nextBestAction,
    gates,
    allowedActions,
    forbiddenActions,
    releaseCriteria
  };
}

function deliberationConfidence(score: number, fallback: ConfidenceLevel): ConfidenceLevel {
  if (score >= 44) return "high";
  if (score >= 18) return "medium";
  return fallback;
}

function evidenceHighlights(evidence: DecisionEvidence[], impact: DecisionEvidence["impact"], limit: number): string[] {
  return evidence
    .filter((item) => item.impact === impact || (impact === "negative" && item.impact === "unknown"))
    .map((item) => `${item.label}: ${item.detail}`)
    .slice(0, limit);
}

function watchPriority(label: string): "high" | "medium" | "low" {
  const normalized = label.toLowerCase();
  if (normalized.includes("lineup") || normalized.includes("injur") || normalized.includes("suspension") || normalized.includes("live")) {
    return "high";
  }
  if (normalized.includes("weather") || normalized.includes("rest") || normalized.includes("odds")) return "medium";
  return "low";
}

function watchSignalType(label: string): DecisionDeliberation["watchItems"][number]["signalType"] {
  const normalized = label.toLowerCase();
  if (normalized.includes("lineup")) return "lineups";
  if (normalized.includes("injur") || normalized.includes("suspension") || normalized.includes("news") || normalized.includes("rest")) return "team-news";
  if (normalized.includes("weather")) return "weather";
  if (normalized.includes("live")) return "live-state";
  if (normalized.includes("training") || normalized.includes("backtest")) return "training";
  if (normalized.includes("odds") || normalized.includes("price")) return "odds";
  return "data-quality";
}

function buildDeliberation({
  match,
  bestPick,
  valueEdges,
  evidence,
  missingSignals,
  contradictionChecks,
  scenarioMatrix,
  sensitivityChecks,
  abstentionRules,
  decisionScore,
  action,
  calibration,
  learningProfile,
  caseMemory
}: {
  match: Match;
  bestPick: BestPickResult;
  valueEdges: ValueEdge[];
  evidence: DecisionEvidence[];
  missingSignals: string[];
  contradictionChecks: DecisionContradictionCheck[];
  scenarioMatrix: DecisionScenario[];
  sensitivityChecks: DecisionSensitivityCheck[];
  abstentionRules: DecisionAbstentionRule[];
  decisionScore: number;
  action: DecisionAction;
  calibration: DecisionCalibration;
  learningProfile?: DecisionLearningProfile;
  caseMemory?: DecisionCaseMemory;
}): DecisionDeliberation {
  const strongestEdges = [...valueEdges].sort((a, b) => b.expectedValue - a.expectedValue).slice(0, 3);
  const support = evidenceHighlights(evidence, "positive", 3);
  const challenge = [
    ...evidenceHighlights(evidence, "negative", 2),
    ...contradictionChecks.filter((check) => check.status !== "clear").map((check) => `${check.label}: ${check.detail}`).slice(0, 2),
    ...abstentionRules.filter((rule) => rule.triggered).map((rule) => `${rule.label}: ${rule.detail}`).slice(0, 2)
  ].slice(0, 4);
  const baseScenario = scenarioMatrix.find((scenario) => scenario.id === "base-case");
  const adverseScenario = scenarioMatrix.find((scenario) => scenario.id === "adverse-team-news");
  const oddsScenario = scenarioMatrix.find((scenario) => scenario.id === "odds-shortening");
  const contextScenario = scenarioMatrix.find((scenario) => scenario.id === "context-upgrade");
  const primaryThesis = bestPick.hasValue
    ? `${bestPick.label} is the leading thesis because the model price beats the no-vig market by ${formatSignedPercent(
        bestPick.edge
      )} with ${formatSignedPercent(bestPick.expectedValue)} EV per unit.`
    : `No market is currently a thesis worth recommending for ${match.homeTeam.name} vs ${match.awayTeam.name}.`;
  const dissentingThesis = bestPick.hasValue
    ? `The market may be pricing context the MVP cannot fully see yet, especially ${missingSignals.slice(0, 3).join(", ") || "late odds and team news"}.`
    : "The dissenting view is that better odds or provider-backed context may create value later, so the engine should keep monitoring.";
  const synthesis =
    action === "consider"
      ? `${calibration.health} decision: surface ${bestPick.hasValue ? bestPick.label : "the current lean"} as inspectable value, but require fresh odds and context checks before action.`
      : action === "monitor"
        ? `${calibration.health} decision: keep this on the watchlist because the thesis is plausible but not strong enough for a clear recommendation.`
        : `${calibration.health} decision: abstain now; the guardrails or missing data make a public recommendation weaker than the risk.`;

  const watchItems: DecisionDeliberation["watchItems"] = ([
    ...missingSignals.slice(0, 4).map((label, index) => ({
      id: `missing-${index + 1}`,
      label,
      priority: watchPriority(label),
      signalType: watchSignalType(label),
      whyItMatters: "This missing signal can move the probability estimate or downgrade confidence before kickoff.",
      actionIfConfirmed: "Refresh the model, rerun the no-vig EV calculation, and re-check abstention gates."
    })),
    {
      id: "odds-refresh",
      label: "Fresh bookmaker price",
      priority: "high",
      signalType: "odds",
      whyItMatters: bestPick.hasValue
        ? `A shorter price can erase the ${formatSignedPercent(bestPick.edge)} edge and ${formatSignedPercent(bestPick.expectedValue)} EV.`
        : "A better price is required before any selection can become positive EV.",
      actionIfConfirmed: "Recalculate implied probability, bookmaker margin, no-vig probability, value edge, and EV."
    },
    {
      id: "training-profile",
      label: "Historical learning profile",
      priority: learningProfile?.active ? "low" : "medium",
      signalType: "training",
      whyItMatters: learningProfile?.active
        ? "Real-data backtests are already contributing to live guardrails."
        : "Without enough real historical fixtures and odds, thresholds stay conservative defaults.",
      actionIfConfirmed: learningProfile?.active
        ? "Keep using learned edge thresholds while monitoring calibration drift."
        : "Import real fixtures and odds, run backtests, then activate learned thresholds only after the corpus is large enough."
    },
    {
      id: "case-memory",
      label: "Similar stored decisions",
      priority: caseMemory?.adjustment === "abstain" || caseMemory?.adjustment === "discount" ? "high" : "medium",
      signalType: "training",
      whyItMatters:
        caseMemory?.status === "ready"
          ? caseMemory.summary
          : "Stored decision memory is not available, so the engine cannot compare this case against previous recommendations yet.",
      actionIfConfirmed:
        caseMemory?.adjustment === "abstain"
          ? "Force abstention unless the underlying comparable-case data is stale or irrelevant."
          : caseMemory?.adjustment === "discount"
            ? "Discount confidence and require stronger fresh odds/context confirmation."
            : "Keep memory neutral while continuing to store and settle outcomes."
    }
  ] satisfies DecisionDeliberation["watchItems"]).slice(0, 7);

  return {
    primaryThesis,
    dissentingThesis,
    synthesis,
    hypotheses: [
      {
        id: "primary-value-thesis",
        label: bestPick.hasValue ? `Value thesis: ${bestPick.label}` : "Value thesis",
        status: bestPick.hasValue ? (action === "avoid" ? "contested" : "supported") : "rejected",
        confidence: bestPick.hasValue ? bestPick.confidence : "low",
        detail: bestPick.hasValue
          ? `${bestPick.label} carries model probability ${formatPercent(bestPick.modelProbability)}, no-vig implied ${formatPercent(
              bestPick.noVigImpliedProbability
            )}, odds ${formatOdds(bestPick.odds)}, and EV ${formatSignedPercent(bestPick.expectedValue)}.`
          : "The engine found no positive-EV selection with acceptable confidence.",
        support: support.length ? support : strongestEdges.map((edge) => `${edge.label}: ${formatSignedPercent(edge.expectedValue)} EV`),
        challenge: challenge.length ? challenge : ["No live provider-backed lineups, injuries, weather, or odds movement checks are connected yet."],
        decisionImpact:
          action === "consider"
            ? "Supports showing the pick as inspectable value."
            : action === "monitor"
              ? "Supports watchlist only."
              : "Does not survive guardrails as a public recommendation."
      },
      {
        id: "market-counter-thesis",
        label: "Counter-thesis: market may know more",
        status: bestPick.hasValue && bestPick.edge >= 0.08 && bestPick.expectedValue >= 0.08 ? "contested" : "needs-data",
        confidence: deliberationConfidence(decisionScore, "medium"),
        detail: bestPick.hasValue
          ? `The selection still depends on a live bookmaker price. Market movement scenario projects ${
              oddsScenario ? `${oddsScenario.projectedAction} at score ${oddsScenario.projectedScore}` : "a required review"
            }.`
          : "Without a positive edge, market prices are currently stronger than the model signal.",
        support: sensitivityChecks.map((check) => `${check.label}: ${check.detail}`).slice(0, 3),
        challenge: strongestEdges.map((edge) => `${edge.label}: edge ${formatSignedPercent(edge.edge)}, EV ${formatSignedPercent(edge.expectedValue)}`),
        decisionImpact: "Requires odds refresh before the recommendation can be trusted."
      },
      {
        id: "context-risk-thesis",
        label: "Context-risk thesis",
        status: missingSignals.length ? "needs-data" : "supported",
        confidence: missingSignals.length >= 4 ? "medium" : "high",
        detail: missingSignals.length
          ? `${missingSignals.length} missing context signals remain, led by ${missingSignals.slice(0, 3).join(", ")}.`
          : "Available context signals do not add a blocking data gap.",
        support: contextScenario ? [`${contextScenario.label}: ${contextScenario.detail}`] : ["Context improvement would be reviewed if provider data arrives."],
        challenge: adverseScenario ? [`${adverseScenario.label}: ${adverseScenario.detail}`] : ["Adverse context could still downgrade the decision."],
        decisionImpact: "Controls whether the engine considers, monitors, or abstains after late provider data arrives."
      },
      {
        id: "final-arbitration-thesis",
        label: "Final arbitration",
        status: action === "consider" ? "supported" : action === "monitor" ? "contested" : "rejected",
        confidence: calibration.health === "stable" ? "high" : calibration.health === "review" ? "medium" : "low",
        detail: `${baseScenario?.label ?? "Base case"} decision score is ${decisionScore}; calibration says ${calibration.action} with ${calibration.reliabilityScore}/100 reliability.`,
        support: [`Decision action: ${action}.`, `Calibration health: ${calibration.health}.`],
        challenge: abstentionRules
          .filter((rule) => rule.triggered)
          .map((rule) => `${rule.label}: ${rule.detail}`)
          .slice(0, 3),
        decisionImpact: synthesis
      },
      {
        id: "case-memory-thesis",
        label: "Case-memory thesis",
        status:
          caseMemory?.status !== "ready"
            ? "needs-data"
            : caseMemory.adjustment === "none"
              ? "supported"
              : caseMemory.adjustment === "discount"
                ? "contested"
                : "rejected",
        confidence:
          caseMemory?.status === "ready" && (caseMemory.similarCases.length >= 5 || (caseMemory.averageSimilarity ?? 0) >= 0.72)
            ? "high"
            : caseMemory?.status === "ready"
              ? "medium"
              : "low",
        detail: caseMemory?.summary ?? "No stored decision memory was loaded.",
        support: caseMemory?.similarCases.slice(0, 3).map((item) => `${item.fixtureExternalId}: ${item.action}, similarity ${formatPercent(item.similarity)}`) ?? [],
        challenge: caseMemory?.notes ?? ["Case-memory comparison needs stored decisions and settled outcomes."],
        decisionImpact:
          caseMemory?.adjustment === "abstain"
            ? "Memory would force abstention."
            : caseMemory?.adjustment === "discount"
              ? "Memory discounts confidence."
              : "Memory stays neutral."
      }
    ],
    watchItems,
    decisionIfMissingDataTurnsBad:
      action === "avoid"
        ? "Remain avoid unless new evidence removes the active guardrail."
        : "Downgrade to monitor or avoid if adverse lineup, injury, weather, live-state, or data-quality signals oppose the selected side.",
    decisionIfMarketMoves: bestPick.hasValue
      ? `Recalculate immediately; if the no-vig edge falls below zero or EV turns negative, remove ${bestPick.label} from value picks.`
      : "Keep avoiding until a new market price creates a positive no-vig edge and positive EV."
  };
}

function decisionActionRank(action: DecisionAction): number {
  if (action === "consider") return 2;
  if (action === "monitor") return 1;
  return 0;
}

function committeeStance(vote: DecisionAction, finalAction: DecisionAction): DecisionCommitteeMember["stance"] {
  if (vote === finalAction) return vote === "avoid" ? "abstain" : "support";
  return decisionActionRank(vote) < decisionActionRank(finalAction) ? "challenge" : "neutral";
}

function committeeRisk(vote: DecisionAction, fallback: RiskLevel): RiskLevel {
  if (vote === "avoid") return "high";
  if (vote === "monitor") return fallback === "high" ? "high" : "medium";
  return fallback;
}

function committeeConsensus(voteCounts: DecisionCommittee["voteCounts"], finalAction: DecisionAction): DecisionCommittee["consensus"] {
  const votes = Object.values(voteCounts);
  const total = votes.reduce((sum, value) => sum + value, 0);
  const maxVotes = Math.max(...votes);
  if (maxVotes === total) return "unanimous";
  if (finalAction === "avoid" && voteCounts.avoid >= 3) return "blocked";
  if (maxVotes >= Math.ceil(total * 0.6)) return "leaning";
  return "split";
}

function buildDecisionCommittee({
  match,
  bestPick,
  valueEdges,
  evidence,
  missingSignals,
  contradictionChecks,
  scenarioMatrix,
  abstentionRules,
  decisionScore,
  action,
  risk,
  calibration,
  deliberation,
  caseMemory
}: {
  match: Match;
  bestPick: BestPickResult;
  valueEdges: ValueEdge[];
  evidence: DecisionEvidence[];
  missingSignals: string[];
  contradictionChecks: DecisionContradictionCheck[];
  scenarioMatrix: DecisionScenario[];
  abstentionRules: DecisionAbstentionRule[];
  decisionScore: number;
  action: DecisionAction;
  risk: RiskLevel;
  calibration: DecisionCalibration;
  deliberation: DecisionDeliberation;
  caseMemory: DecisionCaseMemory;
}): DecisionCommittee {
  const triggeredRules = abstentionRules.filter((rule) => rule.triggered);
  const conflictChecks = contradictionChecks.filter((check) => check.status === "conflict");
  const watchChecks = contradictionChecks.filter((check) => check.status === "watch");
  const strongestEdges = [...valueEdges].sort((a, b) => b.expectedValue - a.expectedValue).slice(0, 3);
  const baseScenario = scenarioMatrix.find((scenario) => scenario.id === "base-case");
  const adverseScenario = scenarioMatrix.find((scenario) => scenario.id === "adverse-team-news");

  const modelVote: DecisionAction = bestPick.hasValue ? (decisionScore >= 48 ? "consider" : "monitor") : "avoid";
  const marketVote: DecisionAction = !bestPick.hasValue
    ? "avoid"
    : bestPick.edge >= 0.08 && bestPick.expectedValue >= 0.08
      ? "consider"
      : "monitor";
  const contextVote: DecisionAction = triggeredRules.some((rule) => rule.id === "live-without-inplay-model" || rule.id === "data-quality-floor")
    ? "avoid"
    : missingSignals.length >= 6 || conflictChecks.length
      ? "avoid"
      : missingSignals.length >= 3 || watchChecks.length
        ? "monitor"
        : "consider";
  const riskVote: DecisionAction =
    calibration.action === "abstain" ? "avoid" : calibration.action === "discount" || calibration.health !== "stable" ? "monitor" : action;
  const memoryVote: DecisionAction =
    caseMemory.status !== "ready"
      ? "monitor"
      : caseMemory.adjustment === "abstain"
        ? "avoid"
        : caseMemory.adjustment === "discount"
          ? "monitor"
          : action;

  const memberInput: Array<Omit<DecisionCommitteeMember, "stance">> = [
    {
      id: "model-advocate",
      role: "model-advocate",
      label: "Model advocate",
      vote: modelVote,
      confidence: bestPick.hasValue ? bestPick.confidence : "low",
      risk: committeeRisk(modelVote, risk),
      thesis: bestPick.hasValue
        ? `${bestPick.label} is mathematically live because model probability is ${formatPercent(bestPick.modelProbability)} against no-vig ${formatPercent(
            bestPick.noVigImpliedProbability
          )}.`
        : "The model cannot advocate for a selection because no market cleared the positive-edge filter.",
      evidence: bestPick.hasValue
        ? [
            `Edge ${formatSignedPercent(bestPick.edge)} and EV ${formatSignedPercent(bestPick.expectedValue)}.`,
            ...(strongestEdges.length ? strongestEdges.map((edge) => `${edge.label}: ${formatSignedPercent(edge.expectedValue)} EV`) : [])
          ].slice(0, 4)
        : ["No clear value found."],
      objections: evidenceHighlights(evidence, "negative", 2),
      requiredChecks: ["Recompute probabilities after fresh odds and context updates."]
    },
    {
      id: "market-skeptic",
      role: "market-skeptic",
      label: "Market skeptic",
      vote: marketVote,
      confidence: bestPick.hasValue && bestPick.edge >= 0.08 ? "medium" : "low",
      risk: committeeRisk(marketVote, risk),
      thesis: bestPick.hasValue
        ? `The price still has to survive market scrutiny; odds shortening would change the edge on ${bestPick.label}.`
        : "Market prices are currently stronger than the model edge.",
      evidence: [
        bestPick.hasValue
          ? `Bookmaker margin ${formatSignedPercent(bestPick.bookmakerMargin)}; raw implied ${formatPercent(bestPick.rawImpliedProbability)}.`
          : "No positive no-vig edge is available.",
        scenarioMatrix.find((scenario) => scenario.id === "odds-shortening")?.detail ?? "Odds-movement scenario is unavailable."
      ],
      objections: bestPick.hasValue && bestPick.expectedValue < 0.08 ? ["EV is positive but not wide enough for a forceful recommendation."] : [],
      requiredChecks: ["Refresh bookmaker odds before surfacing a final edge."]
    },
    {
      id: "context-scout",
      role: "context-scout",
      label: "Context scout",
      vote: contextVote,
      confidence: missingSignals.length >= 5 ? "low" : missingSignals.length >= 2 ? "medium" : "high",
      risk: committeeRisk(contextVote, risk),
      thesis:
        missingSignals.length || watchChecks.length
          ? `Context is incomplete for ${match.homeTeam.name} vs ${match.awayTeam.name}; ${missingSignals.length} missing signals remain.`
          : "Available context does not currently block the decision.",
      evidence: evidenceHighlights(evidence, "unknown", 3),
      objections: [
        ...missingSignals.slice(0, 3),
        ...(adverseScenario ? [adverseScenario.detail] : [])
      ].slice(0, 4),
      requiredChecks: ["Check lineup, injury, suspension, weather, live-state, and news signals near start time."]
    },
    {
      id: "risk-manager",
      role: "risk-manager",
      label: "Risk manager",
      vote: riskVote,
      confidence: calibration.health === "stable" ? "high" : calibration.health === "review" ? "medium" : "low",
      risk: committeeRisk(riskVote, risk),
      thesis: `Reliability is ${calibration.reliabilityScore}/100 with ${calibration.health} health and ${calibration.action} calibration action.`,
      evidence: [
        baseScenario ? `${baseScenario.label}: score ${baseScenario.projectedScore}.` : `Decision score ${decisionScore}.`,
        `${conflictChecks.length} conflicts, ${watchChecks.length} watch checks, ${triggeredRules.length} abstention gates.`
      ],
      objections: triggeredRules.map((rule) => `${rule.label}: ${rule.detail}`).slice(0, 4),
      requiredChecks: ["Honor triggered abstention gates before any public recommendation."]
    },
    {
      id: "memory-analyst",
      role: "memory-analyst",
      label: "Memory analyst",
      vote: memoryVote,
      confidence:
        caseMemory.status === "ready" && (caseMemory.averageSimilarity ?? 0) >= 0.72
          ? "high"
          : caseMemory.status === "ready"
            ? "medium"
            : "low",
      risk: committeeRisk(memoryVote, risk),
      thesis: caseMemory.summary,
      evidence: caseMemory.similarCases
        .slice(0, 3)
        .map((item) => `${item.fixtureExternalId}: ${item.action}, ${formatPercent(item.similarity)} similarity.`),
      objections: caseMemory.notes.slice(0, 4),
      requiredChecks: ["Store this decision and settle outcomes so memory can learn from real results."]
    },
    {
      id: "final-arbiter",
      role: "final-arbiter",
      label: "Final arbiter",
      vote: action,
      confidence: calibration.health === "stable" ? "high" : calibration.health === "review" ? "medium" : "low",
      risk,
      thesis: deliberation.synthesis,
      evidence: [deliberation.primaryThesis, deliberation.dissentingThesis],
      objections: deliberation.watchItems.slice(0, 3).map((item) => item.label),
      requiredChecks: [deliberation.decisionIfMissingDataTurnsBad, deliberation.decisionIfMarketMoves]
    }
  ];

  const members = memberInput.map((member) => ({
    ...member,
    stance: committeeStance(member.vote, action)
  }));

  const voteCounts = members.reduce(
    (counts, member) => {
      counts[member.vote] += 1;
      return counts;
    },
    { consider: 0, monitor: 0, avoid: 0 }
  );
  const consensus = committeeConsensus(voteCounts, action);
  const unresolvedDisagreements = members
    .filter((member) => member.vote !== action)
    .map((member) => `${member.label} voted ${member.vote}: ${member.thesis}`)
    .slice(0, 5);
  const guardrailNotes = [
    ...triggeredRules.map((rule) => `${rule.label}: ${rule.detail}`),
    "Committee output is public audit reasoning; it does not expose hidden chain-of-thought.",
    "The final arbiter cannot upgrade beyond value-edge, data-quality, market, memory, and abstention guardrails.",
    "The optional OpenAI reviewer can add a second opinion with agent=1, but local guardrails still prevent upward promotion."
  ].slice(0, 7);

  return {
    status: "ready",
    consensus,
    recommendedAction: action,
    voteCounts,
    members,
    finalRationale: `Decision committee recommends ${action} with ${consensus} consensus: ${deliberation.synthesis}`,
    unresolvedDisagreements,
    guardrailNotes
  };
}

function reconcileDecisionCommittee(committee: DecisionCommittee, finalAction: DecisionAction): DecisionCommittee {
  if (committee.recommendedAction === finalAction) return committee;
  const consensus = committeeConsensus(committee.voteCounts, finalAction);
  return {
    ...committee,
    consensus,
    recommendedAction: finalAction,
    members: committee.members.map((member) => ({
      ...member,
      stance: committeeStance(member.vote, finalAction)
    })),
    finalRationale: `The public-action invariant downgraded the committee candidate from ${committee.recommendedAction} to ${finalAction}. ${committee.finalRationale}`,
    unresolvedDisagreements: [
      `Final public action is ${finalAction}; the pre-invariant committee candidate was ${committee.recommendedAction}.`,
      ...committee.unresolvedDisagreements
    ].slice(0, 5)
  };
}

function priorityRank(priority: DecisionMonitoringPriority): number {
  if (priority === "critical") return 4;
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function dateFromIso(value: string, fallback: Date): Date {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : fallback;
}

function addMinutes(date: Date, minutes: number): string {
  return new Date(date.getTime() + Math.max(0, minutes) * 60000).toISOString();
}

function monitoringPriorityFromWatch(
  priority: DecisionDeliberation["watchItems"][number]["priority"],
  planPriority: DecisionMonitoringPriority
): DecisionMonitoringPriority {
  if (planPriority === "critical" && priority === "high") return "critical";
  return priority;
}

function monitoringDueAt(generatedAt: Date, reviewCadenceMinutes: number, priority: DecisionMonitoringPriority): string {
  if (reviewCadenceMinutes <= 0) return generatedAt.toISOString();
  const dueInMinutes =
    priority === "critical"
      ? Math.min(3, reviewCadenceMinutes)
      : priority === "high"
        ? Math.min(10, reviewCadenceMinutes)
        : priority === "medium"
          ? Math.min(20, reviewCadenceMinutes)
          : reviewCadenceMinutes;
  return addMinutes(generatedAt, dueInMinutes);
}

function buildDecisionMonitoringPlan({
  match,
  bestPick,
  missingSignals,
  abstentionRules,
  beliefState,
  deliberation,
  committee,
  learningProfile,
  caseMemory,
  calibration
}: {
  match: Match;
  bestPick: BestPickResult;
  missingSignals: string[];
  abstentionRules: DecisionAbstentionRule[];
  beliefState: DecisionBeliefState;
  deliberation: DecisionDeliberation;
  committee: DecisionCommittee;
  learningProfile?: DecisionLearningProfile;
  caseMemory: DecisionCaseMemory;
  calibration: DecisionCalibration;
}): DecisionMonitoringPlan {
  const generatedAt = dateFromIso(beliefState.generatedAt, new Date());
  const triggeredRules = abstentionRules.filter((rule) => rule.triggered);
  const status: DecisionMonitoringPlan["status"] =
    match.status === "finished" || beliefState.ttlMinutes <= 0
      ? "expired"
      : triggeredRules.length || committee.recommendedAction === "avoid"
        ? "blocked"
        : committee.recommendedAction === "monitor" || beliefState.grade !== "strong" || committee.consensus !== "unanimous"
          ? "watching"
          : "active";
  const priority: DecisionMonitoringPriority =
    status === "expired" || match.status === "live" || triggeredRules.length || beliefState.grade === "fragile"
      ? "critical"
      : committee.consensus !== "unanimous" || missingSignals.length >= 4 || status === "watching"
        ? "high"
        : committee.recommendedAction === "consider"
          ? "medium"
          : "low";
  const reviewCadenceMinutes =
    status === "expired"
      ? 0
      : priority === "critical"
        ? match.status === "live"
          ? 3
          : 5
        : priority === "high"
          ? Math.max(5, Math.min(15, beliefState.ttlMinutes))
          : priority === "medium"
            ? Math.max(10, Math.min(30, beliefState.ttlMinutes))
            : Math.max(30, beliefState.ttlMinutes);
  const nextReviewAt = addMinutes(generatedAt, reviewCadenceMinutes);
  const tasks: DecisionMonitoringTask[] = [
    {
      id: "odds-refresh",
      label: "Refresh bookmaker odds",
      priority: priority === "critical" ? "critical" : "high",
      dueAt: monitoringDueAt(generatedAt, reviewCadenceMinutes, priority === "critical" ? "critical" : "high"),
      source: "odds",
      trigger: bestPick.hasValue
        ? `Current edge is ${formatSignedPercent(bestPick.edge)} and EV is ${formatSignedPercent(bestPick.expectedValue)}; a price move can erase value.`
        : "No selection currently has positive expected value, so fresh prices may be the only path to a recommendation.",
      action: "Recalculate implied probability, bookmaker margin, no-vig probability, value edge, and expected value."
    }
  ];

  for (const item of deliberation.watchItems.slice(0, 5)) {
    if (item.id === "odds-refresh") continue;
    const taskPriority = monitoringPriorityFromWatch(item.priority, priority);
    tasks.push({
      id: `watch-${item.id}`,
      label: item.label,
      priority: taskPriority,
      dueAt: monitoringDueAt(generatedAt, reviewCadenceMinutes, taskPriority),
      source: item.signalType,
      trigger: item.whyItMatters,
      action: item.actionIfConfirmed
    });
  }

  if (match.status === "live") {
    tasks.push({
      id: "live-event-feed",
      label: "Refresh live event feed",
      priority: "critical",
      dueAt: monitoringDueAt(generatedAt, reviewCadenceMinutes, "critical"),
      source: "live-state",
      trigger: "The match is live; red cards, injuries, pace, score state, and substitutions can invalidate pre-match probability.",
      action: "Re-run the model with in-play state before keeping any selection visible."
    });
  }

  if (!learningProfile?.active) {
    tasks.push({
      id: "training-profile",
      label: "Update historical learning profile",
      priority: priority === "critical" ? "high" : "medium",
      dueAt: monitoringDueAt(generatedAt, reviewCadenceMinutes || 30, priority === "critical" ? "high" : "medium"),
      source: "training",
      trigger: learningProfile
        ? learningProfile.reason
        : "No active real-data backtest profile is loaded, so live thresholds remain conservative defaults.",
      action: "Import real historical fixtures, odds, and outcomes; rerun backtests before letting learned thresholds tune live decisions."
    });
  }

  if (caseMemory.status !== "ready" || caseMemory.adjustment !== "none") {
    tasks.push({
      id: "case-memory-review",
      label: "Review case memory",
      priority: caseMemory.adjustment === "abstain" ? "critical" : caseMemory.adjustment === "discount" ? "high" : "medium",
      dueAt: monitoringDueAt(
        generatedAt,
        reviewCadenceMinutes || 30,
        caseMemory.adjustment === "abstain" ? "critical" : caseMemory.adjustment === "discount" ? "high" : "medium"
      ),
      source: "memory",
      trigger: caseMemory.summary,
      action:
        caseMemory.adjustment === "abstain"
          ? "Keep the decision avoided unless the comparable-case evidence is stale or irrelevant."
          : caseMemory.adjustment === "discount"
            ? "Discount confidence and require stronger odds/context confirmation."
            : "Keep storing decisions and settled outcomes until similar cases can inform the engine."
    });
  }

  if (committee.consensus !== "unanimous") {
    tasks.push({
      id: "committee-disagreement",
      label: "Resolve committee disagreement",
      priority: committee.consensus === "blocked" ? "critical" : "high",
      dueAt: monitoringDueAt(generatedAt, reviewCadenceMinutes || 15, committee.consensus === "blocked" ? "critical" : "high"),
      source: "calibration",
      trigger: committee.unresolvedDisagreements.join(" ") || committee.finalRationale,
      action: "Collect the missing signal, rerun guardrails, and keep the lower-risk action if the disagreement remains."
    });
  }

  for (const rule of triggeredRules.slice(0, 2)) {
    tasks.push({
      id: `gate-${rule.id}`,
      label: rule.label,
      priority: "critical",
      dueAt: monitoringDueAt(generatedAt, reviewCadenceMinutes, "critical"),
      source: "calibration",
      trigger: rule.detail,
      action: "Do not promote the decision until this abstention gate is cleared by fresh model, market, or provider evidence."
    });
  }

  const uniqueTasks = Array.from(new Map(tasks.map((task) => [task.id, task])).values())
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || Date.parse(a.dueAt) - Date.parse(b.dueAt))
    .slice(0, 8);
  const stopConditions = Array.from(
    new Set([
      bestPick.hasValue
        ? `Stop if ${bestPick.label} no-vig edge falls to zero or expected value turns negative.`
        : "Stop any recommendation until a selection shows positive no-vig edge and positive expected value.",
      ...beliefState.invalidationTriggers.slice(0, 4),
      ...triggeredRules.map((rule) => `Stop while abstention gate remains active: ${rule.label}.`),
      calibration.action === "abstain" ? "Stop while calibration says abstain." : "",
      status === "expired" ? "Stop because the current belief has expired." : ""
    ].filter((item): item is string => Boolean(item)))
  ).slice(0, 7);
  const escalationRules = Array.from(
    new Set([
      "If two high-priority monitoring tasks remain unresolved at the next review, downgrade the action to monitor or avoid.",
      "If bookmaker movement removes the value edge, remove the recommendation and rerun the committee.",
      "If confirmed team news, weather, surface, or live-event data opposes the thesis, rerun the model before showing the pick.",
      match.status === "live" ? "If live-event data is unavailable during play, avoid instead of trusting the pre-match snapshot." : "",
      committee.consensus !== "unanimous" ? "If committee disagreement remains after the next data refresh, keep the lower-risk action." : "",
      !learningProfile?.active ? "Do not raise confidence from historical learning until the real-data profile is active." : ""
    ].filter((item): item is string => Boolean(item)))
  ).slice(0, 6);
  const summary =
    status === "active"
      ? `Monitoring is active with ${priority} priority; review every ${reviewCadenceMinutes} minutes and keep ${uniqueTasks[0]?.label.toLowerCase() ?? "odds refresh"} first.`
      : status === "watching"
        ? `Monitoring is watching with ${priority} priority because the belief or committee is not fully settled; next review in ${reviewCadenceMinutes} minutes.`
        : status === "blocked"
          ? `Monitoring is blocked with ${priority} priority until guardrails, missing signals, or market value improve.`
          : "Monitoring is expired; rerun the engine with a fresh fixture and market snapshot.";

  return {
    status,
    priority,
    nextReviewAt,
    reviewCadenceMinutes,
    summary,
    tasks: uniqueTasks,
    stopConditions,
    escalationRules
  };
}

function actionabilityGateScore(status: DecisionActionabilityGateStatus, score: number): number {
  if (status === "pass") return Math.max(70, score);
  if (status === "warn") return Math.max(35, Math.min(74, score));
  return Math.min(34, score);
}

function buildActionabilityGate({
  id,
  label,
  status,
  score,
  weight,
  detail,
  requiredAction
}: {
  id: string;
  label: string;
  status: DecisionActionabilityGateStatus;
  score: number;
  weight: number;
  detail: string;
  requiredAction?: string | null;
}): DecisionActionabilityGate {
  return {
    id,
    label,
    status,
    score: boundScore(actionabilityGateScore(status, score)),
    weight,
    detail,
    requiredAction: requiredAction ?? null
  };
}

function buildDecisionActionabilityAudit({
  match,
  diagnostics,
  bestPick,
  action,
  risk,
  missingSignals,
  abstentionRules,
  beliefState,
  committee,
  monitoringPlan,
  caseMemory,
  learningProfile,
  calibration,
  historicalDiscipline
}: {
  match: Match;
  diagnostics: FootballModelDiagnostics;
  bestPick: BestPickResult;
  action: DecisionAction;
  risk: RiskLevel;
  missingSignals: string[];
  abstentionRules: DecisionAbstentionRule[];
  beliefState: DecisionBeliefState;
  committee: DecisionCommittee;
  monitoringPlan: DecisionMonitoringPlan;
  caseMemory: DecisionCaseMemory;
  learningProfile?: DecisionLearningProfile;
  calibration: DecisionCalibration;
  historicalDiscipline: DecisionHistoricalDiscipline;
}): DecisionActionabilityAudit {
  const triggeredRules = abstentionRules.filter((rule) => rule.triggered);
  const valueGateStatus: DecisionActionabilityGateStatus =
    bestPick.hasValue && bestPick.edge > 0 && bestPick.expectedValue > 0 ? "pass" : bestPick.hasValue ? "warn" : "fail";
  const confidenceGateStatus: DecisionActionabilityGateStatus = bestPick.hasValue && bestPick.confidence === "high" ? "pass" : bestPick.hasValue ? "warn" : "fail";
  const dataGateStatus: DecisionActionabilityGateStatus =
    diagnostics.dataQualityScore >= 0.76 ? "pass" : diagnostics.dataQualityScore >= 0.62 ? "warn" : "fail";
  const contextGateStatus: DecisionActionabilityGateStatus = missingSignals.length <= 1 ? "pass" : missingSignals.length <= 3 ? "warn" : "fail";
  const beliefGateStatus: DecisionActionabilityGateStatus =
    beliefState.grade === "strong" && beliefState.ttlMinutes > 0 ? "pass" : beliefState.grade === "moderate" && beliefState.ttlMinutes > 0 ? "warn" : "fail";
  const committeeGateStatus: DecisionActionabilityGateStatus =
    committee.recommendedAction === "consider" && (committee.consensus === "unanimous" || committee.consensus === "leaning")
      ? "pass"
      : committee.recommendedAction === "monitor" || committee.consensus === "split"
        ? "warn"
        : "fail";
  const monitoringGateStatus: DecisionActionabilityGateStatus =
    monitoringPlan.status === "active" ? "pass" : monitoringPlan.status === "watching" ? "warn" : "fail";
  const memoryGateStatus: DecisionActionabilityGateStatus =
    caseMemory.adjustment === "none" && caseMemory.status === "ready"
      ? "pass"
      : caseMemory.adjustment === "abstain"
        ? "fail"
        : "warn";
  const learningGateStatus: DecisionActionabilityGateStatus = learningProfile?.active ? "pass" : "warn";
  const riskGateStatus: DecisionActionabilityGateStatus = risk === "low" ? "pass" : risk === "medium" ? "warn" : "fail";
  const historicalGateStatus: DecisionActionabilityGateStatus =
    historicalDiscipline.trustEffect === "cap-raw-edge" || historicalDiscipline.trustEffect === "block"
      ? "fail"
      : historicalDiscipline.trustEffect === "queue-provider-retest"
        ? "warn"
        : "pass";

  const gates = [
    buildActionabilityGate({
      id: "value-edge",
      label: "Value edge and EV",
      status: valueGateStatus,
      score: bestPick.hasValue ? Math.round((bestPick.edge + bestPick.expectedValue) * 350) : 0,
      weight: 0.18,
      detail: bestPick.hasValue
        ? `${bestPick.label} has edge ${formatSignedPercent(bestPick.edge)} and EV ${formatSignedPercent(bestPick.expectedValue)}.`
        : "No selection passed positive-edge and expected-value filters.",
      requiredAction: valueGateStatus === "pass" ? null : "Wait for fresh odds or a stronger model-market disagreement before showing a candidate."
    }),
    buildActionabilityGate({
      id: "confidence-risk",
      label: "Confidence and risk",
      status: confidenceGateStatus === "fail" || riskGateStatus === "fail" ? "fail" : confidenceGateStatus === "warn" || riskGateStatus === "warn" ? "warn" : "pass",
      score: bestPick.hasValue ? (bestPick.confidence === "high" ? 92 : bestPick.confidence === "medium" ? 64 : 32) - (risk === "high" ? 18 : risk === "medium" ? 7 : 0) : 0,
      weight: 0.14,
      detail: bestPick.hasValue ? `Confidence is ${bestPick.confidence} and risk is ${risk}.` : "No candidate exists, so confidence and risk cannot support action.",
      requiredAction:
        confidenceGateStatus === "pass" && riskGateStatus === "pass" ? null : "Keep as analysis-only watchlist unless confidence improves or risk falls."
    }),
    buildActionabilityGate({
      id: "data-quality",
      label: "Data quality",
      status: dataGateStatus,
      score: diagnostics.dataQualityScore * 100,
      weight: 0.12,
      detail: `Data quality is ${formatPercent(diagnostics.dataQualityScore)}.`,
      requiredAction: dataGateStatus === "pass" ? null : "Improve provider coverage before promoting this decision."
    }),
    buildActionabilityGate({
      id: "context-coverage",
      label: "Context coverage",
      status: contextGateStatus,
      score: 100 - missingSignals.length * 16,
      weight: 0.1,
      detail: missingSignals.length ? `Missing signals: ${missingSignals.join(", ")}.` : "No blocking context gaps are currently tracked.",
      requiredAction: contextGateStatus === "pass" ? null : "Fetch the highest-priority missing context signals and rerun the decision."
    }),
    buildActionabilityGate({
      id: "belief-freshness",
      label: "Belief freshness",
      status: beliefGateStatus,
      score: beliefState.grade === "strong" ? 92 : beliefState.grade === "moderate" ? 62 : 24,
      weight: 0.12,
      detail: `${beliefState.summary}`,
      requiredAction: beliefGateStatus === "pass" ? null : "Refresh odds, context, and model state before trusting this belief."
    }),
    buildActionabilityGate({
      id: "committee-arbitration",
      label: "Committee arbitration",
      status: committeeGateStatus,
      score: committee.consensus === "unanimous" ? 94 : committee.consensus === "leaning" ? 78 : committee.consensus === "split" ? 55 : 18,
      weight: 0.12,
      detail: committee.finalRationale,
      requiredAction: committeeGateStatus === "pass" ? null : "Resolve committee disagreement and keep the lower-risk action."
    }),
    buildActionabilityGate({
      id: "monitoring-state",
      label: "Monitoring state",
      status: monitoringGateStatus,
      score: monitoringPlan.status === "active" ? 90 : monitoringPlan.status === "watching" ? 58 : 12,
      weight: 0.1,
      detail: monitoringPlan.summary,
      requiredAction: monitoringGateStatus === "pass" ? null : monitoringPlan.tasks[0]?.action ?? "Rerun the monitoring plan."
    }),
    buildActionabilityGate({
      id: "case-memory",
      label: "Case memory",
      status: memoryGateStatus,
      score: caseMemory.adjustment === "none" ? (caseMemory.status === "ready" ? 86 : 58) : caseMemory.adjustment === "discount" ? 50 : 10,
      weight: 0.07,
      detail: caseMemory.summary,
      requiredAction: memoryGateStatus === "pass" ? null : "Keep memory neutral or discounted until stored outcomes support this pattern."
    }),
    buildActionabilityGate({
      id: "learning-profile",
      label: "Historical learning profile",
      status: learningGateStatus,
      score: learningProfile?.active ? 82 : 55,
      weight: 0.05,
      detail: learningProfile ? learningProfile.reason : "No historical learning profile is loaded.",
      requiredAction: learningGateStatus === "pass" ? null : "Do not raise confidence from training until real historical data is active."
    }),
    buildActionabilityGate({
      id: "historical-discipline",
      label: "Historical discipline",
      status: historicalGateStatus,
      score:
        historicalGateStatus === "pass"
          ? historicalDiscipline.attached
            ? 82
            : 68
          : historicalGateStatus === "warn"
            ? 48
            : 6,
      weight: 0.08,
      detail: `${historicalDiscipline.summary} ${historicalDiscipline.instruction}`,
      requiredAction:
        historicalGateStatus === "pass"
          ? null
          : historicalDiscipline.requiredBeforePromotion[0] ?? historicalDiscipline.instruction
    })
  ];
  const score = boundScore(gates.reduce((sum, gate) => sum + gate.score * gate.weight, 0) / gates.reduce((sum, gate) => sum + gate.weight, 0));
  const hardFailures = gates.filter((gate) => gate.status === "fail");
  const warnings = gates
    .filter((gate) => gate.status === "warn")
    .map((gate) => `${gate.label}: ${gate.detail}`)
    .slice(0, 8);
  const blockers = [
    ...hardFailures.map((gate) => `${gate.label}: ${gate.detail}`),
    ...triggeredRules.map((rule) => `${rule.label}: ${rule.detail}`),
    ...(calibration.action === "abstain" ? [`Calibration: ${calibration.detail}`] : [])
  ].slice(0, 8);
  const status: DecisionActionabilityAudit["status"] =
    blockers.length || action === "avoid" || score < 45 ? "blocked" : action === "consider" && score >= 76 ? "actionable" : "watch-only";
  const posture: DecisionActionabilityAudit["posture"] =
    status === "actionable" ? "show-value-candidate" : status === "watch-only" ? "keep-on-watchlist" : "avoid-recommendation";
  const requiredBeforeAction = Array.from(
    new Set([
      ...gates.filter((gate) => gate.status !== "pass" && gate.requiredAction).map((gate) => gate.requiredAction as string),
      ...monitoringPlan.tasks.slice(0, 3).map((task) => `${task.label}: ${task.action}`),
      match.status === "live"
        ? hasLiveInPlayModel(match, diagnostics)
          ? "Refresh live event feed for cards, substitutions, injuries, and shot pressure before trusting the live edge."
          : "Use an in-play model and live-event feed before trusting any live decision."
        : ""
    ].filter((item): item is string => Boolean(item)))
  ).slice(0, 8);
  const responsibleUse = [
    "Treat the output as statistical analysis, not certainty.",
    "Do not use this audit as staking, bankroll, or financial advice.",
    "Refresh odds and context before relying on any displayed edge.",
    "Avoid acting when the monitoring plan is blocked, expired, or unresolved."
  ];
  const selection = bestPick.hasValue ? bestPick.label : "the current market set";
  const summary =
    status === "actionable"
      ? `Actionability is ${score}/100: ${selection} can be shown as an inspectable value candidate after the listed refresh checks.`
      : status === "watch-only"
        ? `Actionability is ${score}/100: keep ${selection} on the watchlist until warnings are cleared.`
        : `Actionability is ${score}/100: block a public recommendation until failed gates are fixed.`;

  return {
    status,
    posture,
    score,
    summary,
    gates,
    blockers,
    warnings,
    requiredBeforeAction,
    responsibleUse
  };
}

function buildDecisionReviewLoop({
  action,
  risk,
  bestPick,
  deliberation,
  beliefState,
  committee,
  monitoringPlan,
  actionability,
  missingSignals,
  abstentionRules,
  calibration,
  caseMemory
}: {
  action: DecisionAction;
  risk: RiskLevel;
  bestPick: BestPickResult;
  deliberation: DecisionDeliberation;
  beliefState: DecisionBeliefState;
  committee: DecisionCommittee;
  monitoringPlan: DecisionMonitoringPlan;
  actionability: DecisionActionabilityAudit;
  missingSignals: string[];
  abstentionRules: DecisionAbstentionRule[];
  calibration: DecisionCalibration;
  caseMemory: DecisionCaseMemory;
}): DecisionReviewLoop {
  const blockingRules = abstentionRules.filter((rule) => rule.triggered);
  const failedGates = actionability.gates.filter((gate) => gate.status === "fail");
  const warningGates = actionability.gates.filter((gate) => gate.status === "warn");
  const recommendedAction: DecisionAction =
    actionability.status === "blocked" || blockingRules.length ? "avoid" : actionability.status === "watch-only" && action === "consider" ? "monitor" : action;
  const status: DecisionReviewLoop["status"] =
    recommendedAction === "avoid" && action !== "avoid"
      ? "blocked"
      : recommendedAction !== action
        ? "downgraded"
        : actionability.status === "actionable" && !warningGates.length
          ? "cleared"
          : actionability.status === "actionable"
            ? "repaired"
            : "blocked";
  const confidenceShift: DecisionReviewLoop["confidenceShift"] = status === "cleared" || status === "repaired" ? "keep" : "lower";
  const riskShift: DecisionReviewLoop["riskShift"] = status === "cleared" ? "keep" : risk === "high" ? "keep" : "raise";
  const scoreDelta = status === "cleared" ? 0 : status === "repaired" ? -4 : status === "downgraded" ? -12 : -28;
  const topWarnings = warningGates.map((gate) => `${gate.label}: ${gate.detail}`).slice(0, 3);
  const topBlockers = [...failedGates.map((gate) => `${gate.label}: ${gate.detail}`), ...blockingRules.map((rule) => `${rule.label}: ${rule.detail}`)].slice(0, 4);
  const repairsApplied = Array.from(
    new Set([
      ...actionability.requiredBeforeAction.slice(0, 4),
      ...monitoringPlan.tasks.slice(0, 2).map((task) => `${task.label}: ${task.action}`),
      caseMemory.adjustment !== "none" ? `Case memory adjustment remains ${caseMemory.adjustment}.` : ""
    ].filter((item): item is string => Boolean(item)))
  ).slice(0, 6);
  const unresolvedIssues = Array.from(
    new Set([
      ...topBlockers,
      ...topWarnings,
      ...missingSignals.slice(0, 3).map((signal) => `Missing signal: ${signal}.`),
      monitoringPlan.status !== "active" ? `Monitoring is ${monitoringPlan.status}.` : "",
      committee.consensus !== "unanimous" ? `Committee consensus is ${committee.consensus}.` : ""
    ].filter((item): item is string => Boolean(item)))
  ).slice(0, 8);
  const releaseCriteria = Array.from(
    new Set([
      "Fresh odds must keep no-vig edge and expected value positive.",
      "Belief state must be unexpired before the decision remains visible.",
      "Monitoring plan must be active or explicitly cleared.",
      "Actionability must stay actionable or the product should downgrade to watch/avoid.",
      ...actionability.requiredBeforeAction.slice(0, 3)
    ])
  ).slice(0, 7);
  const steps: DecisionReviewLoopStep[] = [
    {
      id: "thesis-builder",
      role: "thesis-builder",
      verdict: bestPick.hasValue && action !== "avoid" ? "support" : "challenge",
      confidence: bestPick.hasValue ? bestPick.confidence : "low",
      summary: bestPick.hasValue
        ? `Primary thesis is ${bestPick.label}: edge ${formatSignedPercent(bestPick.edge)}, EV ${formatSignedPercent(bestPick.expectedValue)}.`
        : "No value thesis survived the market guardrail.",
      evidence: [deliberation.primaryThesis, beliefState.summary].slice(0, 3),
      requiredChange: bestPick.hasValue ? null : "Wait for a positive-EV selection before forming a recommendation thesis."
    },
    {
      id: "red-team",
      role: "red-team",
      verdict: topBlockers.length ? "block" : topWarnings.length ? "challenge" : "support",
      confidence: topBlockers.length ? "high" : topWarnings.length ? "medium" : "high",
      summary: topBlockers.length
        ? `Red team found ${topBlockers.length} blocking issue(s).`
        : topWarnings.length
          ? `Red team found ${topWarnings.length} warning issue(s) that need repair checks.`
          : "Red team did not find a blocker after actionability gates.",
      evidence: [...topBlockers, ...topWarnings, committee.finalRationale].slice(0, 5),
      requiredChange: topBlockers[0] ?? topWarnings[0] ?? null
    },
    {
      id: "data-gap-checker",
      role: "data-gap-checker",
      verdict: missingSignals.length >= 4 ? "block" : missingSignals.length ? "repair" : "support",
      confidence: missingSignals.length >= 4 ? "high" : missingSignals.length ? "medium" : "high",
      summary: missingSignals.length
        ? `${missingSignals.length} missing signal(s) remain: ${missingSignals.slice(0, 3).join(", ")}.`
        : "No missing data signal is currently blocking the recommendation.",
      evidence: [monitoringPlan.summary, ...monitoringPlan.tasks.slice(0, 3).map((task) => `${task.label}: ${task.trigger}`)],
      requiredChange: missingSignals.length ? "Fetch missing context, refresh probabilities, and rerun actionability." : null
    },
    {
      id: "repair-planner",
      role: "repair-planner",
      verdict: repairsApplied.length ? "repair" : "support",
      confidence: repairsApplied.length ? "medium" : "high",
      summary: repairsApplied.length ? `Repair plan has ${repairsApplied.length} required check(s).` : "No repair check is required beyond normal refresh.",
      evidence: repairsApplied.length ? repairsApplied : releaseCriteria.slice(0, 3),
      requiredChange: repairsApplied[0] ?? null
    },
    {
      id: "final-reviewer",
      role: "final-reviewer",
      verdict: status === "blocked" ? "block" : status === "downgraded" || status === "repaired" ? "repair" : "support",
      confidence: status === "cleared" ? "high" : status === "repaired" ? "medium" : "low",
      summary: `Final reviewer recommends ${recommendedAction}; review loop status is ${status}.`,
      evidence: [actionability.summary, calibration.detail, `Risk shift: ${riskShift}; confidence shift: ${confidenceShift}.`],
      requiredChange: recommendedAction === action ? null : `Use ${recommendedAction} instead of ${action} until review issues clear.`
    }
  ];
  const summary =
    status === "cleared"
      ? `Review loop cleared ${bestPick.hasValue ? bestPick.label : "the decision"} with no downgrade.`
      : status === "repaired"
        ? `Review loop kept ${recommendedAction} after repair checks: ${repairsApplied.slice(0, 2).join(" ")}`
        : status === "downgraded"
          ? `Review loop downgrades ${action} to ${recommendedAction} until unresolved issues clear.`
          : `Review loop blocks the recommendation until failed gates or abstention rules clear.`;

  return {
    status,
    initialAction: action,
    recommendedAction,
    confidenceShift,
    riskShift,
    scoreDelta,
    summary,
    steps,
    repairsApplied,
    unresolvedIssues,
    releaseCriteria
  };
}

export function buildDecisionEngineReport({
  match,
  markets,
  diagnostics,
  bestPick: candidateBestPick,
  valueEdges,
  learningProfile,
  caseMemoryBank,
  contextAdjustment,
  probabilityCalibration,
  marketPriorAdjustment,
  probabilityStages,
  publicHistoricalTrainingEvidence
}: {
  match: Match;
  markets: PredictionMarket[];
  diagnostics: FootballModelDiagnostics;
  bestPick: BestPickResult;
  valueEdges: ValueEdge[];
  learningProfile?: DecisionLearningProfile;
  caseMemoryBank?: DecisionCaseMemoryBank;
  contextAdjustment?: MatchContextAdjustment;
  probabilityCalibration?: LearnedProbabilityCalibrationAdjustment;
  marketPriorAdjustment?: MarketPriorAdjustment;
  probabilityStages?: DecisionProbabilityRuntimeStages;
  publicHistoricalTrainingEvidence?: PublicHistoricalTrainingEvidence | null;
}): DecisionEngineReport {
  const bestPick = selectBestPick(candidateBestPick.hasValue ? [candidateBestPick] : [], { learningProfile, caseMemoryBank });
  const evidence = buildDecisionEvidence({ match, markets, diagnostics, bestPick, contextAdjustment });
  const saferAlternatives = buildSaferAlternatives(match, markets, bestPick);
  const strongestEdges = [...valueEdges].sort((a, b) => b.edge - a.edge).slice(0, 3);
  const oddsIntelligence = buildDecisionOddsIntelligence({ match, valueEdges });
  const dataCoverage = buildDecisionDataCoverageAudit({ match, diagnostics, contextAdjustment, learningProfile });
  const caseMemory = buildCaseMemory({ bestPick, diagnostics, caseMemoryBank });
  const historicalDiscipline = buildDecisionHistoricalDiscipline({ publicHistoricalTrainingEvidence, bestPick, match });
  const missingSignals = Array.from(
    new Set([...evidence.filter((item) => item.quality === "missing").map((item) => item.label), ...(contextAdjustment?.missingSignals ?? [])])
  );
  const abstentionRules = buildAbstentionRules(match, diagnostics, bestPick, missingSignals, learningProfile, caseMemory, historicalDiscipline);
  const factors = buildDecisionFactors(match, diagnostics, bestPick, learningProfile, caseMemory, historicalDiscipline);
  const decisionScore = Math.round(factors.reduce((sum, item) => sum + item.weightedScore, 0));
  const baseVerdict = scoreToVerdict(decisionScore, bestPick, diagnostics);
  const candidateDecision = applyAbstentionVerdict(baseVerdict, abstentionRules);
  const candidateAction = candidateDecision.action;
  const marketMovement = buildDecisionMarketMovement({ bestPick, action: candidateAction });
  const contradictionChecks = buildContradictionChecks(match, diagnostics, bestPick, missingSignals, candidateAction);
  const scenarioMatrix = buildScenarioMatrix(decisionScore, bestPick, diagnostics);
  const calibration = buildCalibration(decisionScore, candidateAction, diagnostics, contradictionChecks, abstentionRules);
  const agentStages = buildAgentStages(match, diagnostics, bestPick, missingSignals, decisionScore, contradictionChecks, abstentionRules);
  const avoidReasons = [
    ...buildAvoidReasons(bestPick, diagnostics),
    ...abstentionRules.filter((rule) => rule.triggered).map((rule) => `Abstention gate triggered: ${rule.label}.`)
  ];
  const sensitivityChecks = buildSensitivityChecks(bestPick, diagnostics, decisionScore);
  const risks = [
    ...buildRisks(match, diagnostics, bestPick, contextAdjustment),
    ...(calibration.health === "fragile" ? ["The agent self-critique marked this decision as fragile."] : [])
  ];
  const finalConfidence = bestPick.hasValue ? bestPick.confidence : "low";
  const finalRisk = bestPick.hasValue ? bestPick.risk : diagnostics.uncertainty === "high" ? "high" : "medium";
  const beliefState = buildDecisionBeliefState({
    match,
    diagnostics,
    bestPick,
    evidence,
    missingSignals,
    contradictionChecks,
    abstentionRules,
    calibration,
    action: candidateAction,
    caseMemory,
    learningProfile
  });
  const probabilityTrace = buildDecisionProbabilityTrace({
    diagnostics,
    bestPick,
    probabilityStages,
    contextAdjustment,
    probabilityCalibration,
    marketPriorAdjustment,
    caseMemory,
    abstentionRules,
    calibration,
    action: candidateAction,
    beliefState
  });

  const expectedScoreStep =
    diagnostics.expectedScoreLabel ??
    `Simulated scorelines from expected ${diagnostics.scoreUnit ?? "goals"}: ${diagnostics.expectedGoals.home.toFixed(2)}-${diagnostics.expectedGoals.away.toFixed(
      2
    )}.`;
  const dixonColesSignal = diagnostics.signalScores.find((signal) => signal.label === "Dixon-Coles rho");
  const coreContextSignal = findCoreModelContextSignal(diagnostics);
  const contextCheck =
    match.sport === "basketball"
      ? "Check injuries, rest days, minutes limits, and starting lineups close to tipoff."
      : match.sport === "tennis"
        ? "Check player fitness, surface conditions, fatigue, and retirement-risk news close to first serve."
        : "Check injuries, suspensions, and confirmed lineups close to kickoff.";
  const environmentCheck =
    match.sport === "football"
      ? "Add weather for outdoor football totals and tempo-sensitive markets."
      : match.sport === "tennis"
        ? "Add weather and court-speed context for outdoor tennis totals."
        : "Add rest-day and rotation context before trusting spread and total-points markets.";
  const deliberation = buildDeliberation({
    match,
    bestPick,
    valueEdges,
    evidence,
    missingSignals,
    contradictionChecks,
    scenarioMatrix,
    sensitivityChecks,
    abstentionRules,
    decisionScore,
    action: candidateAction,
    calibration,
    learningProfile,
    caseMemory
  });
  const candidateCommittee = buildDecisionCommittee({
    match,
    bestPick,
    valueEdges,
    evidence,
    missingSignals,
    contradictionChecks,
    scenarioMatrix,
    abstentionRules,
    decisionScore,
    action: candidateAction,
    risk: finalRisk,
    calibration,
    deliberation,
    caseMemory
  });
  const monitoringPlan = buildDecisionMonitoringPlan({
    match,
    bestPick,
    missingSignals,
    abstentionRules,
    beliefState,
    deliberation,
    committee: candidateCommittee,
    learningProfile,
    caseMemory,
    calibration
  });
  const actionability = buildDecisionActionabilityAudit({
    match,
    diagnostics,
    bestPick,
    action: candidateAction,
    risk: finalRisk,
    missingSignals,
    abstentionRules,
    beliefState,
    committee: candidateCommittee,
    monitoringPlan,
    caseMemory,
    learningProfile,
    calibration,
    historicalDiscipline
  });
  const { verdict, action } = applyPublicActionInvariant(
    candidateDecision,
    bestPick,
    abstentionRules,
    dataCoverage,
    calibration,
    actionability
  );
  const committee = reconcileDecisionCommittee(candidateCommittee, action);
  const actionVerb = action === "consider" ? "can consider" : action === "monitor" ? "is monitoring" : "is avoiding";
  const summary = bestPick.hasValue
    ? `Decision engine ${actionVerb} ${bestPick.label}: model ${formatPercent(
        bestPick.modelProbability
      )}, no-vig implied ${formatPercent(bestPick.noVigImpliedProbability)}, edge ${formatSignedPercent(
        bestPick.edge
      )}, EV ${formatSignedPercent(bestPick.expectedValue)}, fair odds ${formatFairOdds(bestPick.modelProbability)}.`
    : `Decision engine says avoid forcing a pick for ${match.homeTeam.name} vs ${match.awayTeam.name}; the available edges do not justify a recommendation.`;
  const reviewLoop = buildDecisionReviewLoop({
    action,
    risk: finalRisk,
    bestPick,
    deliberation,
    beliefState,
    committee,
    monitoringPlan,
    actionability,
    missingSignals,
    abstentionRules,
    calibration,
    caseMemory
  });
  const attribution = buildDecisionAttribution({
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
  });
  const robustness = buildDecisionRobustnessAudit({
    bestPick,
    action,
    diagnostics,
    missingSignals,
    monitoringPlan,
    actionability,
    reviewLoop,
    saferAlternatives
  });
  const uncertainty = buildDecisionUncertaintyDecomposition({
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
  });
  const decisionBoundary = buildDecisionBoundary({
    diagnostics,
    bestPick,
    action,
    decisionScore,
    learningProfile,
    probabilityTrace,
    marketMovement,
    dataCoverage,
    uncertainty,
    robustness,
    abstentionRules
  });
  const evaluationPlan = buildDecisionEvaluationPlan({
    match,
    bestPick,
    action,
    monitoringPlan,
    reviewLoop,
    robustness,
    learningProfile
  });
  const researchBrief = buildDecisionResearchBrief({
    match,
    bestPick,
    action,
    summary,
    evidence,
    missingSignals,
    oddsIntelligence,
    dataCoverage,
    beliefState,
    deliberation,
    committee,
    monitoringPlan,
    actionability,
    reviewLoop,
    robustness,
    evaluationPlan,
    caseMemory,
    learningProfile
  });
  const notebook = buildDecisionNotebook({
    match,
    bestPick,
    action,
    missingSignals,
    abstentionRules,
    dataCoverage,
    beliefState,
    monitoringPlan,
    actionability,
    reviewLoop,
    robustness,
    evaluationPlan,
    caseMemory,
    researchBrief,
    learningProfile
  });
  const aiProtocol = buildDecisionAiProtocol({
    match,
    bestPick,
    action,
    risk: finalRisk,
    oddsIntelligence,
    marketMovement,
    probabilityTrace,
    attribution,
    uncertainty,
    decisionBoundary,
    dataCoverage,
    monitoringPlan,
    actionability,
    reviewLoop,
    robustness,
    saferAlternatives,
    caseMemory,
    learningProfile,
    abstentionRules,
    historicalDiscipline
  });
  const reasoningGraph = buildDecisionReasoningGraph({
    match,
    bestPick,
    action,
    decisionScore,
    probabilityTrace,
    oddsIntelligence,
    marketMovement,
    dataCoverage,
    attribution,
    uncertainty,
    decisionBoundary,
    actionability,
    reviewLoop,
    robustness,
    aiProtocol,
    caseMemory,
    historicalDiscipline
  });
  const toolOrchestration = buildDecisionToolOrchestrationPlan({
    match,
    bestPick,
    action,
    aiProtocol,
    dataCoverage,
    marketMovement,
    decisionBoundary,
    uncertainty,
    reasoningGraph,
    learningProfile,
    caseMemory,
    historicalDiscipline
  });
  const toolExecution = buildDecisionToolExecutionAudit({
    match,
    action,
    aiProtocol,
    toolOrchestration,
    learningProfile,
    caseMemory
  });
  const controlPolicy = buildDecisionControlPolicy({
    bestPick,
    action,
    actionability,
    reviewLoop,
    decisionBoundary,
    aiProtocol,
    reasoningGraph,
    toolOrchestration,
    toolExecution,
    dataCoverage,
    marketMovement,
    robustness,
    uncertainty,
    historicalDiscipline
  });

  return {
    engineVersion: DECISION_ENGINE_VERSION,
    verdict,
    action,
    confidence: finalConfidence,
    risk: finalRisk,
    decisionScore,
    recommendedSelection: action === "avoid" ? null : bestPick.hasValue ? bestPick.label : null,
    summary,
    health: calibration.health,
    calibration,
    probabilityCalibration,
    learningProfile,
    caseMemory,
    contextAdjustment,
    marketPriorAdjustment,
    agentStages,
    contradictionChecks,
    scenarioMatrix,
    beliefState,
    deliberation,
    committee,
    monitoringPlan,
    actionability,
    reviewLoop,
    researchBrief,
    notebook,
    probabilityTrace,
    attribution,
    uncertainty,
    decisionBoundary,
    aiProtocol,
    reasoningGraph,
    toolOrchestration,
    toolExecution,
    controlPolicy,
    oddsIntelligence,
    marketMovement,
    dataCoverage,
    historicalDiscipline,
    robustness,
    evaluationPlan,
    abstentionRules,
    factors,
    sensitivityChecks,
    publicReasoningSteps: [
      "Read fixture context, team strength, recent form, odds, and data quality.",
      `Audited data coverage: ${dataCoverage.summary}`,
      expectedScoreStep,
      dixonColesSignal
        ? `Applied Dixon-Coles low-score correction with rho ${dixonColesSignal.value.toFixed(4)} before deriving football winner, totals, BTTS, and scoreline probabilities.`
        : "No low-score dependence correction was needed for this sport model.",
      contextAdjustment
        ? `${contextAdjustment.summary} Missing context still tracked: ${
            contextAdjustment.missingSignals.length ? contextAdjustment.missingSignals.join(", ") : "none from the context adapter"
          }.`
        : "No structured context adapter was loaded for this match.",
      ...(coreContextSignal ? [`Core model context signal: ${coreContextSignal.label}: ${coreContextSignal.note}.`] : []),
      marketPriorAdjustment?.applied
        ? `Applied market prior to ${marketPriorAdjustment.adjustedMarkets} priced market${
            marketPriorAdjustment.adjustedMarkets === 1 ? "" : "s"
          } with average weight ${formatPercent(marketPriorAdjustment.averageWeight)} and average bookmaker margin ${formatPercent(
            marketPriorAdjustment.averageBookmakerMargin ?? 0
          )}.`
        : "Market prior was not applied because no priced bookmaker market matched the model output.",
      strongestEdges.length
        ? `Compared model probabilities with no-vig market probabilities and EV; strongest reviewed edges: ${strongestEdges
            .map((edge) => `${edge.label} ${formatSignedPercent(edge.edge)} edge, ${formatSignedPercent(edge.expectedValue)} EV`)
            .join(", ")}.`
        : "Compared model probabilities with no-vig market probabilities and EV; no positive edges were available.",
      `Ran odds intelligence: ${oddsIntelligence.summary}`,
      `Audited market movement: ${marketMovement.summary}`,
      bestPick.hasValue
        ? `Scored decision factors at ${decisionScore}; selected ${bestPick.label} only because edge and confidence passed the guardrail.`
        : "No pick selected because the guardrail rejected the market prices.",
      `Ran self-critique: ${contradictionChecks.filter((check) => check.status === "conflict").length} conflicts, ${
        contradictionChecks.filter((check) => check.status === "watch").length
      } watch items, ${abstentionRules.filter((rule) => rule.triggered).length} triggered abstention gates.`,
      `Calibrated reliability at ${calibration.reliabilityScore}/100 with ${calibration.health} health and ${calibration.action} action.`,
      `Updated belief state: ${beliefState.summary}`,
      `Fused probability evidence: ${probabilityTrace.summary}`,
      `Attributed decision drivers: ${attribution.summary}`,
      `Decomposed uncertainty: ${uncertainty.summary}`,
      `Mapped decision boundaries: ${decisionBoundary.summary}`,
      `Prepared AI protocol: ${aiProtocol.summary}`,
      `Linked reasoning graph: ${reasoningGraph.summary}`,
      `Planned tool orchestration: ${toolOrchestration.summary}`,
      `Audited tool execution: ${toolExecution.summary}`,
      `Applied control policy: ${controlPolicy.summary}`,
      `Synthesized deliberation: ${deliberation.synthesis}`,
      `Ran decision committee: ${committee.voteCounts.consider} consider, ${committee.voteCounts.monitor} monitor, ${committee.voteCounts.avoid} avoid; final action ${committee.recommendedAction} with ${committee.consensus} consensus.`,
      `Built monitoring plan: ${monitoringPlan.summary}`,
      `Audited actionability: ${actionability.summary}`,
      `Ran review loop: ${reviewLoop.summary}`,
      `Compiled research brief: ${researchBrief.headline} ${researchBrief.analystPosture}`,
      `Opened decision notebook: ${notebook.summary}`,
      `Stress-tested robustness: ${robustness.summary}`,
      `Registered evaluation plan: ${evaluationPlan.summary}`,
      `Compared with stored case memory: ${caseMemory.summary}`,
      learningProfile
        ? `Historical learning profile: ${learningProfile.status}; ${learningProfile.reason}`
        : "Historical learning profile was not loaded, so default guardrails remain active.",
      `Applied historical discipline: ${historicalDiscipline.summary} Instruction: ${historicalDiscipline.instruction}`,
      "Checked missing context such as confirmed lineups, injuries, weather, and live events before final verdict."
    ],
    evidence,
    risks: [
      ...risks,
      ...(historicalDiscipline.attached
        ? [
            historicalDiscipline.status === "market-prior-dominant"
              ? "10-year public history says market consensus is currently stronger than the raw model, so historical discipline caps raw value claims."
              : "Public historical evidence is diagnostic and cannot replace provider-enriched training data."
          ]
        : [])
    ],
    avoidReasons,
    saferAlternatives,
    missingSignals,
    nextChecks: [
      "Refresh bookmaker odds and recalculate no-vig market probabilities before showing a final value edge.",
      contextCheck,
      environmentCheck,
      `Re-check after ${new Date(beliefState.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}; this belief expires in ${beliefState.ttlMinutes} minutes.`,
      monitoringPlan.tasks[0]
        ? `${monitoringPlan.tasks[0].label} by ${new Date(monitoringPlan.tasks[0].dueAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })}; ${monitoringPlan.tasks[0].trigger}`
        : `Review monitoring plan by ${new Date(monitoringPlan.nextReviewAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`,
      ...actionability.requiredBeforeAction.slice(0, 2),
      ...researchBrief.requiredChecks.slice(0, 2),
      ...notebook.operatorChecklist.slice(0, 2).map((item) => `${item.label}: ${item.action}`),
      ...probabilityTrace.conflicts.slice(0, 2),
      ...attribution.negativeDrivers.slice(0, 2).map((driver) => `${driver.label}: ${driver.detail}`),
      ...uncertainty.mitigations.slice(0, 2),
      ...decisionBoundary.flipTriggers.slice(0, 2),
      ...aiProtocol.toolRequests
        .filter((tool) => tool.status === "missing")
        .slice(0, 2)
        .map((tool) => `${tool.label}: ${tool.reason}`),
      ...(toolOrchestration.nextTaskId
        ? [
            `Next tool task ${toolOrchestration.nextTaskId}: ${
              toolOrchestration.tasks.find((task) => task.id === toolOrchestration.nextTaskId)?.reason ?? toolOrchestration.summary
            }`
          ]
        : []),
      toolExecution.nextRun,
      `Control policy: ${controlPolicy.nextBestAction}`,
      ...toolOrchestration.blockingTasks.slice(0, 2).map((taskId) => {
        const task = toolOrchestration.tasks.find((item) => item.id === taskId);
        return task ? `${task.label}: ${task.reason}` : taskId;
      }),
      ...reasoningGraph.unresolvedNodes.slice(0, 2).map((nodeId) => {
        const node = reasoningGraph.nodes.find((item) => item.id === nodeId);
        return node ? `${node.label}: ${node.detail}` : nodeId;
      }),
      ...marketMovement.alerts.slice(0, 2),
      ...reviewLoop.releaseCriteria.slice(0, 2),
      ...robustness.requiredRechecks.slice(0, 2),
      ...dataCoverage.requiredBeforeTrust.slice(0, 2),
      ...evaluationPlan.requiredOutcomeSignals
        .filter((signal) => signal.status === "required")
        .slice(0, 2)
        .map((signal) => `${signal.label}: ${signal.detail}`),
      ...(learningProfile?.active ? [] : ["Import enough real historical fixtures and odds before learned thresholds tune live decisions."]),
      ...historicalDiscipline.requiredBeforePromotion.slice(0, 2),
      "Backtest this market against historical closing odds before raising confidence in production."
    ],
    llmEnhanced: false
  };
}
