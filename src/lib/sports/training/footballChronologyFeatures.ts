import type {
  HistoricalFootballFeatureInput,
  HistoricalFootballFixtureInput
} from "./historicalIngestion";
import { decisionModelIdentity } from "@/lib/sports/prediction/modelIdentity";

type RecentResult = {
  result: "W" | "D" | "L";
  points: number;
  goalsFor: number;
  goalsAgainst: number;
};

type TeamState = {
  elo: number;
  played: number;
  recent: RecentResult[];
  lastKickoffAt: string | null;
  activeSeason: string | null;
  seasons: Set<string>;
};

type LeagueState = {
  totalGoals: number;
  teamAppearances: number;
  matches: number;
};

export type FootballChronologyFeatureConfig = {
  initialElo?: number;
  homeAdvantageElo?: number;
  baseK?: number;
  priorTeamMatches?: number;
  priorLeagueGoalsPerTeam?: number;
  recentWindow?: number;
  strengthWindow?: number;
  seasonRegression?: number;
};

const DEFAULT_CONFIG: Required<FootballChronologyFeatureConfig> = {
  initialElo: 1500,
  homeAdvantageElo: 65,
  baseK: 28,
  priorTeamMatches: 5,
  priorLeagueGoalsPerTeam: 1.35,
  recentWindow: 5,
  strengthWindow: 20,
  seasonRegression: 0.25
};

const FEATURE_KEYS = [
  "eloRating",
  "attackStrength",
  "defenseStrength",
  "recentFormPoints",
  "recentGoalsFor",
  "recentGoalsAgainst",
  "restDays"
] as const;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function resolvedConfig(config: FootballChronologyFeatureConfig): Required<FootballChronologyFeatureConfig> {
  return {
    initialElo: clamp(config.initialElo ?? DEFAULT_CONFIG.initialElo, 1000, 2000),
    homeAdvantageElo: clamp(config.homeAdvantageElo ?? DEFAULT_CONFIG.homeAdvantageElo, 0, 150),
    baseK: clamp(config.baseK ?? DEFAULT_CONFIG.baseK, 8, 60),
    priorTeamMatches: Math.round(clamp(config.priorTeamMatches ?? DEFAULT_CONFIG.priorTeamMatches, 1, 20)),
    priorLeagueGoalsPerTeam: clamp(
      config.priorLeagueGoalsPerTeam ?? DEFAULT_CONFIG.priorLeagueGoalsPerTeam,
      0.5,
      3
    ),
    recentWindow: Math.round(clamp(config.recentWindow ?? DEFAULT_CONFIG.recentWindow, 3, 10)),
    strengthWindow: Math.round(clamp(config.strengthWindow ?? DEFAULT_CONFIG.strengthWindow, 10, 40)),
    seasonRegression: clamp(config.seasonRegression ?? DEFAULT_CONFIG.seasonRegression, 0, 1)
  };
}

function emptyTeamState(initialElo: number): TeamState {
  return {
    elo: initialElo,
    played: 0,
    recent: [],
    lastKickoffAt: null,
    activeSeason: null,
    seasons: new Set<string>()
  };
}

function emptyLeagueState(): LeagueState {
  return { totalGoals: 0, teamAppearances: 0, matches: 0 };
}

function pointsFor(goalsFor: number, goalsAgainst: number): number {
  if (goalsFor > goalsAgainst) return 3;
  if (goalsFor === goalsAgainst) return 1;
  return 0;
}

function resultFor(goalsFor: number, goalsAgainst: number): RecentResult["result"] {
  if (goalsFor > goalsAgainst) return "W";
  if (goalsFor === goalsAgainst) return "D";
  return "L";
}

function leagueKey(fixture: HistoricalFootballFixtureInput): string {
  const provider = cleanText(fixture.metadata?.provider) || "provider";
  const league = cleanText(fixture.league.externalId) || cleanText(fixture.league.name) || "football";
  return `${provider}:${league}`;
}

function teamKey(fixture: HistoricalFootballFixtureInput, side: "home" | "away"): string {
  const team = side === "home" ? fixture.homeTeam : fixture.awayTeam;
  return `${leagueKey(fixture)}:${cleanText(team.externalId) || cleanText(team.name)}`;
}

function leagueGoalRate(state: LeagueState, fallback: number): number {
  return state.teamAppearances > 0
    ? clamp(state.totalGoals / state.teamAppearances, 0.65, 2.25)
    : fallback;
}

function restDays(state: TeamState, kickoffAt: string): number | null {
  if (!state.lastKickoffAt) return null;
  const days = (Date.parse(kickoffAt) - Date.parse(state.lastKickoffAt)) / (24 * 60 * 60 * 1000);
  return Number.isFinite(days) && days >= 0 ? Math.round(clamp(days, 0, 45)) : null;
}

