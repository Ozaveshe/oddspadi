import { DECISION_ENGINE_VERSION } from "@/lib/sports/prediction/decisionEngine";
import { confidenceFromEdgeAndProbability } from "@/lib/sports/prediction/confidence";
import { modelBasketballMatch } from "@/lib/sports/prediction/basketballModel";
import { decisionModelIdentity, runtimeModelIdentityReceipt } from "@/lib/sports/prediction/modelIdentity";
import { applyMarketPriorAdjustmentToMarkets } from "@/lib/sports/prediction/odds";
import {
  learnMarketPriorScalingPolicy,
  marketPriorPolicyValidationRows,
  type MarketPriorScalingObservation
} from "@/lib/sports/prediction/marketPriorScaling";
import { tennisModelRatingFromElo } from "@/lib/sports/prediction/historicalTennisStrength";
import { modelTennisMatch } from "@/lib/sports/prediction/tennisModel";
import {
  applyProbabilityTemperaturePolicy,
  buildProbabilityCalibrationComparison,
  learnProbabilityTemperaturePolicy,
  probabilityPolicyValidationRows,
  strictChronologicalSplitIndex
} from "@/lib/sports/prediction/probabilityTemperatureScaling";
import type {
  Match,
  MarketPriorAdjustment,
  MarketPriorScalingPolicy,
  OddsMarket,
  ProbabilityCalibrationComparison,
  ProbabilityTemperatureScalingPolicy
} from "@/lib/sports/types";
import type { HistoricalBasketballFixture, HistoricalBasketballOddsQuote } from "./basketballBacktest";
import { buildProbabilityCalibration, type ProbabilityCalibrationBucket } from "./probabilityCalibration";
import {
  buildMarketPriorReplayEvidence,
  type MarketPriorReplayEvidence
} from "./marketPriorReplayEvidence";
import type { HistoricalTennisMatch, HistoricalTennisOddsQuote } from "./tennisBacktest";
import {
  applyEconomicSelectionPolicy,
  applyMinimumEdgeToResults,
  buildEconomicSelectionComparison,
  learnEconomicSelectionPolicy,
  type EconomicSelectionComparison,
  type EconomicSelectionPolicy
} from "./economicSelectionPolicy";

type RuntimeReplaySport = "basketball" | "tennis";
type TwoWayOutcome = "home" | "away";
type Confidence = "low" | "medium" | "high";

export type TwoWayRuntimeReplayConfig = {
  trainRatio?: number;
  minEdge?: number;
  minModelProbability?: number;
  minPriorMatches?: number;
};

type ResolvedConfig = Required<TwoWayRuntimeReplayConfig>;

export type TwoWayRuntimeReplayPick = {
  selection: TwoWayOutcome;
  modelProbability: number;
  impliedProbability: number;
  edge: number;
  odds: number;
  closingOdds: number | null;
  confidence: Confidence;
  won: boolean;
  unitReturn: number;
  closingLineValue: number | null;
};

export type TwoWayRuntimeReplayFixtureResult = {
  fixtureExternalId: string;
  kickoffAt: string;
  actualOutcome: TwoWayOutcome;
  probabilities: Record<TwoWayOutcome, number>;
  brierScore: number;
  logLoss: number;
  pick: TwoWayRuntimeReplayPick | null;
};

export type TwoWayRuntimeFeatureContract = {
  status: "passed" | "failed";
  version: string;
  chronologyVersion: string;
  sourceFixtures: number;
  eligibleFixtures: number;
  rejectedFixtures: number;
  trainingEvaluatedFixtures: number;
  trainingEntrypointInvocations: number;
  evaluatedFixtures: number;
  entrypointInvocations: number;
  optionalCoverage: {
    completeOddsFixtures: number;
    surfaceFixtures: number;
    restFixtures: number;
  };
  rejectionReasons: Record<string, number>;
};

export type TwoWayRuntimeReplayResult = {
  sport: RuntimeReplaySport;
  modelKey: string;
  engineVersion: string;
  generatedAt: string;
  status: "completed" | "no-data";
  sampleSize: number;
  trainSize: number;
  testSize: number;
  pickCount: number;
  windowStart: string | null;
  windowEnd: string | null;
  trainWindowStart: string | null;
  trainWindowEnd: string | null;
  testWindowStart: string | null;
  testWindowEnd: string | null;
  brierScore: number | null;
  logLoss: number | null;
  roiUnits: number;
  yield: number | null;
  averageEdge: number | null;
  closingLineValue: number | null;
  calibrationError: number | null;
  calibrationBuckets: ProbabilityCalibrationBucket[];
  marketBreakdown: Record<string, RuntimeReplayBreakdown>;
  confidenceBreakdown: Record<string, RuntimeReplayBreakdown>;
  learnedWeights: Record<string, number>;
  selectionPolicy: EconomicSelectionPolicy;
  economicSelectionComparison: EconomicSelectionComparison;
  probabilityCalibrationPolicy: ProbabilityTemperatureScalingPolicy;
  probabilityCalibrationComparison: ProbabilityCalibrationComparison;
  marketPriorScalingPolicy: MarketPriorScalingPolicy;
  marketPriorEvidence: MarketPriorReplayEvidence;
  config: ResolvedConfig;
  notes: string[];
  results: TwoWayRuntimeReplayFixtureResult[];
  featureContract: TwoWayRuntimeFeatureContract;
  executionHash: string;
  rejections: Array<{ fixtureExternalId: string; reasons: string[] }>;
};

