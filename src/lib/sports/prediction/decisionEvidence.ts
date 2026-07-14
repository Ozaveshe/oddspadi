import type {
  BestPickResult,
  DecisionEvidence,
  FootballModelDiagnostics,
  Match,
  MatchContextAdjustment,
  MatchContextSignal,
  PredictionMarket
} from "@/lib/sports/types";
import { formatPercent, formatSignedPercent } from "./format";

function winnerProbabilities(markets: PredictionMarket[]) {
  return markets.find((market) => market.marketId === "match_winner")?.probabilities ?? {};
}

function contextEvidenceCategory(signal: MatchContextSignal): DecisionEvidence["category"] {
  if (signal.category === "lineup") return "lineups";
  if (signal.category === "player-form") return "form";
  if (signal.category === "weather" || signal.category === "surface") return "weather";
  if (signal.category === "live-event") return "live-state";
  if (signal.category === "injury" || signal.category === "suspension" || signal.category === "news" || signal.category === "rest") return "team-news";
  return "model";
}

function contextEvidenceImpact(signal: MatchContextSignal): DecisionEvidence["impact"] {
  if (signal.impact === "home-positive" || signal.impact === "away-positive" || signal.impact === "tempo-up") return "positive";
  if (signal.impact === "home-negative" || signal.impact === "away-negative" || signal.impact === "tempo-down") return "negative";
  if (signal.impact === "unknown") return "unknown";
  return "neutral";
}

function contextSummaryQuality(adjustment: MatchContextAdjustment): DecisionEvidence["quality"] {
  if (adjustment.signals.some((signal) => signal.quality === "strong")) return "strong";
  if (adjustment.signals.some((signal) => signal.quality === "acceptable")) return "acceptable";
  if (adjustment.signals.length) return "thin";
  return "missing";
}

export function findCoreModelContextSignal(diagnostics: FootballModelDiagnostics): FootballModelDiagnostics["signalScores"][number] | null {
  return (
    diagnostics.signalScores.find(
      (signal) =>
        signal.label === "Provider football context xG" ||
        signal.label === "Basketball context source" ||
        signal.label === "Provider tennis context adjustment"
    ) ?? null
  );
}

function coreModelContextEvidence(diagnostics: FootballModelDiagnostics): DecisionEvidence | null {
  const signal = findCoreModelContextSignal(diagnostics);
  if (!signal) return null;

  const note = signal.note.toLowerCase();
  const providerBacked = note.includes("provider/context") || note.includes("consumed");
  const fallbackBacked = note.includes("deterministic") || note.includes("not attached");

  return {
    category: "model",
    label: "Core model context adjustment",
    quality: providerBacked ? "acceptable" : fallbackBacked ? "thin" : "acceptable",
    impact: Math.abs(signal.value) > 0.0001 ? (signal.value > 0 ? "positive" : "negative") : "neutral",
    detail: `${signal.label}: ${signal.note}`
  };
}

export function hasLiveInPlayModel(match: Match, diagnostics: FootballModelDiagnostics): boolean {
  if (match.status !== "live") return false;
  if (match.sport !== "football") return false;
  return diagnostics.signalScores.some((signal) => signal.label === "Live in-play Poisson");
}

function liveStateDetail(match: Match, diagnostics: FootballModelDiagnostics): string {
  if (!match.score) return "Match is live, but no live event stream is connected.";
  if (match.sport === "basketball") {
    return `Live score is ${match.score.home}-${match.score.away}; possession, foul, timeout, lineup, and clock-adjusted pace data are not connected.`;
  }
  if (match.sport === "tennis") {
    return `Live score snapshot is ${match.score.home}-${match.score.away}; set, game, serve, break-point, and retirement-risk data are not connected.`;
  }
  return hasLiveInPlayModel(match, diagnostics)
    ? `Live score is ${match.score.home}-${match.score.away} at ${match.score.minute ?? "unknown"} minutes; score/minute Poisson recalibration is active.`
    : `Live score is ${match.score.home}-${match.score.away} at ${match.score.minute ?? "unknown"} minutes; in-play recalibration is not active yet.`;
}