function prepareTeamForSeason(
  state: TeamState,
  season: string,
  config: Required<FootballChronologyFeatureConfig>
): void {
  if (state.activeSeason && state.activeSeason !== season) {
    state.elo = config.initialElo + (state.elo - config.initialElo) * (1 - config.seasonRegression);
  }
  state.activeSeason = season;
}

function derivedFeatureState({
  team,
  league,
  kickoffAt,
  season,
  side,
  config
}: {
  team: TeamState;
  league: LeagueState;
  kickoffAt: string;
  season: string;
  side: "home" | "away";
  config: Required<FootballChronologyFeatureConfig>;
}): HistoricalFootballFeatureInput {
  const goalRate = leagueGoalRate(league, config.priorLeagueGoalsPerTeam);
  const strength = team.recent.slice(-config.strengthWindow);
  const strengthGoalsFor = strength.reduce((sum, result) => sum + result.goalsFor, 0);
  const strengthGoalsAgainst = strength.reduce((sum, result) => sum + result.goalsAgainst, 0);
  const smoothedGoalsFor = (
    strengthGoalsFor + goalRate * config.priorTeamMatches
  ) / (strength.length + config.priorTeamMatches);
  const smoothedGoalsAgainst = (
    strengthGoalsAgainst + goalRate * config.priorTeamMatches
  ) / (strength.length + config.priorTeamMatches);
  const recent = team.recent.slice(-config.recentWindow);
  const missingRecent = Math.max(0, config.recentWindow - recent.length);
  const recentPoints = recent.reduce((sum, result) => sum + result.points, 0) + missingRecent * 1.5;
  const recentGoalsFor = (
    recent.reduce((sum, result) => sum + result.goalsFor, 0) + missingRecent * goalRate
  ) / config.recentWindow;
  const recentGoalsAgainst = (
    recent.reduce((sum, result) => sum + result.goalsAgainst, 0) + missingRecent * goalRate
  ) / config.recentWindow;

  return {
    eloRating: round(team.elo, 3),
    attackStrength: round(clamp(smoothedGoalsFor / goalRate, 0.55, 1.65)),
    defenseStrength: round(clamp(goalRate / Math.max(smoothedGoalsAgainst, 0.25), 0.55, 1.65)),
    recentFormPoints: round(recentPoints),
    recentGoalsFor: round(recentGoalsFor),
    recentGoalsAgainst: round(recentGoalsAgainst),
    restDays: restDays(team, kickoffAt),
    metadata: {
      chronology: {
        version: "football-provider-chronology-v3",
        featureContractVersion: decisionModelIdentity("football").featureContractVersion,
        source: "finished-provider-fixtures",
        leakageSafe: true,
        asOfExclusive: kickoffAt,
        side,
        priorMatches: team.played,
        leaguePriorMatches: league.matches,
        leagueGoalsPerTeam: round(goalRate),
        priorTeamMatches: config.priorTeamMatches,
        recentWindow: config.recentWindow,
        // The runtime model consumes provider form newest -> oldest.
        recentResults: [...recent].reverse().map((result) => result.result),
        strengthWindow: config.strengthWindow,
        strengthMatches: strength.length,
        strengthGoalsForPerMatch: strength.length ? round(strengthGoalsFor / strength.length) : null,
        strengthGoalsAgainstPerMatch: strength.length ? round(strengthGoalsAgainst / strength.length) : null,
        seasonRegression: config.seasonRegression,
        priorSeasons: [...team.seasons].sort(),
        crossSeasonHistory: [...team.seasons].some((priorSeason) => priorSeason !== season)
      }
    }
  };
}

function mergeFeature(
  derived: HistoricalFootballFeatureInput,
  existing: HistoricalFootballFeatureInput | undefined
): HistoricalFootballFeatureInput {
  if (!existing) return derived;
  const merged: HistoricalFootballFeatureInput = {
    ...derived,
    ...existing,
    metadata: {
      ...(existing.metadata ?? {}),
      ...(derived.metadata ?? {})
    }
  };
  for (const key of FEATURE_KEYS) {
    if (typeof existing[key] !== "number" || !Number.isFinite(existing[key])) merged[key] = derived[key];
  }
  return merged;
}

function validScore(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 30;
}

