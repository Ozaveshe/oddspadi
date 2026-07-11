import type { FootballModelDiagnostics, Match, MatchContextSignal, PredictionMarket, RiskLevel } from "@/lib/sports/types";
import { clampProbability } from "./odds";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function formScore(results: Array<"W" | "D" | "L">): number {
  return results.reduce((score, result) => score + (result === "W" ? 1 : result === "D" ? 0.5 : 0), 0) / Math.max(results.length, 1);
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
  return clamp(signal.weight * signal.confidence * signalQualityMultiplier(signal), 0, 0.055);
}

function tennisProviderContext(match: Match): {
  source: "provider-context" | "deterministic-proxy";
  signalCount: number;
  sideAdjustment: number;
  surfaceAdjustment: number;
  fitnessAdjustment: number;
  gamesAdjustment: number;
} {
  const signals = (match.providerContextSignals ?? []).filter((signal) =>
    ["surface", "injury", "news", "rest"].includes(signal.category)
  );

  if (!signals.length) {
    return {
      source: "deterministic-proxy",
      signalCount: 0,
      sideAdjustment: 0,
      surfaceAdjustment: 0,
      fitnessAdjustment: 0,
      gamesAdjustment: 0
    };
  }

  const surfaceAdjustment = signals
    .filter((signal) => signal.category === "surface")
    .reduce((sum, signal) => sum + sideValue(signal) * signalMagnitude(signal), 0);
  const fitnessAdjustment = signals
    .filter((signal) => signal.category === "injury" || signal.category === "news" || signal.category === "rest")
    .reduce((sum, signal) => sum + sideValue(signal) * signalMagnitude(signal) * 0.85, 0);
  const gamesAdjustment = signals.reduce((sum, signal) => {
    if (signal.impact === "tempo-up") return sum + signalMagnitude(signal) * 18;
    if (signal.impact === "tempo-down") return sum - signalMagnitude(signal) * 18;
    return sum;
  }, 0);

  return {
    source: "provider-context",
    signalCount: signals.length,
    sideAdjustment: Number(clamp(surfaceAdjustment + fitnessAdjustment, -0.075, 0.075).toFixed(4)),
    surfaceAdjustment: Number(clamp(surfaceAdjustment, -0.06, 0.06).toFixed(4)),
    fitnessAdjustment: Number(clamp(fitnessAdjustment, -0.055, 0.055).toFixed(4)),
    gamesAdjustment: Number(clamp(gamesAdjustment, -1.2, 1.2).toFixed(2))
  };
}

function tournamentRoundGamesAdjustment(roundName: string): number {
  if (/quarter[- ]?final|quarterfinal/i.test(roundName)) return 0.35;
  if (/semi[- ]?final|semifinal/i.test(roundName)) return 0.55;
  if (/(^|\s)final($|\s)/i.test(roundName)) return 0.75;
  if (/qual/i.test(roundName)) return -0.35;
  return 0;
}

function restLoadAdjustment(match: Match): number {
  const homeRest = match.homeTeam.ratingEvidence?.restDays;
  const awayRest = match.awayTeam.ratingEvidence?.restDays;
  if (typeof homeRest !== "number" || typeof awayRest !== "number") return 0;
  return Number(clamp((homeRest - awayRest) * 0.015, -0.06, 0.06).toFixed(4));
}

function uncertaintyFromDataQuality(dataQualityScore: number): RiskLevel {
  if (dataQualityScore >= 0.84) return "low";
  if (dataQualityScore >= 0.7) return "medium";
  return "high";
}

function gamesLine(match: Match): number {
  const market = match.oddsMarkets.find((item) => item.id === "total_games");
  const text = market?.selections.map((selection) => selection.label).join(" ") ?? "";
  const parsed = text.match(/\d+(?:\.\d+)?/)?.[0];
  return parsed ? Number(parsed) : 22.5;
}