/** Builds the traceable evidence ledger consumed by the decision report. */
export function buildDecisionEvidence({
  match,
  markets,
  diagnostics,
  bestPick,
  contextAdjustment
}: {
  match: Match;
  markets: PredictionMarket[];
  diagnostics: FootballModelDiagnostics;
  bestPick: BestPickResult;
  contextAdjustment?: MatchContextAdjustment;
}): DecisionEvidence[] {
  const winner = winnerProbabilities(markets);
  const scoreline = diagnostics.topCorrectScores[0];
  const scoreUnit = diagnostics.scoreUnit ?? "goals";
  const expectedLabel =
    diagnostics.expectedScoreLabel ??
    `${match.homeTeam.name} expected ${scoreUnit} ${diagnostics.expectedGoals.home.toFixed(2)}, ${match.awayTeam.name} expected ${scoreUnit} ${diagnostics.expectedGoals.away.toFixed(
      2
    )}`;
  const topOutcome = diagnostics.topOutcomeLabel ?? `top scoreline ${scoreline?.homeGoals ?? 0}-${scoreline?.awayGoals ?? 0}`;
  const evidence: DecisionEvidence[] = [
    {
      category: "model",
      label:
        match.sport === "football"
          ? "Poisson expected-goals model"
          : match.sport === "basketball"
            ? "Basketball efficiency model"
            : match.sport === "tennis"
              ? "Tennis Elo and surface model"
              : "Sport model",
      quality: "acceptable",
      impact: bestPick.hasValue ? "positive" : "neutral",
      detail: `${expectedLabel}; ${topOutcome}.`
    },
    {
      category: "market",
      label: "No-vig market probability comparison",
      quality: bestPick.hasValue ? "acceptable" : "thin",
      impact: bestPick.hasValue ? "positive" : "neutral",
      detail: bestPick.hasValue
        ? `${bestPick.label} has ${formatPercent(bestPick.modelProbability)} model probability versus ${formatPercent(
            bestPick.noVigImpliedProbability
          )} no-vig implied probability. Raw implied is ${formatPercent(bestPick.rawImpliedProbability)} and market margin is ${formatSignedPercent(
            bestPick.bookmakerMargin
          )}. Expected value is ${formatSignedPercent(bestPick.expectedValue)} per unit.`
        : "No market selection passed the positive-edge and confidence threshold."
    },
    {
      category: "form",
      label: "Recent form signal",
      quality: "acceptable",
      impact: "neutral",
      detail: `${match.homeTeam.name}: ${match.homeForm.recentResults.join("-")}; ${match.awayTeam.name}: ${match.awayForm.recentResults.join("-")}.`
    },
    {
      category: "data-quality",
      label: "Data quality guardrail",
      quality: diagnostics.dataQualityScore >= 0.78 ? "strong" : diagnostics.dataQualityScore >= 0.64 ? "acceptable" : "thin",
      impact: diagnostics.dataQualityScore >= 0.7 ? "neutral" : "negative",
      detail: `Data quality is ${formatPercent(diagnostics.dataQualityScore)}; low quality downgrades confidence.`
    },
    {
      category: "team-news",
      label:
        match.sport === "basketball"
          ? "Injuries and rest news"
          : match.sport === "tennis"
            ? "Player fitness news"
            : "Injury and suspension news",
      quality: "missing",
      impact: "unknown",
      detail:
        match.sport === "basketball"
          ? "No live injury, minutes-limit, or rest-day provider is connected yet."
          : match.sport === "tennis"
            ? "No live player fitness, fatigue, or retirement-risk provider is connected yet."
            : "No live injury/suspension provider is connected yet."
    },
    {
      category: "lineups",
      label: match.sport === "tennis" ? "Confirmed match context" : "Confirmed lineups",
      quality: "missing",
      impact: "unknown",
      detail:
        match.sport === "tennis"
          ? "Surface-specific conditions, draw context, and player status are not provider-backed yet."
          : "Lineups are not available in the MVP mock provider."
    },
    {
      category: "weather",
      label: "Weather check",
      quality: "missing",
      impact: "unknown",
      detail:
        match.sport === "tennis"
          ? "Weather and court-speed context are not connected yet; relevant for outdoor tennis totals."
          : "Weather is not connected yet; relevant for outdoor football totals and tempo."
    }
  ];
  const coreContextEvidence = coreModelContextEvidence(diagnostics);
  if (coreContextEvidence) evidence.push(coreContextEvidence);

  if (match.sport === "basketball") {
    const weatherIndex = evidence.findIndex((item) => item.category === "weather");
    if (weatherIndex >= 0) evidence.splice(weatherIndex, 1);
  }

  if (contextAdjustment?.signals.length) {
    const coveredCategories = new Set(contextAdjustment.signals.map((signal) => contextEvidenceCategory(signal)));
    for (let index = evidence.length - 1; index >= 0; index -= 1) {
      if (evidence[index].quality === "missing" && coveredCategories.has(evidence[index].category)) evidence.splice(index, 1);
    }

    evidence.push({
      category: "model",
      label: "Context signal adjustment",
      quality: contextSummaryQuality(contextAdjustment),
      impact: contextAdjustment.applied ? "positive" : "neutral",
      detail: `${contextAdjustment.summary} Side shift home ${formatSignedPercent(contextAdjustment.probabilityShift.home)}, away ${formatSignedPercent(
        contextAdjustment.probabilityShift.away
      )}; total shift ${formatSignedPercent(contextAdjustment.totalShift)}.`
    });

    for (const signal of contextAdjustment.signals.slice(0, 6)) {
      evidence.push({
        category: contextEvidenceCategory(signal),
        label: signal.label,
        quality: signal.quality,
        impact: contextEvidenceImpact(signal),
        detail: `${signal.detail} Source: ${signal.source}; confidence ${formatPercent(signal.confidence)}.`
      });
    }
  }

  if (match.status === "live") {
    const liveInPlayModel = hasLiveInPlayModel(match, diagnostics);
    evidence.push({
      category: "live-state",
      label: "Live score state",
      quality: liveInPlayModel ? "acceptable" : "thin",
      impact: "unknown",
      detail: liveStateDetail(match, diagnostics)
    });
  }

  const probabilityTotal =
    match.sport === "football" ? (winner.home ?? 0) + (winner.draw ?? 0) + (winner.away ?? 0) : (winner.home ?? 0) + (winner.away ?? 0);
  if (probabilityTotal < 0.99) {
    evidence.push({
      category: "model",
      label: "Probability normalization check",
      quality: "thin",
      impact: "negative",
      detail: match.sport === "football" ? "Home/draw/away probabilities did not sum close to 1." : "Winner probabilities did not sum close to 1."
    });
  }

  return evidence;
}