type RuntimeReplayBreakdown = {
  sampleSize: number;
  pickCount: number;
  winRate: number | null;
  roiUnits: number;
  yield: number | null;
  brierScore: number | null;
  averageEdge: number | null;
};

type TeamState = {
  rating: number;
  matches: number;
  recentResults: Array<"W" | "L">;
  recentFor: number[];
  recentAgainst: number[];
  lastKickoff: number | null;
};

type TennisState = TeamState & {
  surfaceRatings: Map<string, number>;
  surfaceMatches: Map<string, number>;
  surfaceWins: Map<string, number>;
};

type Prepared = {
  fixtureExternalId: string;
  kickoffAt: string;
  actualOutcome: TwoWayOutcome;
  match: Match;
  odds: Array<HistoricalBasketballOddsQuote | HistoricalTennisOddsQuote>;
};

type ModeledPrepared = {
  prepared: Prepared;
  probabilities: Record<TwoWayOutcome, number>;
};

type EvaluatedRows = {
  results: TwoWayRuntimeReplayFixtureResult[];
  marketPriorAdjustments: MarketPriorAdjustment[];
};

const CHRONOLOGY_VERSION: Record<RuntimeReplaySport, string> = {
  basketball: "basketball-outcome-chronology-v1",
  tennis: "tennis-outcome-surface-chronology-v1"
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function config(input: TwoWayRuntimeReplayConfig): ResolvedConfig {
  return {
    trainRatio: clamp(input.trainRatio ?? 0.7, 0.1, 0.9),
    minEdge: clamp(input.minEdge ?? 0.035, 0, 0.25),
    minModelProbability: clamp(input.minModelProbability ?? 0.42, 0.05, 0.95),
    minPriorMatches: Math.round(clamp(input.minPriorMatches ?? 3, 0, 20))
  };
}

function initialState(rating: number): TeamState {
  return { rating, matches: 0, recentResults: [], recentFor: [], recentAgainst: [], lastKickoff: null };
}

function tennisState(): TennisState {
  return { ...initialState(1700), surfaceRatings: new Map(), surfaceMatches: new Map(), surfaceWins: new Map() };
}

function pushRecent<T>(items: T[], value: T, maximum = 5): void {
  items.push(value);
  while (items.length > maximum) items.shift();
}

function restDays(state: TeamState, kickoff: number): number | null {
  if (state.lastKickoff === null) return null;
  return clamp(Math.floor((kickoff - state.lastKickoff) / 86_400_000), 0, 14);
}

function recentFormPoints(state: TeamState): number {
  return state.recentResults.reduce((sum, result) => sum + (result === "W" ? 2 : 0), 0);
}

function dataQuality(value: number | null | undefined): number {
  return clamp(typeof value === "number" && Number.isFinite(value) ? value : 0.72, 0.35, 1);
}

function updateCommon(state: TeamState, won: boolean, pointsFor: number, pointsAgainst: number, kickoff: number): void {
  state.matches += 1;
  pushRecent(state.recentResults, won ? "W" : "L");
  pushRecent(state.recentFor, pointsFor);
  pushRecent(state.recentAgainst, pointsAgainst);
  state.lastKickoff = kickoff;
}

function matchWinnerMarket(
  odds: Array<HistoricalBasketballOddsQuote | HistoricalTennisOddsQuote>,
  kickoffAt: string
): OddsMarket[] {
  const decision = oddsForEvaluation(odds, kickoffAt);
  if (!decision) return [];
  return [{
    id: "match_winner",
    name: "Match winner",
    bookmaker: decision.bookmaker ? { id: decision.bookmaker, name: decision.bookmaker } : undefined,
    selections: (["home", "away"] as const).map((selection) => ({
      id: selection,
      label: selection === "home" ? "Home" : "Away",
      decimalOdds: decision.selections[selection].odds
    }))
  }];
}

function basketballModelRating(raw: number): number {
  return Math.round(clamp(80 + (raw - 1500) / 15, 60, 100));
}

function basketballForm(teamId: string, state: TeamState) {
  const scored = average(state.recentFor) ?? 110;
  const allowed = average(state.recentAgainst) ?? 110;
  return {
    teamId,
    recentResults: [...state.recentResults],
    goalsFor: Number(scored.toFixed(2)),
    goalsAgainst: Number(allowed.toFixed(2)),
    attackStrength: Number(clamp((scored - 92) / 24, 0.35, 1.45).toFixed(3)),
    defenseStrength: Number(clamp((124 - allowed) / 24, 0.35, 1.45).toFixed(3))
  };
}

function prepareBasketball(
  fixtures: readonly HistoricalBasketballFixture[],
  resolved: ResolvedConfig
): { prepared: Prepared[]; rejections: TwoWayRuntimeReplayResult["rejections"] } {
  const states = new Map<string, TeamState>();
  const prepared: Prepared[] = [];
  const rejections: TwoWayRuntimeReplayResult["rejections"] = [];
  const sorted = [...fixtures].sort((left, right) => Date.parse(left.kickoffAt) - Date.parse(right.kickoffAt) || left.fixtureExternalId.localeCompare(right.fixtureExternalId));

  for (const fixture of sorted) {
    const kickoff = Date.parse(fixture.kickoffAt);
    const reasons: string[] = [];
    if (!Number.isFinite(kickoff)) reasons.push("kickoff timestamp invalid");
    if (!Number.isFinite(fixture.homeScore) || !Number.isFinite(fixture.awayScore) || fixture.homeScore === fixture.awayScore) reasons.push("decisive final score missing");
    if (fixture.neutralVenue) reasons.push("neutral venue is unsupported by the runtime Match contract");
    if (!fixture.homeTeamExternalId || !fixture.awayTeamExternalId) reasons.push("team identity missing");
    if (reasons.length) {
      rejections.push({ fixtureExternalId: fixture.fixtureExternalId, reasons });
      continue;
    }

    const home = states.get(fixture.homeTeamExternalId) ?? initialState(1500);
    const away = states.get(fixture.awayTeamExternalId) ?? initialState(1500);
    states.set(fixture.homeTeamExternalId, home);
    states.set(fixture.awayTeamExternalId, away);
    const eligible = home.matches >= resolved.minPriorMatches && away.matches >= resolved.minPriorMatches;
    const homeRest = restDays(home, kickoff);
    const awayRest = restDays(away, kickoff);

    if (eligible) {
      const homeOffense = average(home.recentFor);
      const awayOffense = average(away.recentFor);
      const homeDefense = average(home.recentAgainst);
      const awayDefense = average(away.recentAgainst);
      prepared.push({
        fixtureExternalId: fixture.fixtureExternalId,
        kickoffAt: fixture.kickoffAt,
        actualOutcome: fixture.homeScore > fixture.awayScore ? "home" : "away",
        odds: fixture.odds,
        match: {
          id: fixture.fixtureExternalId,
          sport: "basketball",
          league: { id: fixture.leagueExternalId ?? "historical-basketball", name: fixture.leagueExternalId ?? "Basketball", country: "Historical", strength: 0.82 },
          kickoffTime: fixture.kickoffAt,
          homeTeam: {
            id: fixture.homeTeamExternalId,
            name: fixture.homeTeamExternalId,
            rating: basketballModelRating(home.rating),
            ratingEvidence: {
              source: "leakage-safe basketball chronology",
              rawRating: home.rating,
              sampleSize: home.matches,
              asOf: fixture.kickoffAt,
              restDays: homeRest,
              recentFormPoints: recentFormPoints(home),
              offensiveEfficiency: homeOffense,
              defensiveEfficiency: homeDefense
            }
          },
          awayTeam: {
            id: fixture.awayTeamExternalId,
            name: fixture.awayTeamExternalId,
            rating: basketballModelRating(away.rating),
            ratingEvidence: {
              source: "leakage-safe basketball chronology",
              rawRating: away.rating,
              sampleSize: away.matches,
              asOf: fixture.kickoffAt,
              restDays: awayRest,
              recentFormPoints: recentFormPoints(away),
              offensiveEfficiency: awayOffense,
              defensiveEfficiency: awayDefense
            }
          },
          status: "scheduled",
          oddsMarkets: matchWinnerMarket(fixture.odds, fixture.kickoffAt),
          homeForm: basketballForm(fixture.homeTeamExternalId, home),
          awayForm: basketballForm(fixture.awayTeamExternalId, away),
          dataQualityScore: dataQuality(fixture.dataQuality),
          providerContextSignals: [],
          dataSource: { kind: "provider", fixtureProvider: "historical-chronology", fixtureProviderId: fixture.fixtureExternalId, season: fixture.season ?? undefined, fetchedAt: fixture.kickoffAt }
        }
      });
    }

    const expectedHome = logistic((home.rating - away.rating + 46.8) / 150);
    const actualHome = fixture.homeScore > fixture.awayScore ? 1 : 0;
    const marginFactor = clamp(Math.abs(fixture.homeScore - fixture.awayScore) / 12, 0.7, 1.8);
    const k = 18 * marginFactor * dataQuality(fixture.dataQuality);
    home.rating += k * (actualHome - expectedHome);
    away.rating += k * ((1 - actualHome) - (1 - expectedHome));
    updateCommon(home, actualHome === 1, fixture.homeScore, fixture.awayScore, kickoff);
    updateCommon(away, actualHome === 0, fixture.awayScore, fixture.homeScore, kickoff);
  }
  return { prepared, rejections };
}

function normalizedSurface(value: string | null | undefined): string {
  const surface = value?.trim().toLowerCase();
  return surface === "hard" || surface === "clay" || surface === "grass" || surface === "indoor" ? surface : "unknown";
}

function tennisForm(teamId: string, state: TennisState, surface: string) {
  const matches = state.surfaceMatches.get(surface) ?? 0;
  const wins = state.surfaceWins.get(surface) ?? 0;
  const surfaceStrength = (wins + 1) / (matches + 2);
  return {
    teamId,
    recentResults: [...state.recentResults],
    goalsFor: recentFormPoints(state),
    goalsAgainst: 0,
    attackStrength: Number(surfaceStrength.toFixed(6)),
    defenseStrength: Number((1 - surfaceStrength).toFixed(6))
  };
}

function prepareTennis(
  fixtures: readonly HistoricalTennisMatch[],
  resolved: ResolvedConfig
): { prepared: Prepared[]; rejections: TwoWayRuntimeReplayResult["rejections"] } {
  const states = new Map<string, TennisState>();
  const prepared: Prepared[] = [];
  const rejections: TwoWayRuntimeReplayResult["rejections"] = [];
  const sorted = [...fixtures].sort((left, right) => Date.parse(left.kickoffAt) - Date.parse(right.kickoffAt) || left.fixtureExternalId.localeCompare(right.fixtureExternalId));

  for (const fixture of sorted) {
    const kickoff = Date.parse(fixture.kickoffAt);
    const reasons: string[] = [];
    if (!Number.isFinite(kickoff)) reasons.push("kickoff timestamp invalid");
    if (!Number.isFinite(fixture.homeSets) || !Number.isFinite(fixture.awaySets) || fixture.homeSets === fixture.awaySets) reasons.push("decisive final score missing");
    if (!fixture.homePlayerExternalId || !fixture.awayPlayerExternalId) reasons.push("player identity missing");
    if (reasons.length) {
      rejections.push({ fixtureExternalId: fixture.fixtureExternalId, reasons });
      continue;
    }

    const surface = normalizedSurface(fixture.surface);
    const home = states.get(fixture.homePlayerExternalId) ?? tennisState();
    const away = states.get(fixture.awayPlayerExternalId) ?? tennisState();
    states.set(fixture.homePlayerExternalId, home);
    states.set(fixture.awayPlayerExternalId, away);
    const eligible = home.matches >= resolved.minPriorMatches && away.matches >= resolved.minPriorMatches;
    const homeSurfaceRating = home.surfaceRatings.get(surface) ?? home.rating;
    const awaySurfaceRating = away.surfaceRatings.get(surface) ?? away.rating;
    const homeForm = tennisForm(fixture.homePlayerExternalId, home, surface);
    const awayForm = tennisForm(fixture.awayPlayerExternalId, away, surface);

    if (eligible) {
      prepared.push({
        fixtureExternalId: fixture.fixtureExternalId,
        kickoffAt: fixture.kickoffAt,
        actualOutcome: fixture.homeSets > fixture.awaySets ? "home" : "away",
        odds: fixture.odds,
        match: {
          id: fixture.fixtureExternalId,
          sport: "tennis",
          league: {
            id: fixture.tournamentExternalId ?? "historical-tennis",
            name: [fixture.tournamentExternalId ?? "Tennis", fixture.round].filter(Boolean).join(" "),
            country: "World",
            strength: 0.82
          },
          kickoffTime: fixture.kickoffAt,
          homeTeam: {
            id: fixture.homePlayerExternalId,
            name: fixture.homePlayerExternalId,
            rating: tennisModelRatingFromElo(home.rating),
            ratingEvidence: {
              source: "leakage-safe tennis surface chronology",
              rawRating: home.rating,
              sampleSize: home.matches,
              asOf: fixture.kickoffAt,
              restDays: restDays(home, kickoff),
              recentFormPoints: recentFormPoints(home),
              surface,
              attackStrength: homeForm.attackStrength,
              defenseStrength: homeForm.defenseStrength
            }
          },
          awayTeam: {
            id: fixture.awayPlayerExternalId,
            name: fixture.awayPlayerExternalId,
            rating: tennisModelRatingFromElo(away.rating),
            ratingEvidence: {
              source: "leakage-safe tennis surface chronology",
              rawRating: away.rating,
              sampleSize: away.matches,
              asOf: fixture.kickoffAt,
              restDays: restDays(away, kickoff),
              recentFormPoints: recentFormPoints(away),
              surface,
              attackStrength: awayForm.attackStrength,
              defenseStrength: awayForm.defenseStrength
            }
          },
          status: "scheduled",
          oddsMarkets: matchWinnerMarket(fixture.odds, fixture.kickoffAt),
          homeForm,
          awayForm,
          dataQualityScore: dataQuality(fixture.dataQuality),
          providerContextSignals: [],
          dataSource: { kind: "provider", fixtureProvider: "historical-chronology", fixtureProviderId: fixture.fixtureExternalId, season: fixture.season ?? undefined, round: fixture.round ?? undefined, fetchedAt: fixture.kickoffAt }
        }
      });
    }

    const expectedHome = logistic((home.rating - away.rating) / 165);
    const actualHome = fixture.homeSets > fixture.awaySets ? 1 : 0;
    const k = 24 * clamp(Math.abs(fixture.homeSets - fixture.awaySets) / 2, 0.75, 1.35) * dataQuality(fixture.dataQuality);
    home.rating += k * (actualHome - expectedHome);
    away.rating += k * ((1 - actualHome) - (1 - expectedHome));
    const expectedSurfaceHome = logistic((homeSurfaceRating - awaySurfaceRating) / 165);
    home.surfaceRatings.set(surface, homeSurfaceRating + 18 * (actualHome - expectedSurfaceHome));
    away.surfaceRatings.set(surface, awaySurfaceRating + 18 * ((1 - actualHome) - (1 - expectedSurfaceHome)));
    home.surfaceMatches.set(surface, (home.surfaceMatches.get(surface) ?? 0) + 1);
    away.surfaceMatches.set(surface, (away.surfaceMatches.get(surface) ?? 0) + 1);
    if (actualHome === 1) home.surfaceWins.set(surface, (home.surfaceWins.get(surface) ?? 0) + 1);
    else away.surfaceWins.set(surface, (away.surfaceWins.get(surface) ?? 0) + 1);
    updateCommon(home, actualHome === 1, fixture.homeSets, fixture.awaySets, kickoff);
    updateCommon(away, actualHome === 0, fixture.awaySets, fixture.homeSets, kickoff);
  }
  return { prepared, rejections };
}

type TwoWayOddsQuote = HistoricalBasketballOddsQuote | HistoricalTennisOddsQuote;

type CoherentTwoWayOddsSnapshot = {
  bookmaker: string;
  observedAt: string;
  timestamp: number;
  odds: Record<TwoWayOutcome, number>;
};

function coherentOddsSnapshots(
  odds: readonly TwoWayOddsQuote[],
  kickoffAt: string,
  closing: boolean
): CoherentTwoWayOddsSnapshot[] {
  const kickoff = Date.parse(kickoffAt);
  if (!Number.isFinite(kickoff)) return [];
  const grouped = new Map<string, {
    bookmaker: string;
    observedAt: string;
    timestamp: number;
    selections: Partial<Record<TwoWayOutcome, number>>;
  }>();

  for (const quote of odds) {
    if (Boolean(quote.isClosing) !== closing || !Number.isFinite(quote.decimalOdds) || quote.decimalOdds <= 1) continue;
    const timestamp = Date.parse(quote.observedAt ?? "");
    if (!Number.isFinite(timestamp) || timestamp > kickoff) continue;
    const observedAt = new Date(timestamp).toISOString();
    const bookmaker = quote.bookmaker?.trim() || "unknown-bookmaker";
    const key = `${bookmaker}\u0000${observedAt}`;
    const group = grouped.get(key) ?? { bookmaker, observedAt, timestamp, selections: {} };
    group.selections[quote.selection] = quote.decimalOdds;
    grouped.set(key, group);
  }

  return [...grouped.values()]
    .filter((group) => group.selections.home !== undefined && group.selections.away !== undefined)
    .map((group) => ({
      bookmaker: group.bookmaker,
      observedAt: group.observedAt,
      timestamp: group.timestamp,
      odds: { home: group.selections.home!, away: group.selections.away! }
    }))
    .sort((left, right) => left.timestamp - right.timestamp || left.bookmaker.localeCompare(right.bookmaker));
}

function oddsForEvaluation(odds: Array<TwoWayOddsQuote>, kickoffAt: string) {
  const decision = coherentOddsSnapshots(odds, kickoffAt, false)[0];
  if (!decision) return null;
  const closing = coherentOddsSnapshots(odds, kickoffAt, true)
    .filter((snapshot) => snapshot.bookmaker === decision.bookmaker)
    .at(-1) ?? null;
  const selections: Partial<Record<TwoWayOutcome, { odds: number; closingOdds: number | null; impliedProbability: number }>> = {};
  const rawHome = 1 / decision.odds.home;
  const rawAway = 1 / decision.odds.away;
  const overround = rawHome + rawAway || 1;
  for (const side of ["home", "away"] as const) {
    selections[side] = {
      odds: decision.odds[side],
      closingOdds: closing?.odds[side] ?? null,
      impliedProbability: (side === "home" ? rawHome : rawAway) / overround
    };
  }
  return {
    bookmaker: decision.bookmaker,
    observedAt: decision.observedAt,
    selections: selections as Record<TwoWayOutcome, { odds: number; closingOdds: number | null; impliedProbability: number }>
  };
}

function confidence(edge: number, probability: number, quality: number): Confidence {
  return confidenceFromEdgeAndProbability(edge, probability, quality);
}

function evaluate(prepared: Prepared, probabilities: Record<TwoWayOutcome, number>, resolved: ResolvedConfig): TwoWayRuntimeReplayFixtureResult {
  const actual = prepared.actualOutcome;
  const marketOdds = oddsForEvaluation(prepared.odds, prepared.kickoffAt)?.selections ?? null;
  let pick: TwoWayRuntimeReplayPick | null = null;
  if (marketOdds) {
    const candidate = (["home", "away"] as const)
      .map((selection) => ({ selection, probability: probabilities[selection], quote: marketOdds[selection], edge: probabilities[selection] - marketOdds[selection].impliedProbability }))
      .filter((item) => item.edge >= resolved.minEdge && item.probability >= resolved.minModelProbability)
      .sort((left, right) => right.edge - left.edge)[0];
    if (candidate) {
      const won = candidate.selection === actual;
      pick = {
        selection: candidate.selection,
        modelProbability: round(candidate.probability)!,
        impliedProbability: round(candidate.quote.impliedProbability)!,
        edge: round(candidate.edge)!,
        odds: candidate.quote.odds,
        closingOdds: candidate.quote.closingOdds,
        confidence: confidence(candidate.edge, candidate.probability, prepared.match.dataQualityScore),
        won,
        unitReturn: round(won ? candidate.quote.odds - 1 : -1)!,
        closingLineValue: round(candidate.quote.closingOdds ? candidate.quote.odds / candidate.quote.closingOdds - 1 : null)
      };
    }
  }
  const actualHome = actual === "home" ? 1 : 0;
  const brier = ((probabilities.home - actualHome) ** 2 + (probabilities.away - (1 - actualHome)) ** 2) / 2;
  return {
    fixtureExternalId: prepared.fixtureExternalId,
    kickoffAt: prepared.kickoffAt,
    actualOutcome: actual,
    probabilities: { home: round(probabilities.home)!, away: round(probabilities.away)! },
    brierScore: round(brier)!,
    logLoss: round(-Math.log(clamp(probabilities[actual], 0.000001, 0.999999)))!,
    pick
  };
}

function breakdown(results: TwoWayRuntimeReplayFixtureResult[]): RuntimeReplayBreakdown {
  const picks = results.map((result) => result.pick).filter((pick): pick is TwoWayRuntimeReplayPick => Boolean(pick));
  const roi = picks.reduce((sum, pick) => sum + pick.unitReturn, 0);
  return {
    sampleSize: results.length,
    pickCount: picks.length,
    winRate: round(picks.length ? picks.filter((pick) => pick.won).length / picks.length : null),
    roiUnits: round(roi) ?? 0,
    yield: round(picks.length ? roi / picks.length : null),
    brierScore: round(average(results.map((result) => result.brierScore))),
    averageEdge: round(average(picks.map((pick) => pick.edge)))
  };
}

function summary(results: TwoWayRuntimeReplayFixtureResult[]) {
  const picks = results.map((result) => result.pick).filter((pick): pick is TwoWayRuntimeReplayPick => Boolean(pick));
  const roi = picks.reduce((sum, pick) => sum + pick.unitReturn, 0);
  const calibration = buildProbabilityCalibration(results.flatMap((result) => (["home", "away"] as const).map((side) => ({ probability: result.probabilities[side], occurred: result.actualOutcome === side }))));
  const byConfidence = new Map<string, TwoWayRuntimeReplayFixtureResult[]>();
  for (const result of results) {
    const key = result.pick?.confidence ?? "no-pick";
    byConfidence.set(key, [...(byConfidence.get(key) ?? []), result]);
  }
  return {
    pickCount: picks.length,
    brierScore: round(average(results.map((result) => result.brierScore))),
    logLoss: round(average(results.map((result) => result.logLoss))),
    roiUnits: round(roi) ?? 0,
    yield: round(picks.length ? roi / picks.length : null),
    averageEdge: round(average(picks.map((pick) => pick.edge))),
    closingLineValue: round(average(picks.map((pick) => pick.closingLineValue).filter((value): value is number => value !== null))),
    calibrationError: calibration.expectedCalibrationError,
    calibrationBuckets: calibration.buckets,
    marketBreakdown: { match_winner: breakdown(results) },
    confidenceBreakdown: Object.fromEntries([...byConfidence.entries()].map(([key, rows]) => [key, breakdown(rows)]))
  };
}

function rejectionCounts(rejections: TwoWayRuntimeReplayResult["rejections"]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const rejection of rejections) for (const reason of rejection.reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function run(
  sport: RuntimeReplaySport,
  sourceCount: number,
  prepared: Prepared[],
  rejections: TwoWayRuntimeReplayResult["rejections"],
  resolved: ResolvedConfig
): TwoWayRuntimeReplayResult {
  const trainSize = prepared.length
    ? strictChronologicalSplitIndex(prepared, Math.floor(prepared.length * resolved.trainRatio))
    : 0;
  const trainingRows = prepared.slice(0, trainSize);
  const holdoutRows = prepared.slice(trainSize);
  const model = sport === "basketball" ? modelBasketballMatch : modelTennisMatch;
  const modelRows = (rows: Prepared[]): ModeledPrepared[] => rows.flatMap((item) => {
    const modeled = model(item.match);
    const market = modeled.markets.find((candidate) => candidate.marketId === "match_winner");
    const home = market?.probabilities.home;
    const away = market?.probabilities.away;
    return typeof home === "number" && typeof away === "number" && Number.isFinite(home) && Number.isFinite(away)
      ? [{ prepared: item, probabilities: { home, away } }]
      : [];
  });
  const evaluateRows = (
    rows: readonly ModeledPrepared[],
    selectionConfig: ResolvedConfig,
    calibrationPolicy?: ProbabilityTemperatureScalingPolicy,
    applyMarketPrior = false,
    marketPriorScalingPolicy?: MarketPriorScalingPolicy
  ): EvaluatedRows => {
    const marketPriorAdjustments: MarketPriorAdjustment[] = [];
    const results = rows.map((row) => {
      let probabilities = calibrationPolicy
        ? applyProbabilityTemperaturePolicy(row.probabilities, calibrationPolicy) as Record<TwoWayOutcome, number>
        : row.probabilities;
      if (applyMarketPrior) {
        const prior = applyMarketPriorAdjustmentToMarkets(
          [{ marketId: "match_winner", probabilities }],
          row.prepared.match.oddsMarkets,
          row.prepared.match.dataQualityScore,
          undefined,
          marketPriorScalingPolicy
        );
        marketPriorAdjustments.push(prior.adjustment);
        const posterior = prior.markets.find((market) => market.marketId === "match_winner")?.probabilities;
        if (posterior) probabilities = posterior as Record<TwoWayOutcome, number>;
      }
      return evaluate(row.prepared, probabilities, selectionConfig);
    });
    return { results, marketPriorAdjustments };
  };
  const modeledTraining = modelRows(trainingRows);
  const modeledHoldout = modelRows(holdoutRows);
  const rawTrainingResults = evaluateRows(modeledTraining, resolved).results;
  const probabilityCalibrationPolicy = learnProbabilityTemperaturePolicy({
    trainingRows: rawTrainingResults,
    holdoutWindowStart: holdoutRows[0]?.kickoffAt ?? null
  });
  const calibratedMarketObservations: MarketPriorScalingObservation[] = modeledTraining.map((modeled, index) => ({
    kickoffAt: modeled.prepared.kickoffAt,
    markets: [{
      marketId: "match_winner",
      probabilities: applyProbabilityTemperaturePolicy(modeled.probabilities, probabilityCalibrationPolicy)
    }],
    oddsMarkets: modeled.prepared.match.oddsMarkets,
    dataQuality: modeled.prepared.match.dataQualityScore,
    actualOutcome: rawTrainingResults[index]!.actualOutcome
  }));
  const marketPriorScalingPolicy = learnMarketPriorScalingPolicy({
    trainingRows: probabilityPolicyValidationRows(calibratedMarketObservations, probabilityCalibrationPolicy),
    holdoutWindowStart: holdoutRows[0]?.kickoffAt ?? null
  });
  const trainingPosterior = evaluateRows(
    modeledTraining,
    resolved,
    probabilityCalibrationPolicy,
    true,
    marketPriorScalingPolicy
  );
  const trainingResults = trainingPosterior.results;
  const temperatureValidationResults = probabilityPolicyValidationRows(trainingResults, probabilityCalibrationPolicy);
  const pricedTrainingFixtures = new Set(trainingResults.flatMap((result, index) =>
    trainingPosterior.marketPriorAdjustments[index]?.applied ? [result.fixtureExternalId] : []
  ));
  const selectionTrainingResults = marketPriorPolicyValidationRows(
    temperatureValidationResults,
    marketPriorScalingPolicy,
    (result) => pricedTrainingFixtures.has(result.fixtureExternalId)
  );
  const usedTrainingValidation =
    marketPriorScalingPolicy.validationSampleSize >= 20
      ? selectionTrainingResults.length === marketPriorScalingPolicy.validationSampleSize
      : probabilityCalibrationPolicy.validationSampleSize >= 20 &&
        selectionTrainingResults.length === probabilityCalibrationPolicy.validationSampleSize;
  const trainingSummary = summary(selectionTrainingResults);
  const minimumEdge = clamp(resolved.minEdge + ((trainingSummary.yield ?? 0) < 0 ? 0.015 : 0), 0.02, 0.09);
  const holdoutSelectionConfig = { ...resolved, minEdge: minimumEdge };
  const policyTrainingResults = applyMinimumEdgeToResults(selectionTrainingResults, minimumEdge);
  const selectionPolicy = learnEconomicSelectionPolicy(policyTrainingResults);
  const rawHoldoutResults = evaluateRows(modeledHoldout, holdoutSelectionConfig).results;
  const calibratedHoldoutResults = evaluateRows(
    modeledHoldout,
    holdoutSelectionConfig,
    probabilityCalibrationPolicy
  ).results;
  const holdoutPosterior = evaluateRows(
    modeledHoldout,
    holdoutSelectionConfig,
    probabilityCalibrationPolicy,
    true,
    marketPriorScalingPolicy
  );
  const posteriorResults = holdoutPosterior.results;
  const probabilityCalibrationComparison = buildProbabilityCalibrationComparison({
    baselineRows: rawHoldoutResults,
    calibratedRows: calibratedHoldoutResults
  });
  const marketPriorEvidence = buildMarketPriorReplayEvidence({
    adjustments: holdoutPosterior.marketPriorAdjustments,
    baselineRows: calibratedHoldoutResults,
    posteriorRows: posteriorResults
  });
  const results = applyEconomicSelectionPolicy(posteriorResults, selectionPolicy);
  const economicSelectionComparison = buildEconomicSelectionComparison(posteriorResults, results);
  const holdoutSummary = summary(results);
  const identity = decisionModelIdentity(sport);
  const contract: TwoWayRuntimeFeatureContract = {
    status: trainingRows.length > 0 && results.length > 0 && results.length === holdoutRows.length && trainingResults.length === trainingRows.length ? "passed" : "failed",
    version: identity.featureContractVersion,
    chronologyVersion: CHRONOLOGY_VERSION[sport],
    sourceFixtures: sourceCount,
    eligibleFixtures: prepared.length,
    rejectedFixtures: rejections.length,
    trainingEvaluatedFixtures: trainingResults.length,
    trainingEntrypointInvocations: trainingRows.length,
    evaluatedFixtures: results.length,
    entrypointInvocations: holdoutRows.length,
    optionalCoverage: {
      completeOddsFixtures: prepared.filter((item) => oddsForEvaluation(item.odds, item.kickoffAt)).length,
      surfaceFixtures: sport === "tennis" ? prepared.filter((item) => item.match.homeTeam.ratingEvidence?.surface !== "unknown").length : 0,
      restFixtures: prepared.filter((item) => typeof item.match.homeTeam.ratingEvidence?.restDays === "number" && typeof item.match.awayTeam.ratingEvidence?.restDays === "number").length
    },
    rejectionReasons: rejectionCounts(rejections)
  };
  const executionHash = stableHash({
    sport,
    modelKey: identity.runtimeModelKey,
    entrypoint: `${identity.runtimeEntrypoint}+temperatureScaling+marketPrior`,
    contract,
    training: trainingResults.map((row) => row.probabilities),
    holdout: results.map((row) => row.probabilities),
    holdoutSelectionPolicy: {
      source: "chronological-training-window",
      minimumEdge: holdoutSelectionConfig.minEdge,
      minimumModelProbability: holdoutSelectionConfig.minModelProbability,
      economicPolicy: selectionPolicy,
      comparison: economicSelectionComparison
    },
    probabilityCalibrationPolicy,
    probabilityCalibrationComparison,
    marketPriorScalingPolicy,
    marketPriorEvidence
  });
  return {
    sport,
    modelKey: identity.runtimeModelKey,
    engineVersion: DECISION_ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    status: contract.status === "passed" ? "completed" : "no-data",
    sampleSize: prepared.length,
    trainSize,
    testSize: results.length,
    pickCount: holdoutSummary.pickCount,
    windowStart: prepared[0]?.kickoffAt ?? null,
    windowEnd: prepared.at(-1)?.kickoffAt ?? null,
    trainWindowStart: trainingRows[0]?.kickoffAt ?? null,
    trainWindowEnd: trainingRows.at(-1)?.kickoffAt ?? null,
    testWindowStart: holdoutRows[0]?.kickoffAt ?? null,
    testWindowEnd: holdoutRows.at(-1)?.kickoffAt ?? null,
    brierScore: holdoutSummary.brierScore,
    logLoss: holdoutSummary.logLoss,
    roiUnits: holdoutSummary.roiUnits,
    yield: holdoutSummary.yield,
    averageEdge: holdoutSummary.averageEdge,
    closingLineValue: holdoutSummary.closingLineValue,
    calibrationError: holdoutSummary.calibrationError,
    calibrationBuckets: holdoutSummary.calibrationBuckets,
    marketBreakdown: holdoutSummary.marketBreakdown,
    confidenceBreakdown: holdoutSummary.confidenceBreakdown,
    learnedWeights: { minimumEdge: round(minimumEdge, 4)!, trainingSampleSize: selectionTrainingResults.length, trainingBrierScore: trainingSummary.brierScore ?? 0 },
    selectionPolicy,
    economicSelectionComparison,
    probabilityCalibrationPolicy,
    probabilityCalibrationComparison,
    marketPriorScalingPolicy,
    marketPriorEvidence,
    config: resolved,
    notes: [
      `Executed ${results.length} chronological holdout fixture(s) through ${identity.runtimeEntrypoint}.`,
      `All Elo, form, rest, scoring, and surface features were calculated before each result updated team or player state.`,
      `${selectionTrainingResults.length} ${usedTrainingValidation ? "prospective training-validation" : "training-window fallback"} fixture(s) set the holdout minimum edge to ${holdoutSelectionConfig.minEdge.toFixed(4)}; holdout outcomes did not tune it.`,
      probabilityCalibrationPolicy.status === "active"
        ? `Training fit/validation evidence activated temperature ${probabilityCalibrationPolicy.temperature.toFixed(3)}; it was frozen before holdout and changed holdout log loss by ${probabilityCalibrationComparison.logLossDelta ?? "n/a"}.`
        : `Training fit/validation evidence kept identity calibration (${probabilityCalibrationPolicy.reason}); holdout probabilities were not tuned.`,
      marketPriorScalingPolicy.status === "active"
        ? `A later priced training window validated market-prior scale ${marketPriorScalingPolicy.weightScale.toFixed(1)}; it was frozen before holdout.`
        : `The market-prior blend retained identity scale 1 (${marketPriorScalingPolicy.reason}).`,
      marketPriorEvidence.status === "applied"
        ? `The live no-vig market prior adjusted ${marketPriorEvidence.adjustedFixtures}/${marketPriorEvidence.evaluatedFixtures} holdout fixture(s) at average weight ${marketPriorEvidence.averageWeight}; final-posterior log-loss delta ${marketPriorEvidence.probabilityComparison.logLossDelta ?? "n/a"}.`
        : "No coherent pre-match holdout market was available for live market-prior parity.",
      selectionPolicy.status === "active"
        ? `Training-only economic evidence admitted ${selectionPolicy.allowedConfidenceBands.join(", ")} confidence band(s); the policy was applied unchanged to holdout.`
        : `Training-only economic evidence admitted no confidence band, so the holdout selection policy abstained.`,
      rejections.length ? `${rejections.length} source fixture(s) were rejected by the fail-closed contract.` : "Every source fixture had a valid identity and decisive result."
    ],
    results,
    featureContract: contract,
    executionHash,
    rejections
  };
}

export function runBasketballRuntimeReplay(fixtures: readonly HistoricalBasketballFixture[], input: TwoWayRuntimeReplayConfig = {}): TwoWayRuntimeReplayResult {
  const resolved = config(input);
  const built = prepareBasketball(fixtures, resolved);
  return run("basketball", fixtures.length, built.prepared, built.rejections, resolved);
}

export function runTennisRuntimeReplay(fixtures: readonly HistoricalTennisMatch[], input: TwoWayRuntimeReplayConfig = {}): TwoWayRuntimeReplayResult {
  const resolved = config(input);
  const built = prepareTennis(fixtures, resolved);
  return run("tennis", fixtures.length, built.prepared, built.rejections, resolved);
}

export function twoWayRuntimeReplayIdentityReceipt(result: TwoWayRuntimeReplayResult): Record<string, string | number> {
  if (result.featureContract.status !== "passed") throw new Error(`Cannot mint ${result.sport} runtime identity receipt from a failed feature contract.`);
  return runtimeModelIdentityReceipt(result.sport, {
    featureContractStatus: "passed",
    evaluatedFixtures: result.featureContract.evaluatedFixtures,
    entrypointInvocations: result.featureContract.entrypointInvocations,
    executionHash: result.executionHash
  });
}
