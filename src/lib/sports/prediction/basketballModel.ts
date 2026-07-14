import type { FootballModelDiagnostics, Match, MatchContextSignal, PredictionMarket, RiskLevel } from "@/lib/sports/types";
import { clampProbability } from "./odds";
import { runtimeModelKey } from "./modelIdentity";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function formScore(results: Array<"W" | "D" | "L">): number {
  return results.reduce((score, result) => score + (result === "W" ? 1 : result === "D" ? 0.5 : 0), 0) / Math.max(results.length, 1);
}

function seedFromText(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function signalQualityMultiplier(signal: MatchContextSignal): number {
  if (signal.quality === "strong") return 1.2;
  if (signal.quality === "acceptable") return 1;
  if (signal.quality === "thin") return 0.62;
  return 0;
}

function sideValue(signal: MatchContextSignal): number {
  if (signal.impact === "home-positive" || signal.impact === "away-negative") return 1;
  if (signal.impact === "away-positive" || signal.impact === "home-negative") return -1;
  return 0;
}

function signalMagnitude(signal: MatchContextSignal): number {
  return clamp(signal.weight * signal.confidence * signalQualityMultiplier(signal), 0, 0.05);
}

function penaltyFromSignals(signals: MatchContextSignal[], impacts: MatchContextSignal["impact"][]): number {
  return signals
    .filter((signal) => impacts.includes(signal.impact))
    .reduce((sum, signal) => sum + signalMagnitude(signal) * 92, 0);
}

function tempoAdjustmentFromSignals(signals: MatchContextSignal[]): number {
  return signals.reduce((sum, signal) => {
    if (signal.impact === "tempo-up") return sum + signalMagnitude(signal) * 68;
    if (signal.impact === "tempo-down") return sum - signalMagnitude(signal) * 68;
    return sum;
  }, 0);
}

function restEdgeDaysFromSignals(signals: MatchContextSignal[]): { homeRestDays: number; awayRestDays: number } {
  const restSignals = signals.filter((signal) => signal.category === "rest");
  const homeEdge = restSignals.some((signal) => signal.impact === "home-positive" || signal.impact === "away-negative");
  const awayEdge = restSignals.some((signal) => signal.impact === "away-positive" || signal.impact === "home-negative");
  const joined = restSignals.map((signal) => signal.detail).join(" ").toLowerCase();
  const numeric = joined.match(/(\d+)\s+(?:extra\s+)?rest\s+days?/)?.[1];
  const wordNumber = joined.includes("three") ? 3 : joined.includes("two") ? 2 : joined.includes("one") ? 1 : null;
  const edgeDays = clamp(Number(numeric ?? wordNumber ?? 1), 1, 4);

  if (homeEdge && !awayEdge) return { homeRestDays: 1 + edgeDays, awayRestDays: 1 };
  if (awayEdge && !homeEdge) return { homeRestDays: 1, awayRestDays: 1 + edgeDays };
  return { homeRestDays: 2, awayRestDays: 2 };
}

function marketLine(match: Match, marketId: "spread" | "total_points", fallback: number): number {
  const market = match.oddsMarkets.find((item) => item.id === marketId);
  const text = market?.selections.map((selection) => selection.label).join(" ") ?? "";
  const parsed = text.match(/[-+]?\d+(?:\.\d+)?/)?.[0];
  return parsed ? Math.abs(Number(parsed)) : fallback;
}

function basketballContextInputs(match: Match) {
  const providerSignals = (match.providerContextSignals ?? []).filter((signal) =>
    ["rest", "injury", "suspension", "lineup", "news"].includes(signal.category)
  );

  const homeStoredRest = match.homeTeam.ratingEvidence?.restDays;
  const awayStoredRest = match.awayTeam.ratingEvidence?.restDays;
  const hasStoredRest = typeof homeStoredRest === "number" && typeof awayStoredRest === "number";

  if (providerSignals.length || hasStoredRest) {
    const restSignals = providerSignals.filter((signal) => signal.category === "rest");
    const restSignalEdge = restSignals.reduce((sum, signal) => sum + sideValue(signal) * signalMagnitude(signal) * 94, 0);
    const signalRest = restEdgeDaysFromSignals(restSignals);
    const homeRestDays = hasStoredRest ? homeStoredRest : signalRest.homeRestDays;
    const awayRestDays = hasStoredRest ? awayStoredRest : signalRest.awayRestDays;
    const homeAvailabilityPenalty = penaltyFromSignals(providerSignals, ["home-negative", "away-positive"]);
    const awayAvailabilityPenalty = penaltyFromSignals(providerSignals, ["away-negative", "home-positive"]);
    const availabilityAdjustment = clamp(awayAvailabilityPenalty - homeAvailabilityPenalty, -2.45, 2.45);
    const restAdjustment = clamp(restSignalEdge || (homeRestDays - awayRestDays) * 0.8, -2.7, 2.7);
    const availabilityDrag = -clamp(homeAvailabilityPenalty + awayAvailabilityPenalty, 0, 3.4) * 0.58;
    const totalAdjustment = Number((availabilityDrag + tempoAdjustmentFromSignals(providerSignals)).toFixed(2));

    return {
      source: hasStoredRest ? ("stored-features" as const) : ("provider-context" as const),
      homeRestDays,
      awayRestDays,
      restAdjustment,
      availabilityAdjustment,
      totalAdjustment,
      homeAvailabilityPenalty: Number(homeAvailabilityPenalty.toFixed(2)),
      awayAvailabilityPenalty: Number(awayAvailabilityPenalty.toFixed(2)),
      signalCount: providerSignals.length
    };
  }

  if (match.dataSource?.kind === "provider") {
    return {
      source: "missing-provider-context" as const,
      homeRestDays: 0,
      awayRestDays: 0,
      restAdjustment: 0,
      availabilityAdjustment: 0,
      totalAdjustment: 0,
      homeAvailabilityPenalty: 0,
      awayAvailabilityPenalty: 0,
      signalCount: 0
    };
  }

  const seed = seedFromText(match.id);
  const homeRestDays = 1 + (seed % 4);
  const awayRestDays = 1 + (Math.floor(seed / 5) % 4);
  const restAdjustment = clamp((homeRestDays - awayRestDays) * 0.85, -2.55, 2.55);
  const homeAvailabilityPenalty = seed % 4 === 0 ? 1.8 : seed % 7 === 0 ? 0.9 : 0;
  const awayAvailabilityPenalty = seed % 3 === 0 ? 1.8 : seed % 8 === 0 ? 0.9 : 0;
  const availabilityAdjustment = clamp(awayAvailabilityPenalty - homeAvailabilityPenalty, -2.2, 2.2);
  const totalAvailabilityDrag = -clamp(homeAvailabilityPenalty + awayAvailabilityPenalty, 0, 3.2) * 0.72;
  const restTempoAdjustment = clamp((homeRestDays + awayRestDays - 4) * 0.42, -1.1, 1.35);

  return {
    source: "deterministic-proxy" as const,
    homeRestDays,
    awayRestDays,
    restAdjustment,
    availabilityAdjustment,
    totalAdjustment: Number((totalAvailabilityDrag + restTempoAdjustment).toFixed(2)),
    homeAvailabilityPenalty,
    awayAvailabilityPenalty,
    signalCount: 0
  };
}

function uncertaintyFromDataQuality(dataQualityScore: number): RiskLevel {
  if (dataQualityScore >= 0.82) return "low";
  if (dataQualityScore >= 0.68) return "medium";
  return "high";
}

export function modelBasketballMatch(match: Match): { markets: PredictionMarket[]; diagnostics: FootballModelDiagnostics } {
  const ratingDiff = match.homeTeam.rating - match.awayTeam.rating;
  const homeEvidence = match.homeTeam.ratingEvidence;
  const awayEvidence = match.awayTeam.ratingEvidence;
  const storedFormAvailable = typeof homeEvidence?.recentFormPoints === "number" && typeof awayEvidence?.recentFormPoints === "number";
  const formDiff = storedFormAvailable
    ? clamp((homeEvidence.recentFormPoints! - awayEvidence.recentFormPoints!) / 10, -1, 1)
    : formScore(match.homeForm.recentResults) - formScore(match.awayForm.recentResults);
  const homeOffense = homeEvidence?.offensiveEfficiency ?? 104 + match.homeForm.attackStrength * 10 + match.homeForm.goalsFor * 1.8;
  const awayOffense = awayEvidence?.offensiveEfficiency ?? 104 + match.awayForm.attackStrength * 10 + match.awayForm.goalsFor * 1.8;
  const homeDefense = homeEvidence?.defensiveEfficiency ?? 110 - match.homeForm.defenseStrength * 7 - match.homeForm.goalsAgainst * 1.4;
  const awayDefense = awayEvidence?.defensiveEfficiency ?? 110 - match.awayForm.defenseStrength * 7 - match.awayForm.goalsAgainst * 1.4;
  const storedPaces = [homeEvidence?.pace, awayEvidence?.pace].filter((value): value is number => typeof value === "number");
  const pace = clamp(
    storedPaces.length
      ? storedPaces.reduce((sum, value) => sum + value, 0) / storedPaces.length
      : 96 + (match.league.strength - 0.7) * 7 + ((match.homeTeam.rating + match.awayTeam.rating) - 150) * 0.05,
    88,
    104
  );
  const homeScoringEfficiency = (homeOffense + awayDefense) / 2;
  const awayScoringEfficiency = (awayOffense + homeDefense) / 2;
  const efficiencyMargin = (homeScoringEfficiency - awayScoringEfficiency) * (pace / 100);
  const homeAdvantage = 2.6;
  const contextInputs = basketballContextInputs(match);
  const expectedMargin = clamp(
    efficiencyMargin * 0.62 + ratingDiff * 0.28 + formDiff * 2.2 + homeAdvantage + contextInputs.restAdjustment + contextInputs.availabilityAdjustment,
    -24,
    24
  );
  const totalLine = marketLine(match, "total_points", 218.5);
  const spreadLine = marketLine(match, "spread", Math.abs(expectedMargin));
  const expectedTotal = clamp(
    (homeScoringEfficiency + awayScoringEfficiency) * (pace / 100) + contextInputs.totalAdjustment,
    188,
    246
  );
  const homePoints = Number(((expectedTotal + expectedMargin) / 2).toFixed(1));
  const awayPoints = Number(((expectedTotal - expectedMargin) / 2).toFixed(1));
  const homeWin = clampProbability(logistic(expectedMargin / 7.2));
  const awayWin = clampProbability(1 - homeWin);
  const homeCover = clampProbability(logistic((expectedMargin - spreadLine) / 6.5));
  const awayCover = clampProbability(1 - homeCover);
  const over = clampProbability(logistic((expectedTotal - totalLine) / 11.5));
  const under = clampProbability(1 - over);

  return {
    diagnostics: {
      modelVersion: runtimeModelKey("basketball"),
      scoreUnit: "points",
      expectedScoreLabel: `${match.homeTeam.name} ${homePoints.toFixed(1)} - ${match.awayTeam.name} ${awayPoints.toFixed(1)} projected points`,
      topOutcomeLabel: `Projected margin ${expectedMargin.toFixed(1)}; pace ${pace.toFixed(1)} possessions.`,
      expectedGoals: {
        home: homePoints,
        away: awayPoints,
        total: Number(expectedTotal.toFixed(1))
      },
      topCorrectScores: [
        { homeGoals: Math.round(homePoints), awayGoals: Math.round(awayPoints), probability: 0.12 },
        { homeGoals: Math.round(homePoints + 3), awayGoals: Math.round(awayPoints - 2), probability: 0.09 },
        { homeGoals: Math.round(homePoints - 2), awayGoals: Math.round(awayPoints + 3), probability: 0.08 }
      ],
      homeDrawAwayTotal: Number((homeWin + awayWin).toFixed(6)),
      dataQualityScore: match.dataQualityScore,
      uncertainty: uncertaintyFromDataQuality(match.dataQualityScore),
      signalScores: [
        { label: "Team rating margin", value: Number(expectedMargin.toFixed(2)), note: "Projected points margin after rating, form, and home-court factors." },
        { label: "Pace", value: Number(pace.toFixed(1)), note: "Higher pace increases total-points variance and over/under sensitivity." },
        {
          label: "Offensive efficiency edge",
          value: Number((homeOffense - awayOffense).toFixed(2)),
          note:
            typeof homeEvidence?.offensiveEfficiency === "number" && typeof awayEvidence?.offensiveEfficiency === "number"
              ? `Stored pre-match offensive efficiency from ${homeEvidence.source} and ${awayEvidence.source}.`
              : "Fallback estimate from attack strength and recent scoring."
        },
        { label: "Total line gap", value: Number((expectedTotal - totalLine).toFixed(2)), note: "Positive values lean over the posted total." },
        {
          label: "Rest-day margin",
          value: Number(contextInputs.restAdjustment.toFixed(2)),
          note: `${match.homeTeam.name} rest ${contextInputs.homeRestDays} day(s), ${match.awayTeam.name} rest ${contextInputs.awayRestDays} day(s); positive favors home cover and moneyline.`
        },
        {
          label: "Availability margin",
          value: Number(contextInputs.availabilityAdjustment.toFixed(2)),
          note: `Availability proxy: home penalty ${contextInputs.homeAvailabilityPenalty.toFixed(1)}, away penalty ${contextInputs.awayAvailabilityPenalty.toFixed(
            1
          )}; positive favors home.`
        },
        {
          label: "Rotation total adjustment",
          value: contextInputs.totalAdjustment,
          note: "Rest and availability adjust total-points expectation before comparing with the posted total."
        },
        {
          label: "Basketball context source",
          value: contextInputs.signalCount,
          note:
            contextInputs.source === "stored-features"
              ? `Core basketball projection consumed stored pre-match rest evidence (${contextInputs.homeRestDays}-${contextInputs.awayRestDays} days) plus ${contextInputs.signalCount} current context signal(s).`
              : contextInputs.source === "provider-context"
                ? `Core basketball projection consumed ${contextInputs.signalCount} provider/context rest, injury, lineup, or news signal(s).`
                : contextInputs.source === "missing-provider-context"
                  ? "Provider fixture has no verified rest or availability evidence; the model applied no fabricated adjustment."
                  : "Preview fixture used deterministic rest and availability proxies."
        }
      ],
      calibrationNotes: [
        "Basketball MVP model uses rating margin, pace, offensive efficiency, defensive resistance, form, home court, rest days, and availability context.",
        "Spread probability is estimated with a logistic margin model around the posted line.",
        contextInputs.source === "stored-features"
          ? "Stored schedule-derived rest, Elo, pace, and efficiency features were consumed inside the core basketball projection; current injuries and rotations remain separate missing evidence."
          : contextInputs.source === "provider-context"
            ? "Provider/context rest and availability signals were consumed inside the core basketball margin and total projection before market comparison."
            : contextInputs.source === "missing-provider-context"
              ? "No rest or availability adjustment was applied because this provider fixture lacks verified current evidence."
              : "Preview-only fixtures use deterministic rest and availability proxies."
      ]
    },
    markets: [
      { marketId: "match_winner", probabilities: { home: homeWin, away: awayWin } },
      { marketId: "spread", probabilities: { home_cover: homeCover, away_cover: awayCover } },
      { marketId: "total_points", probabilities: { over: over, under } }
    ]
  };
}