export function modelTennisMatch(match: Match): { markets: PredictionMarket[]; diagnostics: FootballModelDiagnostics } {
  const homeEvidence = match.homeTeam.ratingEvidence;
  const awayEvidence = match.awayTeam.ratingEvidence;
  const rawEloAvailable = typeof homeEvidence?.rawRating === "number" && typeof awayEvidence?.rawRating === "number";
  const eloDiff = rawEloAvailable
    ? (homeEvidence.rawRating! - awayEvidence.rawRating!) / 165
    : (match.homeTeam.rating - match.awayTeam.rating) / 100;
  const storedFormAvailable = typeof homeEvidence?.recentFormPoints === "number" && typeof awayEvidence?.recentFormPoints === "number";
  const formDiff = storedFormAvailable
    ? clamp((homeEvidence.recentFormPoints! - awayEvidence.recentFormPoints!) / 10, -1, 1)
    : formScore(match.homeForm.recentResults) - formScore(match.awayForm.recentResults);
  const homeSurfaceStrength = homeEvidence?.attackStrength ?? match.homeForm.attackStrength;
  const awaySurfaceStrength = awayEvidence?.attackStrength ?? match.awayForm.attackStrength;
  const surfaceAdjustment = (homeSurfaceStrength - awaySurfaceStrength) * 0.18;
  const fatigueAdjustment = restLoadAdjustment(match);
  const roundGamesAdjustment = tournamentRoundGamesAdjustment(match.league.name);
  const h2hAdjustment = 0;
  const travelAdjustment = 0;
  const contextInputs = tennisProviderContext(match);
  const playerOneWin = clampProbability(
    logistic(
      eloDiff * 1.15 +
        formDiff * 0.9 +
        surfaceAdjustment +
        fatigueAdjustment +
        h2hAdjustment +
        travelAdjustment +
        contextInputs.sideAdjustment
    )
  );
  const playerTwoWin = clampProbability(1 - playerOneWin);
  const dominance = Math.abs(playerOneWin - 0.5);
  const playerOneSetHandicap = clampProbability(playerOneWin + dominance * 0.28 - 0.12);
  const playerTwoSetHandicap = clampProbability(1 - playerOneSetHandicap);
  const expectedGames = clamp(
    22.6 + (0.5 - dominance) * 7 + Math.abs(formDiff) * 1.2 + roundGamesAdjustment + contextInputs.gamesAdjustment,
    18,
    29
  );
  const totalGamesLine = gamesLine(match);
  const overGames = clampProbability(logistic((expectedGames - totalGamesLine) / 2.6));
  const underGames = clampProbability(1 - overGames);
  const expectedSetsOne = Number((1.1 + playerOneWin * 0.95).toFixed(2));
  const expectedSetsTwo = Number((1.1 + playerTwoWin * 0.95).toFixed(2));

  return {
    diagnostics: {
      modelVersion: "tennis-surface-elo-v3",
      scoreUnit: "sets",
      expectedScoreLabel: `${match.homeTeam.name} ${expectedSetsOne.toFixed(2)} - ${match.awayTeam.name} ${expectedSetsTwo.toFixed(2)} expected sets`,
      topOutcomeLabel: `Surface-adjusted win probability ${Math.round(playerOneWin * 100)}%-${Math.round(playerTwoWin * 100)}%; projected games ${expectedGames.toFixed(1)}.`,
      expectedGoals: {
        home: expectedSetsOne,
        away: expectedSetsTwo,
        total: Number((expectedSetsOne + expectedSetsTwo).toFixed(2))
      },
      topCorrectScores: [
        { homeGoals: playerOneWin >= playerTwoWin ? 2 : 1, awayGoals: playerOneWin >= playerTwoWin ? 1 : 2, probability: 0.25 },
        { homeGoals: playerOneWin >= playerTwoWin ? 2 : 0, awayGoals: playerOneWin >= playerTwoWin ? 0 : 2, probability: 0.19 },
        { homeGoals: 1, awayGoals: 1, probability: 0.12 }
      ],
      homeDrawAwayTotal: Number((playerOneWin + playerTwoWin).toFixed(6)),
      dataQualityScore: match.dataQualityScore,
      uncertainty: uncertaintyFromDataQuality(match.dataQualityScore),
      signalScores: [
        {
          label: "Player Elo edge",
          value: Number((eloDiff * 100).toFixed(1)),
          note: rawEloAvailable
            ? `Scaled from stored pre-match Elo (${homeEvidence.rawRating?.toFixed(1)} vs ${awayEvidence.rawRating?.toFixed(1)}).`
            : "Fallback model-rating edge; stored player Elo was unavailable."
        },
        {
          label: "Surface rating edge",
          value: Number(surfaceAdjustment.toFixed(3)),
          note:
            homeEvidence?.source.includes("surface") || awayEvidence?.source.includes("surface")
              ? `Stored surface-specific strength for ${homeEvidence?.surface ?? "unknown"} conditions.`
              : "Surface-specific stored strength was unavailable; fallback strength fields were used."
        },
        {
          label: "Recent form edge",
          value: Number(formDiff.toFixed(3)),
          note: storedFormAvailable ? "Computed from stored pre-match rolling form points." : "Fallback recent result form."
        },
        { label: "Fatigue adjustment", value: Number(fatigueAdjustment.toFixed(3)), note: "Computed only from stored schedule-derived rest days; zero means rest evidence was unavailable or balanced." },
        {
          label: "Head-to-head adjustment",
          value: h2hAdjustment,
          note: "No head-to-head adjustment is applied until verified matchup history is connected."
        },
        {
          label: "Travel/load adjustment",
          value: travelAdjustment,
          note: "No travel adjustment is applied until verified travel/location evidence is connected."
        },
        {
          label: "Tournament round games adjustment",
          value: roundGamesAdjustment,
          note: "Tournament round changes projected match length only; it never creates an arbitrary player-one side bias."
        },
        {
          label: "Provider tennis context adjustment",
          value: contextInputs.sideAdjustment,
          note:
            contextInputs.source === "provider-context"
              ? `Core tennis projection consumed ${contextInputs.signalCount} provider/context surface, fitness, injury, rest, or news signal(s). Surface ${contextInputs.surfaceAdjustment}; fitness ${contextInputs.fitnessAdjustment}.`
              : "Core tennis projection used stored player features where available and applied no fabricated head-to-head or travel adjustment."
        }
      ],
      calibrationNotes: [
        "Tennis model uses stored pre-match Elo, surface-specific strength, rolling form, schedule-derived rest, tournament-round match-length pressure, and current provider context when attached.",
        "Set handicap and total-games probabilities are derived from win dominance and projected games.",
        contextInputs.source === "provider-context"
          ? "Provider/context surface, fitness, injury, rest, or news signals were consumed inside the core tennis probability and games projection before market comparison."
          : "Head-to-head, travel, retirement risk, and injury/news effects remain zero until verified evidence is connected."
      ]
    },
    markets: [
      { marketId: "match_winner", probabilities: { home: playerOneWin, away: playerTwoWin } },
      { marketId: "set_handicap", probabilities: { home_sets: playerOneSetHandicap, away_sets: playerTwoSetHandicap } },
      { marketId: "total_games", probabilities: { over: overGames, under: underGames } }
    ]
  };
}