function updateTeamState(
  state: TeamState,
  goalsFor: number,
  goalsAgainst: number,
  kickoffAt: string,
  season: string,
  strengthWindow: number
): void {
  state.played += 1;
  state.recent = [
    ...state.recent,
    { result: resultFor(goalsFor, goalsAgainst), points: pointsFor(goalsFor, goalsAgainst), goalsFor, goalsAgainst }
  ].slice(-strengthWindow);
  state.lastKickoffAt = kickoffAt;
  state.seasons.add(season);
}

function updateRatings({
  fixture,
  home,
  away,
  config
}: {
  fixture: HistoricalFootballFixtureInput;
  home: TeamState;
  away: TeamState;
  config: Required<FootballChronologyFeatureConfig>;
}): void {
  if (!validScore(fixture.homeScore) || !validScore(fixture.awayScore)) return;
  const expectedHome = 1 / (
    1 + 10 ** ((away.elo - home.elo - (fixture.neutralVenue ? 0 : config.homeAdvantageElo)) / 400)
  );
  const actualHome = fixture.homeScore > fixture.awayScore ? 1 : fixture.homeScore < fixture.awayScore ? 0 : 0.5;
  const goalMarginScale = 1 + Math.log2(Math.max(1, Math.abs(fixture.homeScore - fixture.awayScore))) * 0.35;
  const qualityScale = clamp(fixture.dataQuality ?? 0.72, 0.5, 1);
  const adjustment = clamp(config.baseK * goalMarginScale * qualityScale, 12, 40) * (actualHome - expectedHome);
  home.elo += adjustment;
  away.elo -= adjustment;
}

export function deriveFootballChronologyFeatures(
  fixtures: readonly HistoricalFootballFixtureInput[],
  inputConfig: FootballChronologyFeatureConfig = {}
): HistoricalFootballFixtureInput[] {
  const config = resolvedConfig(inputConfig);
  const indexed = fixtures
    .map((fixture, index) => ({ fixture, index, timestamp: Date.parse(fixture.kickoffAt) }))
    .filter((item) => Number.isFinite(item.timestamp) && teamKey(item.fixture, "home") !== teamKey(item.fixture, "away"))
    .sort((left, right) => left.timestamp - right.timestamp || left.fixture.externalId.localeCompare(right.fixture.externalId));
  const output = fixtures.map((fixture) => ({ ...fixture }));
  const teams = new Map<string, TeamState>();
  const leagues = new Map<string, LeagueState>();

  for (let cursor = 0; cursor < indexed.length;) {
    const timestamp = indexed[cursor]!.timestamp;
    const group: typeof indexed = [];
    while (cursor < indexed.length && indexed[cursor]!.timestamp === timestamp) {
      group.push(indexed[cursor]!);
      cursor += 1;
    }

    for (const item of group) {
      const fixture = item.fixture;
      const season = cleanText(fixture.season) || String(new Date(fixture.kickoffAt).getUTCFullYear());
      const league = leagues.get(leagueKey(fixture)) ?? emptyLeagueState();
      const home = teams.get(teamKey(fixture, "home")) ?? emptyTeamState(config.initialElo);
      const away = teams.get(teamKey(fixture, "away")) ?? emptyTeamState(config.initialElo);
      leagues.set(leagueKey(fixture), league);
      teams.set(teamKey(fixture, "home"), home);
      teams.set(teamKey(fixture, "away"), away);
      prepareTeamForSeason(home, season, config);
      prepareTeamForSeason(away, season, config);
      output[item.index] = {
        ...fixture,
        homeFeatures: mergeFeature(
          derivedFeatureState({ team: home, league, kickoffAt: fixture.kickoffAt, season, side: "home", config }),
          fixture.homeFeatures
        ),
        awayFeatures: mergeFeature(
          derivedFeatureState({ team: away, league, kickoffAt: fixture.kickoffAt, season, side: "away", config }),
          fixture.awayFeatures
        )
      };
    }

    for (const item of group) {
      const fixture = item.fixture;
      if (fixture.status !== "finished" || !validScore(fixture.homeScore) || !validScore(fixture.awayScore)) continue;
      const home = teams.get(teamKey(fixture, "home"))!;
      const away = teams.get(teamKey(fixture, "away"))!;
      const league = leagues.get(leagueKey(fixture))!;
      const season = cleanText(fixture.season) || String(new Date(fixture.kickoffAt).getUTCFullYear());
      updateRatings({ fixture, home, away, config });
      updateTeamState(home, fixture.homeScore, fixture.awayScore, fixture.kickoffAt, season, config.strengthWindow);
      updateTeamState(away, fixture.awayScore, fixture.homeScore, fixture.kickoffAt, season, config.strengthWindow);
      league.totalGoals += fixture.homeScore + fixture.awayScore;
      league.teamAppearances += 2;
      league.matches += 1;
    }
  }

  return output;
}
