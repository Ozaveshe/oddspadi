import { firstConfiguredEnv } from "@/lib/env";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { fetchOpenMeteoForecast } from "@/lib/sports/providers/openMeteo";
import {
  getHistoricalFootballElo,
  loadHistoricalFootballElo,
  type HistoricalFootballEloMap
} from "@/lib/sports/prediction/historicalElo";
import {
  getHistoricalBasketballStrength,
  loadHistoricalBasketballStrength,
  type HistoricalBasketballStrengthMap,
  type HistoricalBasketballStrengthRating
} from "@/lib/sports/prediction/historicalBasketballStrength";
import {
  getHistoricalTennisStrength,
  loadHistoricalTennisStrength,
  type HistoricalTennisStrengthMap,
  type HistoricalTennisStrengthRating
} from "@/lib/sports/prediction/historicalTennisStrength";
import type { Match, MatchContextSignal, MatchStatus, OddsMarket, Sport, SportsDataProvider, TeamForm } from "@/lib/sports/types";

type EnvMap = Record<string, string | undefined>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type ApiFootballFixture = {
  fixture?: {
    id?: number | string;
    date?: string;
    status?: {
      short?: string;
      elapsed?: number | null;
    };
    venue?: {
      name?: string | null;
      city?: string | null;
    };
  };
  league?: {
    id?: number | string;
    name?: string;
    country?: string;
    season?: number | string;
  };
  teams?: {
    home?: { id?: number | string; name?: string };
    away?: { id?: number | string; name?: string };
  };
  goals?: {
    home?: number | null;
    away?: number | null;
  };
};

type ApiFootballResponse = {
  response?: ApiFootballFixture[];
};

type ApiBasketballGame = {
  id?: number | string;
  date?: string | { date?: string; time?: string; timestamp?: number };
  time?: string;
  status?: { short?: string; long?: string } | string;
  league?: {
    id?: number | string;
    name?: string;
    country?: string;
    season?: number | string;
  };
  teams?: {
    home?: { id?: number | string; name?: string };
    away?: { id?: number | string; name?: string };
  };
  scores?: {
    home?: { total?: number | string | null };
    away?: { total?: number | string | null };
  };
};

type ApiBasketballResponse = {
  response?: ApiBasketballGame[];
};

type ApiTennisEvent = {
  event_key?: number | string;
  id?: number | string;
  event_date?: string;
  event_time?: string;
  event_status?: string;
  event_first_player?: string;
  event_second_player?: string;
  first_player_key?: number | string;
  second_player_key?: number | string;
  event_final_result?: string;
  event_game_result?: string;
  tournament_key?: number | string;
  tournament_name?: string;
  tournament_round?: string;
  tournament_season?: string;
  league_key?: number | string;
  league_name?: string;
  surface?: string;
  event_surface?: string;
};

type ApiTennisResponse = {
  result?: ApiTennisEvent[];
  response?: ApiTennisEvent[];
};

type ApiFootballLineup = {
  team?: {
    id?: number | string;
    name?: string;
  };
  formation?: string;
  startXI?: Array<{
    player?: {
      id?: number | string;
      name?: string;
      pos?: string;
    };
  }>;
};

type ApiFootballLineupResponse = {
  response?: ApiFootballLineup[];
};

type ApiFootballInjury = {
  player?: {
    id?: number | string;
    name?: string;
    type?: string;
    reason?: string;
  };
  team?: {
    id?: number | string;
    name?: string;
  };
};

type ApiFootballInjuryResponse = {
  response?: ApiFootballInjury[];
};

type ApiFootballEvent = {
  time?: {
    elapsed?: number | null;
    extra?: number | null;
  };
  team?: {
    id?: number | string;
    name?: string;
  };
  player?: {
    id?: number | string;
    name?: string;
  };
  assist?: {
    id?: number | string;
    name?: string;
  };
  type?: string;
  detail?: string;
  comments?: string | null;
};

type ApiFootballEventResponse = {
  response?: ApiFootballEvent[];
};

type ApiFootballStanding = {
  rank?: number;
  team?: {
    id?: number | string;
    name?: string;
  };
  points?: number;
  goalsDiff?: number;
  form?: string;
};

type ApiFootballStandingsResponse = {
  response?: Array<{
    league?: {
      standings?: ApiFootballStanding[][];
    };
  }>;
};

type OddsApiOutcome = {
  name?: string;
  price?: number;
  point?: number;
};

type OddsApiMarket = {
  key?: string;
  outcomes?: OddsApiOutcome[];
};

type OddsApiBookmaker = {
  title?: string;
  markets?: OddsApiMarket[];
};

type OddsApiEvent = {
  id?: string;
  sport_key?: string;
  sport_title?: string;
  commence_time?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: OddsApiBookmaker[];
  completed?: boolean;
  last_update?: string;
  scores?: Array<{
    name?: string;
    score?: string | number;
  }> | null;
};

type OddsApiHistoricalResponse = {
  timestamp?: string;
  data?: OddsApiEvent[];
};

type ProviderRuntimeStatus = {
  runtimeProvider: "providerBackedSportsDataProvider" | "mockSportsDataProvider";
  liveRuntimeBacked: boolean;
  sportsApiConfigured: boolean;
  oddsApiConfigured: boolean;
  weatherApiConfigured: boolean;
};

type OddsEventCacheEntry = {
  expiresAt: number;
  events: Promise<OddsApiEvent[]>;
};

type FixtureCacheEntry = {
  expiresAt: number;
  matches: Promise<Match[]>;
};

type MatchCacheEntry = {
  expiresAt: number;
  match: Match;
};

type OpenWeatherForecastItem = {
  dt?: number;
  dt_txt?: string;
  main?: {
    temp?: number;
  };
  weather?: Array<{
    main?: string;
    description?: string;
  }>;
  wind?: {
    speed?: number;
  };
  pop?: number;
  rain?: {
    "3h"?: number;
  };
  snow?: {
    "3h"?: number;
  };
};

type OpenWeatherForecastResponse = {
  list?: OpenWeatherForecastItem[];
};

type NewsApiArticle = {
  source?: {
    name?: string | null;
  };
  author?: string | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  publishedAt?: string | null;
};

type NewsApiResponse = {
  status?: string;
  totalResults?: number;
  articles?: NewsApiArticle[];
};

function firstEnv(env: EnvMap, keys: string[]): string {
  return firstConfiguredEnv(env, keys);
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeId(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function normalizedTeamName(value: string): string {
  return value.toLowerCase().replace(/\b(fc|cf|afc|sc|ac)\b/g, "").replace(/[^a-z0-9]+/g, "");
}

const TEAM_ALIASES_BY_NORMALIZED_NAME: Record<string, string[]> = {
  brightonhovealbion: ["brighton", "brightonandhovealbion"],
  brightonandhovealbion: ["brighton", "brightonhovealbion"],
  crystalpalace: ["palace"],
  ipswichtown: ["ipswich"],
  leedsunited: ["leeds"],
  manchestercity: ["mancity"],
  manchesterunited: ["manutd", "manunited"],
  newcastleunited: ["newcastle"],
  nottinghamforest: ["nottingham"],
  tottenhamhotspur: ["tottenham", "spurs"],
  westhamunited: ["westham"],
  wolverhamptonwanderers: ["wolverhampton", "wolves"]
};

function seedFromText(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function ratingFromName(name: string, leagueStrength: number): number {
  const seed = seedFromText(name);
  return Math.round(64 + leagueStrength * 24 + (seed % 11));
}

type FootballRatingResolution = {
  rating: number;
  evidence: NonNullable<Match["homeTeam"]["ratingEvidence"]>;
  historical: boolean;
};

function leagueBaselineRating(leagueStrength: number): number {
  return Math.round(clampRange(64 + leagueStrength * 24, 60, 96));
}

function providerFootballFormRating(form: TeamForm, leagueStrength: number): number {
  const samples = form.recentResults.length;
  const points = form.recentResults.reduce((total, result) => total + (result === "W" ? 3 : result === "D" ? 1 : 0), 0);
  const performance = samples ? points / (samples * 3) : 0.5;
  const goalDifference = form.goalsFor - form.goalsAgainst;
  return Math.round(clampRange(leagueBaselineRating(leagueStrength) + (performance - 0.5) * 12 + goalDifference * 1.8, 60, 100));
}

function isEnglishPremierLeague(country: string, leagueName: string, leagueId = ""): boolean {
  const normalizedCountry = country.trim().toLowerCase();
  const normalizedLeague = leagueName.trim().toLowerCase();
  const normalizedId = leagueId.trim().toLowerCase();
  return (
    (normalizedCountry === "england" && normalizedLeague.includes("premier league")) ||
    normalizedId === "epl" ||
    normalizedId.endsWith(":39") ||
    normalizedId.includes("soccer_epl")
  );
}

function resolveFootballRating(input: {
  name: string;
  leagueStrength: number;
  form?: TeamForm | null;
  historicalRatings: HistoricalFootballEloMap;
  historicalApplicable: boolean;
}): FootballRatingResolution {
  const historical = input.historicalApplicable ? getHistoricalFootballElo(input.historicalRatings, input.name) : undefined;
  if (historical) {
    return {
      rating: historical.modelRating,
      evidence: {
        source: "supabase-football-data-historical-elo-v1",
        rawRating: historical.rawElo,
        sampleSize: historical.matchCount,
        asOf: historical.asOf
      },
      historical: true
    };
  }

  if (input.form && input.form.recentResults.length) {
    return {
      rating: providerFootballFormRating(input.form, input.leagueStrength),
      evidence: {
        source: "api-football-recent-fixtures-form-rating-v1",
        sampleSize: input.form.recentResults.length
      },
      historical: false
    };
  }

  return {
    rating: leagueBaselineRating(input.leagueStrength),
    evidence: {
      source: "league-strength-baseline-v1",
      sampleSize: 0
    },
    historical: false
  };
}

function combinedStrengthProvider(home: FootballRatingResolution, away: FootballRatingResolution): string {
  const sources = Array.from(new Set([home.evidence.source, away.evidence.source])).sort();
  return sources.length === 1 ? sources[0] : `mixed:${sources.join("+")}`;
}

type HistoricalStrengthResolution = {
  rating: number;
  evidence: NonNullable<Match["homeTeam"]["ratingEvidence"]>;
  historical: boolean;
};

function combinedHistoricalStrengthProvider(home: HistoricalStrengthResolution, away: HistoricalStrengthResolution): string {
  const sources = Array.from(new Set([home.evidence.source, away.evidence.source])).sort();
  return sources.length === 1 ? sources[0] : `mixed:${sources.join("+")}`;
}

function resolveBasketballRating(
  teamName: string,
  leagueStrength: number,
  strengths: HistoricalBasketballStrengthMap
): HistoricalStrengthResolution {
  const historical = getHistoricalBasketballStrength(strengths, teamName);
  if (historical) {
    return {
      rating: historical.modelRating,
      evidence: {
        source: "supabase-basketball-historical-strength-v1",
        rawRating: historical.rawRating,
        sampleSize: historical.sampleSize,
        asOf: historical.asOf,
        pace: historical.pace,
        offensiveEfficiency: historical.offensiveEfficiency,
        defensiveEfficiency: historical.defensiveEfficiency,
        restDays: historical.restDays,
        recentFormPoints: historical.recentFormPoints
      },
      historical: true
    };
  }
  return {
    rating: leagueBaselineRating(leagueStrength),
    evidence: { source: "league-strength-baseline-v1", sampleSize: 0 },
    historical: false
  };
}

function basketballFormFromStrength(teamId: string, strength: HistoricalBasketballStrengthRating | undefined, rating: number): TeamForm {
  if (!strength) return buildProviderForm(teamId, rating, 0);
  const offense = strength.offensiveEfficiency ?? 110;
  const defense = strength.defensiveEfficiency ?? 110;
  return {
    teamId,
    recentResults: [],
    goalsFor: Number(offense.toFixed(2)),
    goalsAgainst: Number(defense.toFixed(2)),
    attackStrength: Number(clampRange((offense - 92) / 24, 0.35, 1.45).toFixed(3)),
    defenseStrength: Number(clampRange((124 - defense) / 24, 0.35, 1.45).toFixed(3))
  };
}

function basketballHistoricalRestSignal(
  eventId: string,
  homeName: string,
  awayName: string,
  home: HistoricalBasketballStrengthRating | undefined,
  away: HistoricalBasketballStrengthRating | undefined
): MatchContextSignal | null {
  if (home?.restDays === null || home?.restDays === undefined || away?.restDays === null || away?.restDays === undefined) return null;
  const delta = home.restDays - away.restDays;
  return providerSignal({
    id: `${eventId}-historical-basketball-rest`,
    category: "rest",
    label: "Stored schedule rest evidence",
    detail: `${homeName} rest ${home.restDays} day(s); ${awayName} rest ${away.restDays} day(s). Historical feature dates: ${home.asOf.slice(
      0,
      10
    )} and ${away.asOf.slice(0, 10)}.`,
    quality: "acceptable",
    impact: delta > 0 ? "home-positive" : delta < 0 ? "away-positive" : "neutral",
    confidence: 0.7,
    weight: 0,
    source: "supabase-basketball-historical-strength"
  });
}

function resolveTennisRating(
  playerName: string,
  surface: string | null,
  leagueStrength: number,
  strengths: HistoricalTennisStrengthMap
): HistoricalStrengthResolution {
  const surfaceStrength = surface ? getHistoricalTennisStrength(strengths, playerName, surface) : undefined;
  const historical = surfaceStrength ?? getHistoricalTennisStrength(strengths, playerName);
  if (historical) {
    return {
      rating: historical.modelRating,
      evidence: {
        source: surfaceStrength ? "supabase-tennis-historical-surface-strength-v1" : "supabase-tennis-historical-overall-strength-v1",
        rawRating: historical.rawElo,
        sampleSize: historical.sampleSize,
        asOf: historical.asOf,
        restDays: historical.restDays,
        recentFormPoints: historical.recentFormPoints,
        surface: historical.surface,
        attackStrength: historical.attackStrength,
        defenseStrength: historical.defenseStrength,
        rank: historical.rank,
        rankingPoints: historical.rankingPoints
      },
      historical: true
    };
  }
  return {
    rating: leagueBaselineRating(leagueStrength),
    evidence: { source: "league-strength-baseline-v1", sampleSize: 0, surface },
    historical: false
  };
}

function tennisFormFromStrength(teamId: string, strength: HistoricalTennisStrengthRating | undefined, rating: number): TeamForm {
  if (!strength) return buildProviderForm(teamId, rating, 0);
  return {
    teamId,
    recentResults: [],
    goalsFor: strength.recentFormPoints ?? 0,
    goalsAgainst: 0,
    attackStrength: Number((strength.attackStrength ?? 0.5).toFixed(4)),
    defenseStrength: Number((strength.defenseStrength ?? 0.5).toFixed(4))
  };
}

function buildProviderForm(teamId: string, rating: number, offset: number): TeamForm {
  const seed = seedFromText(teamId) + offset;
  const recentResults: TeamForm["recentResults"] = [];
  for (let index = 0; index < 5; index += 1) {
    const marker = (seed + index * 5 + Math.round(rating)) % 10;
    recentResults.push(marker >= 6 ? "W" : marker >= 3 ? "D" : "L");
  }
  return {
    teamId,
    recentResults,
    goalsFor: Number((1.08 + (rating - 65) / 34 + (seed % 4) * 0.12).toFixed(2)),
    goalsAgainst: Number((1.5 - (rating - 65) / 58 + (seed % 3) * 0.1).toFixed(2)),
    attackStrength: Number((0.56 + (rating - 65) / 44 + (seed % 5) * 0.018).toFixed(2)),
    defenseStrength: Number((0.54 + (rating - 65) / 50 + (seed % 4) * 0.018).toFixed(2))
  };
}

function matchStatus(shortStatus: string | undefined): MatchStatus {
  if (["FT", "AET", "PEN"].includes(shortStatus ?? "")) return "finished";
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(shortStatus ?? "")) return "live";
  return "scheduled";
}

function basketballStatus(status: ApiBasketballGame["status"]): MatchStatus {
  const text = typeof status === "string" ? status : `${status?.short ?? ""} ${status?.long ?? ""}`;
  const normalized = text.toLowerCase();
  if (["ft", "aot", "after over time", "finished", "game finished", "ended"].some((term) => normalized.includes(term))) return "finished";
  if (["q1", "q2", "q3", "q4", "ot", "live", "halftime", "in play"].some((term) => normalized.includes(term))) return "live";
  return "scheduled";
}

function tennisStatus(status: string | undefined): MatchStatus {
  const normalized = cleanText(status).toLowerCase();
  if (["finished", "complete", "ended", "retired", "walkover"].some((term) => normalized.includes(term))) return "finished";
  if (["live", "set", "game", "in progress"].some((term) => normalized.includes(term))) return "live";
  return "scheduled";
}

function leagueStrength(country: string, leagueName: string): number {
  const text = `${country} ${leagueName}`.toLowerCase();
  if (text.includes("champions league")) return 0.98;
  if (text.includes("england") || text.includes("premier league")) return 0.94;
  if (text.includes("spain") || text.includes("italy") || text.includes("germany")) return 0.9;
  if (text.includes("france") || text.includes("netherlands") || text.includes("portugal")) return 0.85;
  if (text.includes("nigeria") || text.includes("ghana") || text.includes("kenya") || text.includes("south africa")) return 0.7;
  return 0.78;
}

function dataQualityForFixture(item: ApiFootballFixture, hasOdds: boolean, hasProviderForm: boolean): number {
  let score = 0.62;
  if (item.fixture?.id) score += 0.05;
  if (item.fixture?.date) score += 0.05;
  if (item.league?.id && item.league?.name) score += 0.06;
  if (item.teams?.home?.id && item.teams?.away?.id) score += 0.06;
  if (hasOdds) score += 0.1;
  if (hasProviderForm) score += 0.08;
  if (typeof item.goals?.home === "number" && typeof item.goals?.away === "number") score += 0.06;
  return Math.min(0.92, Math.round(score * 100) / 100);
}

function dataQualityForOddsBackedEvent(event: OddsApiEvent, oddsMarkets: OddsMarket[]): number {
  let score = 0.58;
  if (event.id) score += 0.05;
  if (event.commence_time) score += 0.08;
  if (event.sport_key && event.sport_title) score += 0.06;
  if (event.home_team && event.away_team) score += 0.08;
  if (oddsMarkets.length) score += 0.14;
  return Math.min(0.86, Math.round(score * 100) / 100);
}

function basketballDataQuality(game: ApiBasketballGame): number {
  let score = 0.54;
  if (game.id) score += 0.08;
  if (game.date) score += 0.08;
  if (game.league?.id && game.league?.name) score += 0.08;
  if (game.teams?.home?.id && game.teams?.away?.id) score += 0.08;
  if (numberOrNull(game.scores?.home?.total) !== null && numberOrNull(game.scores?.away?.total) !== null) score += 0.08;
  return Math.min(0.88, Math.round(score * 100) / 100);
}

function tennisDataQuality(event: ApiTennisEvent): number {
  let score = 0.52;
  if (event.event_key || event.id) score += 0.08;
  if (event.event_date) score += 0.08;
  if (event.tournament_key || event.league_key || event.tournament_name || event.league_name) score += 0.08;
  if (event.event_first_player && event.event_second_player) score += 0.08;
  if (event.event_final_result || event.event_game_result) score += 0.08;
  return Math.min(0.86, Math.round(score * 100) / 100);
}

function sameTeam(a: string, b: string): boolean {
  return normalizedTeamName(a) === normalizedTeamName(b);
}

function isSuspension(injury: ApiFootballInjury): boolean {
  const text = `${injury.player?.type ?? ""} ${injury.player?.reason ?? ""}`.toLowerCase();
  return text.includes("suspend") || text.includes("red card") || text.includes("ban");
}

function isGoalEvent(event: ApiFootballEvent): boolean {
  const type = cleanText(event.type).toLowerCase();
  const detail = cleanText(event.detail).toLowerCase();
  if (!type.includes("goal")) return false;
  return !detail.includes("missed") && !detail.includes("cancelled") && !detail.includes("disallowed");
}

function isRedCardEvent(event: ApiFootballEvent): boolean {
  const type = cleanText(event.type).toLowerCase();
  const detail = cleanText(event.detail).toLowerCase();
  return type.includes("card") && detail.includes("red");
}

function isSubstitutionEvent(event: ApiFootballEvent): boolean {
  const type = cleanText(event.type).toLowerCase();
  return type.includes("subst");
}

function countTeamEvents(events: ApiFootballEvent[], teamName: string, predicate: (event: ApiFootballEvent) => boolean): number {
  return events.filter((event) => sameTeam(cleanText(event.team?.name), teamName) && predicate(event)).length;
}

function latestEventMinute(events: ApiFootballEvent[]): number | null {
  const minutes = events.flatMap((event) => (typeof event.time?.elapsed === "number" ? [event.time.elapsed] : []));
  return minutes.length ? Math.max(...minutes) : null;
}

function articleText(article: NewsApiArticle): string {
  return `${cleanText(article.title)} ${cleanText(article.description)}`.trim();
}

function mentionsTeam(article: NewsApiArticle, teamName: string): boolean {
  const text = normalizedTeamName(articleText(article));
  const team = normalizedTeamName(teamName);
  return Boolean(team && text.includes(team));
}

function hasAdverseNewsLanguage(article: NewsApiArticle): boolean {
  const text = articleText(article).toLowerCase();
  return [
    "injury",
    "injured",
    "doubtful",
    "suspended",
    "suspension",
    "ban",
    "banned",
    "ruled out",
    "setback",
    "illness",
    "absent",
    "fitness doubt",
    "late fitness",
    "rotation",
    "rested"
  ].some((term) => text.includes(term));
}

function providerSignal({ publishedAt, ...input }: Omit<MatchContextSignal, "publishedAt"> & { publishedAt?: string }): MatchContextSignal {
  return {
    ...input,
    publishedAt: publishedAt ?? new Date().toISOString()
  };
}

const FOOTBALL_VENUES_BY_TEAM: Record<string, { name: string; city: string; country: string }> = {
  arsenal: { name: "Emirates Stadium", city: "London", country: "England" },
  astonvilla: { name: "Villa Park", city: "Birmingham", country: "England" },
  bournemouth: { name: "Vitality Stadium", city: "Bournemouth", country: "England" },
  brentford: { name: "Gtech Community Stadium", city: "London", country: "England" },
  brightonhovealbion: { name: "Amex Stadium", city: "Brighton", country: "England" },
  burnley: { name: "Turf Moor", city: "Burnley", country: "England" },
  chelsea: { name: "Stamford Bridge", city: "London", country: "England" },
  coventrycity: { name: "Coventry Building Society Arena", city: "Coventry", country: "England" },
  crystalpalace: { name: "Selhurst Park", city: "London", country: "England" },
  everton: { name: "Hill Dickinson Stadium", city: "Liverpool", country: "England" },
  fulham: { name: "Craven Cottage", city: "London", country: "England" },
  hullcity: { name: "MKM Stadium", city: "Hull", country: "England" },
  leedsunited: { name: "Elland Road", city: "Leeds", country: "England" },
  liverpool: { name: "Anfield", city: "Liverpool", country: "England" },
  manchestercity: { name: "Etihad Stadium", city: "Manchester", country: "England" },
  manchesterunited: { name: "Old Trafford", city: "Manchester", country: "England" },
  newcastleunited: { name: "St James' Park", city: "Newcastle upon Tyne", country: "England" },
  nottinghamforest: { name: "City Ground", city: "Nottingham", country: "England" },
  sunderland: { name: "Stadium of Light", city: "Sunderland", country: "England" },
  tottenhamhotspur: { name: "Tottenham Hotspur Stadium", city: "London", country: "England" },
  westhamunited: { name: "London Stadium", city: "London", country: "England" },
  wolverhamptonwanderers: { name: "Molineux Stadium", city: "Wolverhampton", country: "England" }
};

function footballVenueForTeam(teamName: string): { name: string; city: string; country: string } | null {
  return FOOTBALL_VENUES_BY_TEAM[normalizedTeamName(teamName)] ?? null;
}

function forecastWindowWeatherSignal({
  matchId,
  kickoffTime,
  venue
}: {
  matchId: string;
  kickoffTime: string;
  venue: { name?: string | null; city?: string | null; country?: string | null } | null;
}): MatchContextSignal | null {
  const city = cleanText(venue?.city);
  if (!city) return null;
  const kickoffMs = new Date(kickoffTime).getTime();
  if (!Number.isFinite(kickoffMs)) return null;
  const daysUntilKickoff = Math.ceil((kickoffMs - Date.now()) / 86_400_000);
  const forecastWindowDays = 14;
  const insideForecastWindow = daysUntilKickoff <= forecastWindowDays;

  return providerSignal({
    id: `${matchId}-weather-forecast-window`,
    category: "weather",
    label: insideForecastWindow ? "Weather forecast window open" : "Weather forecast window pending",
    detail: insideForecastWindow
      ? `${city} is inside the ${forecastWindowDays}-day weather forecast window; fetch OpenWeather or weather-provider data before trusting totals and tempo.`
      : `${city} weather is not forecastable yet for kickoff; refresh within ${forecastWindowDays} days of the match before trusting totals and tempo.`,
    quality: "thin",
    impact: "unknown",
    confidence: insideForecastWindow ? 0.54 : 0.46,
    weight: 0,
    source: "computed-weather-window"
  });
}

function basketballKickoff(game: ApiBasketballGame): string {
  if (typeof game.date === "string") return game.date.includes("T") ? game.date : `${game.date}T${game.time || "00:00"}:00.000Z`;
  if (typeof game.date?.timestamp === "number") return new Date(game.date.timestamp * 1000).toISOString();
  const date = cleanText(game.date?.date);
  const time = cleanText(game.date?.time || game.time) || "00:00";
  return date ? `${date}T${time}:00.000Z` : new Date().toISOString();
}

function tennisKickoff(event: ApiTennisEvent): string {
  const date = cleanText(event.event_date);
  const time = cleanText(event.event_time) || "00:00";
  return date ? `${date}T${time}:00.000Z` : new Date().toISOString();
}

function tennisSurface(value: string | undefined): string | null {
  const text = cleanText(value).toLowerCase();
  if (!text) return null;
  if (text.includes("clay")) return "clay";
  if (text.includes("grass")) return "grass";
  if (text.includes("indoor")) return "indoor";
  if (text.includes("hard")) return "hard";
  return text;
}

function tennisSurfaceFromOddsEvent(sportKey: string, sportTitle: string): string | null {
  const text = `${sportKey} ${sportTitle}`.toLowerCase().replace(/[_-]+/g, " ");
  if (text.includes("wimbledon")) return "grass";
  if (text.includes("french open") || text.includes("roland garros")) return "clay";
  if (text.includes("australian open") || text.includes("us open")) return "hard";
  return tennisSurface(sportTitle);
}

function parseTennisScore(value: string | undefined): { home: number | null; away: number | null } {
  const text = cleanText(value);
  if (!text) return { home: null, away: null };
  const setScores = text.match(/\d+-\d+/g) ?? [];
  if (!setScores.length) return { home: null, away: null };
  return setScores.reduce(
    (score, setText) => {
      const [home, away] = setText.split("-").map((part) => Number(part));
      if (!Number.isFinite(home) || !Number.isFinite(away) || home === away) return score;
      return home > away ? { ...score, home: score.home + 1 } : { ...score, away: score.away + 1 };
    },
    { home: 0, away: 0 }
  );
}

function outcomeSelection(outcomeName: string | undefined, homeName: string, awayName: string): "home" | "draw" | "away" | null {
  const value = normalizedTeamName(cleanText(outcomeName));
  if (!value) return null;
  if (value === "draw" || value === "tie") return "draw";
  if (teamAliasKeys(homeName).includes(value)) return "home";
  if (teamAliasKeys(awayName).includes(value)) return "away";
  return null;
}

type CoherentOddsQuote = {
  point?: number;
  selections: OddsMarket["selections"];
};

function quoteMargin(quote: CoherentOddsQuote): number {
  return quote.selections.reduce((sum, selection) => sum + 1 / selection.decimalOdds, 0) - 1;
}

function quoteQuality(quote: CoherentOddsQuote): number {
  const margin = quoteMargin(quote);
  return margin >= 0 ? margin : 0.5 + Math.abs(margin);
}

function bestCoherentQuote(quotes: CoherentOddsQuote[]): CoherentOddsQuote | null {
  return quotes.slice().sort((a, b) => quoteQuality(a) - quoteQuality(b))[0] ?? null;
}

function consensusPointQuote(quotes: CoherentOddsQuote[]): CoherentOddsQuote | null {
  const withPoint = quotes.filter((quote): quote is CoherentOddsQuote & { point: number } => typeof quote.point === "number" && Number.isFinite(quote.point));
  if (!withPoint.length) return null;

  const byPoint = new Map<string, Array<CoherentOddsQuote & { point: number }>>();
  for (const quote of withPoint) {
    const key = quote.point.toFixed(3);
    byPoint.set(key, [...(byPoint.get(key) ?? []), quote]);
  }

  const leadingGroup = [...byPoint.values()].sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return quoteQuality(a[0]) - quoteQuality(b[0]);
  })[0];
  return leadingGroup ? bestCoherentQuote(leadingGroup) : null;
}

function oddsMarketsForEvent(event: OddsApiEvent, sport: Extract<Sport, "football" | "basketball" | "tennis"> = "football"): OddsMarket[] {
  const homeName = cleanText(event.home_team);
  const awayName = cleanText(event.away_team);
  const bookmakers = event.bookmakers ?? [];
  const h2hQuote = bestCoherentQuote(
    bookmakers.flatMap((bookmaker) =>
      (bookmaker.markets ?? []).filter((market) => market.key === "h2h").flatMap((market) => {
        const prices = (market.outcomes ?? []).reduce<Partial<Record<"home" | "draw" | "away", number>>>((acc, outcome) => {
          const selection = outcomeSelection(outcome.name, homeName, awayName);
          if (!selection || typeof outcome.price !== "number" || outcome.price <= 1) return acc;
          acc[selection] = Math.max(acc[selection] ?? 0, outcome.price);
          return acc;
        }, {});
        if (!prices.home || !prices.away || (sport === "football" && !prices.draw)) return [];
        return [
          {
            selections: [
              { id: "home", label: homeName, decimalOdds: prices.home },
              ...(sport === "football" ? [{ id: "draw", label: "Draw", decimalOdds: prices.draw as number }] : []),
              { id: "away", label: awayName, decimalOdds: prices.away }
            ]
          }
        ];
      })
    )
  );

  const markets: OddsMarket[] = [];
  if (h2hQuote) {
    markets.push({
      id: "match_winner",
      name: sport === "basketball" ? "Moneyline" : "Match winner",
      selections: h2hQuote.selections
    });
  }

  const spreadQuote = consensusPointQuote(
    bookmakers.flatMap((bookmaker) =>
      (bookmaker.markets ?? []).filter((market) => market.key === "spreads").flatMap((market) => {
        const outcomes = market.outcomes ?? [];
        return outcomes.flatMap((homeOutcome) => {
          const homeSelection = outcomeSelection(homeOutcome.name, homeName, awayName);
          if (homeSelection !== "home" || typeof homeOutcome.price !== "number" || homeOutcome.price <= 1 || typeof homeOutcome.point !== "number") return [];
          const awayOutcome = outcomes.find(
            (outcome) =>
              outcomeSelection(outcome.name, homeName, awayName) === "away" &&
              typeof outcome.price === "number" &&
              outcome.price > 1 &&
              typeof outcome.point === "number" &&
              Math.abs(outcome.point + homeOutcome.point!) < 0.001
          );
          if (!awayOutcome || typeof awayOutcome.price !== "number" || typeof awayOutcome.point !== "number") return [];
          return [
            {
              point: homeOutcome.point,
              selections: [
                {
                  id: "home_cover",
                  label: `${homeName} ${homeOutcome.point > 0 ? "+" : ""}${homeOutcome.point}`,
                  decimalOdds: homeOutcome.price
                },
                {
                  id: "away_cover",
                  label: `${awayName} ${awayOutcome.point > 0 ? "+" : ""}${awayOutcome.point}`,
                  decimalOdds: awayOutcome.price
                }
              ]
            }
          ];
        });
      })
    )
  );
  if (sport === "basketball" && spreadQuote) {
    markets.push({
      id: "spread",
      name: "Spread",
      selections: spreadQuote.selections
    });
  }

  const totalQuotes = bookmakers.flatMap((bookmaker) =>
    (bookmaker.markets ?? []).filter((market) => market.key === "totals").flatMap((market) => {
      const outcomes = market.outcomes ?? [];
      return outcomes.flatMap((overOutcome) => {
        const overName = cleanText(overOutcome.name).toLowerCase();
        if (overName !== "over" || typeof overOutcome.price !== "number" || overOutcome.price <= 1 || typeof overOutcome.point !== "number") return [];
        const underOutcome = outcomes.find(
          (outcome) =>
            cleanText(outcome.name).toLowerCase() === "under" &&
            typeof outcome.price === "number" &&
            outcome.price > 1 &&
            typeof outcome.point === "number" &&
            Math.abs(outcome.point - overOutcome.point!) < 0.001
        );
        if (!underOutcome || typeof underOutcome.price !== "number") return [];
        return [
          {
            point: overOutcome.point,
            selections: [
              {
                id: sport === "football" ? "over_25" : "over",
                label: `Over ${overOutcome.point}`,
                decimalOdds: overOutcome.price
              },
              {
                id: sport === "football" ? "under_25" : "under",
                label: `Under ${overOutcome.point}`,
                decimalOdds: underOutcome.price
              }
            ]
          }
        ];
      });
    })
  );
  const totalQuote = sport === "football" ? bestCoherentQuote(totalQuotes.filter((quote) => quote.point === 2.5)) : consensusPointQuote(totalQuotes);
  if (totalQuote) {
    markets.push({
      id: sport === "tennis" ? "total_games" : sport === "basketball" ? "total_points" : "over_under_25",
      name: sport === "tennis" ? "Total games" : sport === "basketball" ? "Total points" : "Goals over/under",
      selections: totalQuote.selections
    });
  }

  const bttsQuote = bestCoherentQuote(
    bookmakers.flatMap((bookmaker) =>
      (bookmaker.markets ?? []).filter((market) => market.key === "btts").flatMap((market) => {
        const prices = (market.outcomes ?? []).reduce<Partial<Record<"yes" | "no", number>>>((acc, outcome) => {
          const selection = cleanText(outcome.name).toLowerCase();
          if ((selection === "yes" || selection === "no") && typeof outcome.price === "number" && outcome.price > 1) {
            acc[selection] = Math.max(acc[selection] ?? 0, outcome.price);
          }
          return acc;
        }, {});
        if (!prices.yes || !prices.no) return [];
        return [
          {
            selections: [
              { id: "yes", label: "Yes", decimalOdds: prices.yes },
              { id: "no", label: "No", decimalOdds: prices.no }
            ]
          }
        ];
      })
    )
  );
  if (sport === "football" && bttsQuote) {
    markets.push({
      id: "both_teams_to_score",
      name: "Both teams to score",
      selections: bttsQuote.selections
    });
  }

  return markets;
}

function eventKey(homeName: string, awayName: string, date: string): string {
  return `${normalizedTeamName(homeName)}:${normalizedTeamName(awayName)}:${date.slice(0, 10)}`;
}

function teamAliasKeys(name: string): string[] {
  const normalized = normalizedTeamName(name);
  const aliases = new Set([normalized, ...(TEAM_ALIASES_BY_NORMALIZED_NAME[normalized] ?? [])]);
  if (normalized.endsWith("city")) {
    const withoutCity = normalized.slice(0, -"city".length);
    if (withoutCity.length >= 6 && withoutCity !== "manchester") aliases.add(withoutCity);
  }
  if (normalized.endsWith("united") && normalized !== "manchesterunited") {
    const withoutUnited = normalized.slice(0, -"united".length);
    if (withoutUnited.length >= 5) aliases.add(withoutUnited);
  }
  return Array.from(aliases).filter(Boolean);
}

function eventKeys(homeName: string, awayName: string, date: string): string[] {
  const day = date.slice(0, 10);
  return teamAliasKeys(homeName).flatMap((home) => teamAliasKeys(awayName).map((away) => `${home}:${away}:${day}`));
}

function hasCompleteFootballMatchWinnerOdds(markets: OddsMarket[]): boolean {
  const market = markets.find((item) => item.id === "match_winner");
  return (["home", "draw", "away"] as const).every((selection) => market?.selections.some((item) => item.id === selection && item.decimalOdds > 1));
}

function oddsMarketsByEvent(events: OddsApiEvent[], sport: Extract<Sport, "football" | "basketball" | "tennis">): Map<string, OddsMarket[]> {
  const byKey = new Map<string, OddsMarket[]>();
  for (const event of events) {
    const kickoff = cleanText(event.commence_time);
    const homeName = cleanText(event.home_team);
    const awayName = cleanText(event.away_team);
    const markets = oddsMarketsForEvent(event, sport);
    if (markets.length) {
      for (const key of eventKeys(homeName, awayName, kickoff)) {
        if (!byKey.has(key)) byKey.set(key, markets);
      }
    }
  }
  return byKey;
}

function firstOddsMarketsForFixture(oddsByEvent: Map<string, OddsMarket[]>, homeName: string, awayName: string, kickoffTime: string): OddsMarket[] {
  for (const key of eventKeys(homeName, awayName, kickoffTime)) {
    const markets = oddsByEvent.get(key);
    if (markets?.length) return markets;
  }
  return [];
}

function firstOddsEventForFixture(events: OddsApiEvent[], homeName: string, awayName: string, kickoffTime: string): OddsApiEvent | null {
  const fixtureKeys = new Set(eventKeys(homeName, awayName, kickoffTime));
  return (
    events.find((event) => {
      const eventKickoff = cleanText(event.commence_time);
      const eventHome = cleanText(event.home_team);
      const eventAway = cleanText(event.away_team);
      return eventKeys(eventHome, eventAway, eventKickoff).some((key) => fixtureKeys.has(key));
    }) ?? null
  );
}

function matchEventKeys(match: Match): string[] {
  return eventKeys(match.homeTeam.name, match.awayTeam.name, match.kickoffTime);
}

function matchesByEventKey(matches: Match[]): Map<string, Match> {
  const byKey = new Map<string, Match>();
  for (const match of matches) {
    for (const key of matchEventKeys(match)) {
      if (!byKey.has(key)) byKey.set(key, match);
    }
  }
  return byKey;
}

function firstMatchForFixture(matchByEvent: Map<string, Match>, homeName: string, awayName: string, kickoffTime: string): Match | null {
  for (const key of eventKeys(homeName, awayName, kickoffTime)) {
    const match = matchByEvent.get(key);
    if (match) return match;
  }
  return null;
}

function oddsBackedFootballFixturesFromEvents(
  date: string,
  events: OddsApiEvent[],
  historicalRatings: HistoricalFootballEloMap = new Map()
): Match[] {
  return events.flatMap((event) => {
    const homeName = cleanText(event.home_team);
    const awayName = cleanText(event.away_team);
    const kickoffTime = cleanText(event.commence_time);
    if (!homeName || !awayName || !kickoffTime) return [];
    const oddsMarkets = oddsMarketsForEvent(event, "football");
    if (!oddsMarkets.length) return [];
    const sportKey = cleanText(event.sport_key);
    const rawLeagueName = cleanText(event.sport_title);
    const isEpl = sportKey.includes("soccer_epl") || rawLeagueName.toLowerCase() === "epl" || rawLeagueName.toLowerCase().includes("premier league");
    const leagueName = isEpl ? "Premier League" : rawLeagueName || "Football";
    const country = isEpl ? "England" : "World";
    const strength = leagueStrength(country, leagueName);
    const eventId = safeId(event.id, `${slug(homeName)}-${slug(awayName)}-${date}`);
    const homeId = `the-odds-api:${slug(homeName) || `home-${eventId}`}`;
    const awayId = `the-odds-api:${slug(awayName) || `away-${eventId}`}`;
    const historicalApplicable = isEnglishPremierLeague(country, leagueName, sportKey);
    const homeRating = resolveFootballRating({
      name: homeName,
      leagueStrength: strength,
      historicalRatings,
      historicalApplicable
    });
    const awayRating = resolveFootballRating({
      name: awayName,
      leagueStrength: strength,
      historicalRatings,
      historicalApplicable
    });
    const venue = footballVenueForTeam(homeName);
    const weatherSignal = forecastWindowWeatherSignal({
      matchId: `the-odds-api:${eventId}`,
      kickoffTime,
      venue
    });

    return [
      {
        id: `the-odds-api:${eventId}`,
        sport: "football" as const,
        league: {
          id: `the-odds-api:${sportKey || "soccer_epl"}`,
          name: leagueName,
          country,
          strength
        },
        kickoffTime,
        homeTeam: { id: homeId, name: homeName, rating: homeRating.rating, ratingEvidence: homeRating.evidence },
        awayTeam: { id: awayId, name: awayName, rating: awayRating.rating, ratingEvidence: awayRating.evidence },
        venue: venue ?? undefined,
        status: "scheduled" as const,
        oddsMarkets,
        homeForm: buildProviderForm(homeId, homeRating.rating, 7),
        awayForm: buildProviderForm(awayId, awayRating.rating, 23),
        dataQualityScore: dataQualityForOddsBackedEvent(event, oddsMarkets),
        providerContextSignals: weatherSignal ? [weatherSignal] : [],
        dataSource: {
          kind: "provider" as const,
          fixtureProvider: "the-odds-api-events",
          fixtureProviderId: eventId,
          oddsProvider: "the-odds-api",
          oddsProviderEventId: eventId,
          formProvider: "deterministic-provider-proxy",
          strengthProvider: combinedStrengthProvider(homeRating, awayRating),
          fetchedAt: new Date().toISOString(),
          notes: [
            "Fixture identity is sourced from a live/upcoming The Odds API market while API-Football fixture rows are unavailable.",
            homeRating.historical || awayRating.historical
              ? "Team strength includes historical Elo learned from real football-data results stored in OddsPadi Supabase."
              : "Historical EPL Elo was unavailable or not applicable; team strength uses a league baseline until provider form is attached.",
            venue
              ? `Home venue inferred for weather planning: ${venue.name}, ${venue.city}.`
              : "Home venue could not be inferred from the odds event alone.",
            "Recent form, lineups, injuries, standings, news, actual weather, and match events still need provider-backed confirmation before trust can rise."
          ]
        }
      } satisfies Match
    ];
  });
}

function basketballCountryForSportKey(sportKey: string): string {
  if (sportKey.includes("wnba") || sportKey.includes("nba")) return "United States";
  if (sportKey.includes("euroleague")) return "Europe";
  if (sportKey.includes("nbl")) return "Australia";
  return "World";
}

function scoreForOddsEvent(event: OddsApiEvent): { home: number; away: number } | null {
  if (event.completed !== true || !Array.isArray(event.scores)) return null;
  const homeName = cleanText(event.home_team);
  const awayName = cleanText(event.away_team);
  const home = event.scores.find((score) => cleanText(score.name) === homeName)?.score;
  const away = event.scores.find((score) => cleanText(score.name) === awayName)?.score;
  const homeScore = typeof home === "number" ? home : Number(home);
  const awayScore = typeof away === "number" ? away : Number(away);
  return Number.isFinite(homeScore) && Number.isFinite(awayScore) ? { home: homeScore, away: awayScore } : null;
}

function mergeOddsAndScoreEvents(oddsEvents: OddsApiEvent[], scoreEvents: OddsApiEvent[]): OddsApiEvent[] {
  const byId = new Map<string, OddsApiEvent>();
  for (const event of [...scoreEvents, ...oddsEvents]) {
    const id = cleanText(event.id) || `${cleanText(event.sport_key)}:${cleanText(event.home_team)}:${cleanText(event.away_team)}:${cleanText(event.commence_time)}`;
    const existing = byId.get(id);
    byId.set(id, {
      ...(existing ?? {}),
      ...event,
      bookmakers: event.bookmakers?.length ? event.bookmakers : existing?.bookmakers,
      completed: event.completed ?? existing?.completed,
      scores: event.scores ?? existing?.scores,
      last_update: event.last_update ?? existing?.last_update
    });
  }
  return [...byId.values()];
}

function oddsBackedBasketballFixturesFromEvents(
  date: string,
  events: OddsApiEvent[],
  historicalStrengths: HistoricalBasketballStrengthMap = new Map()
): Match[] {
  return events.flatMap((event) => {
    const homeName = cleanText(event.home_team);
    const awayName = cleanText(event.away_team);
    const kickoffTime = cleanText(event.commence_time);
    if (!homeName || !awayName || !kickoffTime) return [];
    const oddsMarkets = oddsMarketsForEvent(event, "basketball");
    const finalScore = scoreForOddsEvent(event);
    if (!oddsMarkets.length && !finalScore) return [];

    const sportKey = cleanText(event.sport_key) || "basketball_nba";
    const leagueName = cleanText(event.sport_title) || "Basketball";
    const country = basketballCountryForSportKey(sportKey);
    const strength = leagueStrength(country, leagueName);
    const eventId = safeId(event.id, `${slug(homeName)}-${slug(awayName)}-${date}`);
    const homeId = `the-odds-api:${slug(homeName) || `home-${eventId}`}`;
    const awayId = `the-odds-api:${slug(awayName) || `away-${eventId}`}`;
    const homeHistorical = getHistoricalBasketballStrength(historicalStrengths, homeName);
    const awayHistorical = getHistoricalBasketballStrength(historicalStrengths, awayName);
    const homeRating = resolveBasketballRating(homeName, strength, historicalStrengths);
    const awayRating = resolveBasketballRating(awayName, strength, historicalStrengths);
    const restSignal = basketballHistoricalRestSignal(eventId, homeName, awayName, homeHistorical, awayHistorical);

    return [
      {
        id: `the-odds-api:${eventId}`,
        sport: "basketball" as const,
        league: {
          id: `the-odds-api:${sportKey}`,
          name: leagueName,
          country,
          strength
        },
        kickoffTime,
        homeTeam: { id: homeId, name: homeName, rating: homeRating.rating, ratingEvidence: homeRating.evidence },
        awayTeam: { id: awayId, name: awayName, rating: awayRating.rating, ratingEvidence: awayRating.evidence },
        status: finalScore ? ("finished" as const) : ("scheduled" as const),
        score: finalScore ?? undefined,
        oddsMarkets,
        homeForm: basketballFormFromStrength(homeId, homeHistorical, homeRating.rating),
        awayForm: basketballFormFromStrength(awayId, awayHistorical, awayRating.rating),
        dataQualityScore: dataQualityForOddsBackedEvent(event, oddsMarkets),
        providerContextSignals: restSignal ? [restSignal] : [],
        dataSource: {
          kind: "provider" as const,
          fixtureProvider: finalScore ? "the-odds-api-scores" : "the-odds-api-events",
          fixtureProviderId: eventId,
          oddsProvider: "the-odds-api",
          oddsProviderEventId: eventId,
          formProvider: homeRating.historical || awayRating.historical ? "supabase-basketball-historical-strength-v1" : undefined,
          strengthProvider: combinedHistoricalStrengthProvider(homeRating, awayRating),
          fetchedAt: new Date().toISOString(),
          notes: [
            "Basketball fixture identity and moneyline/spread/total markets are sourced from The Odds API.",
            ...(finalScore ? [`Provider final score ${finalScore.home}-${finalScore.away} is sourced from The Odds API scores endpoint.`] : []),
            homeRating.historical || awayRating.historical
              ? "Team strength, pace, efficiency, form, and rest use the latest real stored basketball feature rows where each team matched."
              : "Stored basketball strength did not match these teams, so ratings use a league baseline.",
            "Current injuries, rotations, and lineups still need provider-backed confirmation before public action."
          ]
        }
      } satisfies Match
    ];
  });
}

function oddsBackedTennisFixturesFromEvents(
  date: string,
  events: OddsApiEvent[],
  historicalStrengths: HistoricalTennisStrengthMap = new Map()
): Match[] {
  return events.flatMap((event) => {
    const homeName = cleanText(event.home_team);
    const awayName = cleanText(event.away_team);
    const kickoffTime = cleanText(event.commence_time);
    if (!homeName || !awayName || !kickoffTime) return [];
    const oddsMarkets = oddsMarketsForEvent(event, "tennis");
    const finalScore = scoreForOddsEvent(event);
    if (!oddsMarkets.length && !finalScore) return [];
    const eventId = safeId(event.id, `${slug(homeName)}-${slug(awayName)}-${date}`);
    const sportKey = cleanText(event.sport_key) || "tennis_atp";
    const leagueName = cleanText(event.sport_title) || "Tennis";
    const surface = tennisSurfaceFromOddsEvent(sportKey, leagueName);
    const strength = 0.82;
    const homeId = `the-odds-api:${slug(homeName) || `home-${eventId}`}`;
    const awayId = `the-odds-api:${slug(awayName) || `away-${eventId}`}`;
    const homeHistorical = (surface ? getHistoricalTennisStrength(historicalStrengths, homeName, surface) : undefined) ?? getHistoricalTennisStrength(historicalStrengths, homeName);
    const awayHistorical = (surface ? getHistoricalTennisStrength(historicalStrengths, awayName, surface) : undefined) ?? getHistoricalTennisStrength(historicalStrengths, awayName);
    const homeRating = resolveTennisRating(homeName, surface, strength, historicalStrengths);
    const awayRating = resolveTennisRating(awayName, surface, strength, historicalStrengths);

    return [
      {
        id: `the-odds-api:${eventId}`,
        sport: "tennis" as const,
        league: {
          id: `the-odds-api:${sportKey}`,
          name: leagueName,
          country: "World",
          strength
        },
        kickoffTime,
        homeTeam: { id: homeId, name: homeName, rating: homeRating.rating, ratingEvidence: homeRating.evidence },
        awayTeam: { id: awayId, name: awayName, rating: awayRating.rating, ratingEvidence: awayRating.evidence },
        status: finalScore ? ("finished" as const) : ("scheduled" as const),
        score: finalScore ?? undefined,
        oddsMarkets,
        homeForm: tennisFormFromStrength(homeId, homeHistorical, homeRating.rating),
        awayForm: tennisFormFromStrength(awayId, awayHistorical, awayRating.rating),
        dataQualityScore: dataQualityForOddsBackedEvent(event, oddsMarkets),
        providerContextSignals: surface
          ? [
              providerSignal({
                id: `${eventId}-odds-tennis-surface`,
                category: "surface",
                label: "Tournament surface resolved",
                detail: `${leagueName} is mapped to ${surface} court conditions from the bookmaker competition identity.`,
                quality: "acceptable",
                impact: "neutral",
                confidence: 0.8,
                weight: 0,
                source: "the-odds-api-competition"
              })
            ]
          : [],
        dataSource: {
          kind: "provider" as const,
          fixtureProvider: finalScore ? "the-odds-api-scores" : "the-odds-api-events",
          fixtureProviderId: eventId,
          oddsProvider: "the-odds-api",
          oddsProviderEventId: eventId,
          formProvider: homeRating.historical || awayRating.historical ? "supabase-tennis-historical-strength-v1" : undefined,
          strengthProvider: combinedHistoricalStrengthProvider(homeRating, awayRating),
          fetchedAt: new Date().toISOString(),
          notes: [
            "Tennis fixture identity and available match-winner/total markets are sourced from The Odds API.",
            ...(finalScore ? [`Provider final score ${finalScore.home}-${finalScore.away} is sourced from The Odds API scores endpoint.`] : []),
            homeRating.historical || awayRating.historical
              ? "Player Elo, historical form, and rest use the latest real stored tennis feature rows where each player matched."
              : "Stored tennis strength did not match these players, so ratings use a tournament baseline.",
            surface
              ? `Tournament surface is resolved as ${surface}; current fitness, injuries, travel, and confirmed event context still need provider-backed confirmation before public action.`
              : "Surface, current fitness, injuries, travel, and confirmed event context still need provider-backed confirmation before public action."
          ]
        }
      } satisfies Match
    ];
  });
}

function enabledEnvFlag(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function oddsCacheTtlMs(env: EnvMap): number {
  const configured = Number(env.ODDS_API_CACHE_TTL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return 5 * 60 * 1000;
  return Math.round(clampRange(configured, 10_000, 60 * 60 * 1000));
}

function fixtureCacheTtlMs(env: EnvMap, date: string): number {
  const configured = Number(env.SPORTS_PROVIDER_CACHE_TTL_MS);
  if (Number.isFinite(configured) && configured > 0) return Math.round(clampRange(configured, 10_000, 60 * 60 * 1000));
  return date === new Date().toISOString().slice(0, 10) ? 60_000 : 5 * 60 * 1000;
}

function configuredFootballLeagueIds(env: EnvMap): Set<string> {
  return new Set(
    (env.API_FOOTBALL_LEAGUE_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function filterFootballFixtures(fixtures: ApiFootballFixture[], env: EnvMap): ApiFootballFixture[] {
  const leagueIds = configuredFootballLeagueIds(env);
  if (!leagueIds.size) return fixtures;
  return fixtures.filter((fixture) => leagueIds.has(String(fixture.league?.id ?? "")));
}

function selectFootballEnrichmentFixtures(fixtures: ApiFootballFixture[], env: EnvMap): ApiFootballFixture[] {
  const configuredMax = Number(env.API_FOOTBALL_MAX_ENRICHED_FIXTURES);
  const maxFixtures = Number.isFinite(configuredMax) && configuredMax > 0 ? Math.round(clampRange(configuredMax, 1, 30)) : 6;
  return [...fixtures]
    .sort((left, right) => {
      const statusWeight = (fixture: ApiFootballFixture) => {
        const status = matchStatus(fixture.fixture?.status?.short);
        return status === "live" ? 3 : status === "scheduled" ? 2 : 1;
      };
      const leftStrength = leagueStrength(cleanText(left.league?.country) || "World", cleanText(left.league?.name) || "Football");
      const rightStrength = leagueStrength(cleanText(right.league?.country) || "World", cleanText(right.league?.name) || "Football");
      return statusWeight(right) - statusWeight(left) || rightStrength - leftStrength;
    })
    .slice(0, maxFixtures);
}

function providerRequestConcurrency(env: EnvMap): number {
  const configured = Number(env.API_FOOTBALL_ENRICHMENT_CONCURRENCY);
  return Number.isFinite(configured) && configured > 0 ? Math.round(clampRange(configured, 1, 8)) : 4;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

const FOOTBALL_LINEUPS_LOOKAHEAD_MS = 6 * 60 * 60 * 1000;
const FOOTBALL_LINEUPS_STALE_STATUS_GRACE_MS = 2 * 60 * 60 * 1000;
const FOOTBALL_AVAILABILITY_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;
const FOOTBALL_AVAILABILITY_STALE_STATUS_GRACE_MS = 24 * 60 * 60 * 1000;

function footballContextFetchPolicy(fixture: ApiFootballFixture, env: EnvMap, now: Date = new Date()) {
  const kickoffMs = new Date(cleanText(fixture.fixture?.date)).getTime();
  const nowMs = now.getTime();
  const untilKickoffMs = Number.isFinite(kickoffMs) && Number.isFinite(nowMs) ? kickoffMs - nowMs : Number.POSITIVE_INFINITY;
  const status = matchStatus(fixture.fixture?.status?.short);
  const live = status === "live";
  const finished = status === "finished";
  const scheduled = status === "scheduled";

  return {
    lineups:
      live ||
      (scheduled && untilKickoffMs <= FOOTBALL_LINEUPS_LOOKAHEAD_MS && untilKickoffMs >= -FOOTBALL_LINEUPS_STALE_STATUS_GRACE_MS),
    injuries:
      live ||
      (scheduled && untilKickoffMs <= FOOTBALL_AVAILABILITY_LOOKAHEAD_MS && untilKickoffMs >= -FOOTBALL_AVAILABILITY_STALE_STATUS_GRACE_MS),
    events: live || (finished && enabledEnvFlag(env.API_FOOTBALL_ALLOW_HISTORICAL_CONTEXT)),
    weather: live || (scheduled && untilKickoffMs <= 6 * 24 * 60 * 60 * 1000 && untilKickoffMs >= 0),
    news: live || (scheduled && untilKickoffMs <= 3 * 24 * 60 * 60 * 1000 && untilKickoffMs >= 0)
  };
}

async function fetchJson(fetchImpl: FetchLike, url: URL, init?: RequestInit): Promise<unknown | null> {
  const configuredTimeout = Number(process.env.SPORTS_PROVIDER_REQUEST_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.round(clampRange(configuredTimeout, 1_000, 15_000)) : 4_000;
  const controller = new AbortController();
  const parentSignal = init?.signal;
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) return null;
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;
    return response.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function sportKeyForFootball(env: EnvMap): string {
  return env.ODDS_API_FOOTBALL_SPORT_KEY?.trim() || "soccer_epl";
}

function configuredOddsSportKeys(
  env: EnvMap,
  sport: Extract<Sport, "football" | "basketball" | "tennis">
): string[] {
  const plural =
    sport === "football"
      ? env.ODDS_API_FOOTBALL_SPORT_KEYS
      : sport === "basketball"
        ? env.ODDS_API_BASKETBALL_SPORT_KEYS
        : env.ODDS_API_TENNIS_SPORT_KEYS;
  const singular =
    sport === "football"
      ? env.ODDS_API_FOOTBALL_SPORT_KEY
      : sport === "basketball"
        ? env.ODDS_API_BASKETBALL_SPORT_KEY
        : env.ODDS_API_TENNIS_SPORT_KEY;
  const defaults = sport === "football" ? sportKeyForFootball(env) : sport === "basketball" ? "basketball_nba" : "tennis_atp";
  return Array.from(
    new Set(
      (plural?.trim() || singular?.trim() || defaults)
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean)
    )
  ).slice(0, sport === "football" ? 4 : 8);
}

function defaultOddsRegionsForSport(sport: Extract<Sport, "football" | "basketball" | "tennis">): string {
  if (sport === "basketball") return "us,uk,eu";
  return "uk,eu";
}

function sportForOddsEvent(event: OddsApiEvent): Extract<Sport, "football" | "basketball" | "tennis"> {
  const sportKey = cleanText(event.sport_key).toLowerCase();
  if (sportKey.startsWith("basketball_")) return "basketball";
  if (sportKey.startsWith("tennis_")) return "tennis";
  return "football";
}

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function teamMatchesFixtureTeam(teamId: string, fixtureTeamId: unknown): boolean {
  return teamId === `api-football:${String(fixtureTeamId ?? "").trim()}`;
}

function providerFormFromRecentFixtures(teamId: string, fixtures: ApiFootballFixture[]): TeamForm | null {
  const rows = fixtures.flatMap((fixture) => {
    const homeGoals = fixture.goals?.home;
    const awayGoals = fixture.goals?.away;
    if (typeof homeGoals !== "number" || typeof awayGoals !== "number") return [];

    const isHome = teamMatchesFixtureTeam(teamId, fixture.teams?.home?.id);
    const isAway = teamMatchesFixtureTeam(teamId, fixture.teams?.away?.id);
    if (!isHome && !isAway) return [];

    const goalsFor = isHome ? homeGoals : awayGoals;
    const goalsAgainst = isHome ? awayGoals : homeGoals;
    const result: "W" | "D" | "L" = goalsFor > goalsAgainst ? "W" : goalsFor === goalsAgainst ? "D" : "L";
    return [{ result, goalsFor, goalsAgainst }];
  });

  if (!rows.length) return null;

  const recentRows = rows.slice(0, 8);
  const formRows = recentRows.slice(0, 5);
  const avgGoalsFor = recentRows.reduce((sum, row) => sum + row.goalsFor, 0) / recentRows.length;
  const avgGoalsAgainst = recentRows.reduce((sum, row) => sum + row.goalsAgainst, 0) / recentRows.length;
  const formPoints =
    formRows.reduce((sum, row) => sum + (row.result === "W" ? 3 : row.result === "D" ? 1 : 0), 0) / Math.max(1, formRows.length * 3);

  return {
    teamId,
    recentResults: formRows.map((row) => row.result),
    goalsFor: Number(avgGoalsFor.toFixed(2)),
    goalsAgainst: Number(avgGoalsAgainst.toFixed(2)),
    attackStrength: Number(clampRange(0.48 + avgGoalsFor * 0.22 + formPoints * 0.18, 0.35, 1.35).toFixed(2)),
    defenseStrength: Number(clampRange(1.16 - avgGoalsAgainst * 0.2 + formPoints * 0.12, 0.35, 1.35).toFixed(2))
  };
}

export function getSportsProviderRuntimeStatus(env: EnvMap = process.env): ProviderRuntimeStatus {
  const footballApiConfigured = Boolean(firstEnv(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]));
  const basketballApiConfigured = Boolean(firstEnv(env, ["API_BASKETBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]));
  const tennisApiConfigured = Boolean(firstEnv(env, ["API_TENNIS_KEY", "SPORTS_API_KEY"]));
  const sportsApiConfigured = footballApiConfigured || basketballApiConfigured || tennisApiConfigured;
  const oddsApiConfigured = Boolean(firstEnv(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]));
  const weatherApiConfigured = Boolean(firstEnv(env, ["WEATHER_API_KEY", "OPENWEATHER_API_KEY"]));
  return {
    runtimeProvider: sportsApiConfigured ? "providerBackedSportsDataProvider" : "mockSportsDataProvider",
    liveRuntimeBacked: sportsApiConfigured,
    sportsApiConfigured,
    oddsApiConfigured,
    weatherApiConfigured
  };
}

export class ProviderBackedSportsDataProvider implements SportsDataProvider {
  private readonly oddsEventsCache = new Map<string, OddsEventCacheEntry>();
  private readonly fixtureCache = new Map<string, FixtureCacheEntry>();
  private readonly matchCache = new Map<string, MatchCacheEntry>();

  constructor(
    private readonly options: {
      env?: EnvMap;
      fetchImpl?: FetchLike;
      now?: () => Date;
      fallback?: SportsDataProvider;
      historicalFootballEloLoader?: () => Promise<HistoricalFootballEloMap>;
      historicalBasketballStrengthLoader?: () => Promise<HistoricalBasketballStrengthMap>;
      historicalTennisStrengthLoader?: () => Promise<HistoricalTennisStrengthMap>;
    } = {}
  ) {}

  private get env(): EnvMap {
    return this.options.env ?? process.env;
  }

  private get fetchImpl(): FetchLike {
    return this.options.fetchImpl ?? fetch;
  }

  private now(): Date {
    const candidate = this.options.now?.();
    return candidate && Number.isFinite(candidate.getTime()) ? candidate : new Date();
  }

  private get fallback(): SportsDataProvider {
    return this.options.fallback ?? mockSportsDataProvider;
  }

  async getFixtures(date: string, sport: Sport): Promise<Match[]> {
    const cacheKey = `${sport}:${date}`;
    const cached = this.fixtureCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.matches;

    const expiresAt = Date.now() + fixtureCacheTtlMs(this.env, date);
    const matches = this.fetchFixtures(date, sport).then((rows) => {
      for (const match of rows) this.matchCache.set(match.id, { expiresAt, match });
      return rows;
    });
    this.fixtureCache.set(cacheKey, { expiresAt, matches });
    return matches;
  }

  private async fetchFixtures(date: string, sport: Sport): Promise<Match[]> {
    if (sport === "basketball") return this.getBasketballFixtures(date);
    if (sport === "tennis") return this.getTennisFixtures(date);
    if (sport !== "football") return this.fallback.getFixtures(date, sport);
    const apiKey = firstEnv(this.env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
    if (!apiKey) {
      const oddsBackedMatches = await this.getOddsBackedFootballFixtures(date);
      return oddsBackedMatches.length ? oddsBackedMatches : this.fallback.getFixtures(date, sport);
    }

    const endpoint = new URL("https://v3.football.api-sports.io/fixtures");
    endpoint.searchParams.set("date", date);
    endpoint.searchParams.set("timezone", "UTC");
    const data = (await fetchJson(this.fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } })) as ApiFootballResponse | null;
    const fixtures = filterFootballFixtures(Array.isArray(data?.response) ? data.response : [], this.env);
    if (!fixtures.length) {
      const oddsBackedMatches = await this.getOddsBackedFootballFixtures(date);
      return oddsBackedMatches.length ? oddsBackedMatches : this.fallback.getFixtures(date, sport);
    }

    const enrichmentFixtures = selectFootballEnrichmentFixtures(fixtures, this.env);
    const [oddsEvents, contextByFixture, recentFormByTeam, historicalRatings] = await Promise.all([
      this.getCurrentOddsEvents(date, "football"),
      this.getFootballContextByFixture(enrichmentFixtures),
      this.getRecentFootballFormByTeam(enrichmentFixtures),
      this.getHistoricalFootballRatings()
    ]);
    const oddsByEvent = oddsMarketsByEvent(oddsEvents, "football");
    const oddsBackedMatches = oddsBackedFootballFixturesFromEvents(date, oddsEvents, historicalRatings);
    const oddsBackedByEvent = matchesByEventKey(oddsBackedMatches);
    const matches = fixtures.flatMap((fixture) => {
      const homeName = cleanText(fixture.teams?.home?.name);
      const awayName = cleanText(fixture.teams?.away?.name);
      const kickoffTime = cleanText(fixture.fixture?.date);
      if (!homeName || !awayName || !kickoffTime) return [];
      const country = cleanText(fixture.league?.country) || "World";
      const leagueName = cleanText(fixture.league?.name) || "Football";
      const strength = leagueStrength(country, leagueName);
      const homeId = `api-football:${safeId(fixture.teams?.home?.id, slug(homeName) || "home")}`;
      const awayId = `api-football:${safeId(fixture.teams?.away?.id, slug(awayName) || "away")}`;
      const directOddsMarkets = firstOddsMarketsForFixture(oddsByEvent, homeName, awayName, kickoffTime);
      const directOddsEvent = firstOddsEventForFixture(oddsEvents, homeName, awayName, kickoffTime);
      const oddsBackedMatch = firstMatchForFixture(oddsBackedByEvent, homeName, awayName, kickoffTime);
      const mergedOddsFromOddsEvent = !hasCompleteFootballMatchWinnerOdds(directOddsMarkets) && hasCompleteFootballMatchWinnerOdds(oddsBackedMatch?.oddsMarkets ?? []);
      const oddsMarkets = mergedOddsFromOddsEvent ? (oddsBackedMatch?.oddsMarkets ?? []) : directOddsMarkets;
      const homeProviderForm = recentFormByTeam.get(homeId);
      const awayProviderForm = recentFormByTeam.get(awayId);
      const hasProviderForm = Boolean(homeProviderForm && awayProviderForm);
      const historicalApplicable = isEnglishPremierLeague(country, leagueName, String(fixture.league?.id ?? ""));
      const homeRating = resolveFootballRating({
        name: homeName,
        leagueStrength: strength,
        form: homeProviderForm,
        historicalRatings,
        historicalApplicable
      });
      const awayRating = resolveFootballRating({
        name: awayName,
        leagueStrength: strength,
        form: awayProviderForm,
        historicalRatings,
        historicalApplicable
      });
      const status = matchStatus(fixture.fixture?.status?.short);
      const hasScore = typeof fixture.goals?.home === "number" && typeof fixture.goals?.away === "number";
      const elapsedMinute = numberOrNull(fixture.fixture?.status?.elapsed);
      const providerContextSignals = [
        ...(contextByFixture.get(String(fixture.fixture?.id ?? "")) ?? []),
        ...(mergedOddsFromOddsEvent ? (oddsBackedMatch?.providerContextSignals ?? []) : [])
      ];
      const oddsProviderEventId =
        cleanText(directOddsEvent?.id) ||
        (oddsBackedMatch?.id.startsWith("the-odds-api:") ? oddsBackedMatch.id.replace("the-odds-api:", "") : "") ||
        undefined;
      return [
        {
          id: `api-football:${safeId(fixture.fixture?.id, `${slug(homeName)}-${slug(awayName)}-${date}`)}`,
          sport: "football" as const,
          league: {
            id: `api-football:${safeId(fixture.league?.id, slug(leagueName) || "league")}`,
            name: leagueName,
            country,
            strength
          },
          kickoffTime,
          homeTeam: { id: homeId, name: homeName, rating: homeRating.rating, ratingEvidence: homeRating.evidence },
          awayTeam: { id: awayId, name: awayName, rating: awayRating.rating, ratingEvidence: awayRating.evidence },
          venue: {
            name: fixture.fixture?.venue?.name ?? null,
            city: fixture.fixture?.venue?.city ?? null,
            country
          },
          status,
          score:
            status === "scheduled" || !hasScore
              ? undefined
              : {
                  home: fixture.goals!.home!,
                  away: fixture.goals!.away!,
                  ...(status === "live" && elapsedMinute !== null ? { minute: elapsedMinute } : {})
                },
          oddsMarkets,
          homeForm: homeProviderForm ?? buildProviderForm(homeId, homeRating.rating, 0),
          awayForm: awayProviderForm ?? buildProviderForm(awayId, awayRating.rating, 13),
          dataQualityScore: dataQualityForFixture(fixture, oddsMarkets.length > 0, hasProviderForm),
          providerContextSignals,
          dataSource: {
            kind: "provider" as const,
            fixtureProvider: "api-football",
            fixtureProviderId: String(fixture.fixture?.id ?? "") || undefined,
            oddsProvider: oddsMarkets.length ? "the-odds-api" : undefined,
            oddsProviderEventId: oddsMarkets.length ? oddsProviderEventId : undefined,
            formProvider: hasProviderForm ? "api-football-recent-fixtures" : "deterministic-provider-proxy",
            strengthProvider: combinedStrengthProvider(homeRating, awayRating),
            fetchedAt: new Date().toISOString(),
            notes: [
              ...(homeRating.historical || awayRating.historical
                ? ["Team strength includes historical Elo learned from real football-data results stored in OddsPadi Supabase."]
                : ["Historical EPL Elo was unavailable or not applicable; provider form or a league baseline supplies team strength."]),
              ...(mergedOddsFromOddsEvent ? ["Odds were merged from The Odds API event identity after API-Football fixture identity was present without a direct odds match."] : []),
              ...(oddsMarkets.length ? [] : ["No matching live odds snapshot was found for this fixture."]),
              ...(hasProviderForm ? [] : ["Recent provider form was unavailable, so deterministic team-form proxies were used."])
            ]
          }
        } satisfies Match
      ];
    });

    const apiFootballKeys = new Set(matches.flatMap(matchEventKeys));
    const unmatchedOddsBackedMatches = oddsBackedMatches.filter((match) => !matchEventKeys(match).some((key) => apiFootballKeys.has(key)));
    const mergedMatches = [...matches, ...unmatchedOddsBackedMatches];

    return mergedMatches.length ? mergedMatches : this.fallback.getFixtures(date, sport);
  }

  private async getBasketballFixtures(date: string): Promise<Match[]> {
    const apiKey = firstEnv(this.env, ["API_BASKETBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
    if (!apiKey) {
      const [oddsEvents, historicalStrengths] = await Promise.all([
        this.getCurrentOddsEvents(date, "basketball"),
        this.getHistoricalBasketballStrengths()
      ]);
      const oddsBackedMatches = oddsBackedBasketballFixturesFromEvents(date, oddsEvents, historicalStrengths);
      return oddsBackedMatches.length ? oddsBackedMatches : this.fallback.getFixtures(date, "basketball");
    }

    const endpoint = new URL("https://v1.basketball.api-sports.io/games");
    endpoint.searchParams.set("date", date);
    const data = (await fetchJson(this.fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } })) as ApiBasketballResponse | null;
    const games = Array.isArray(data?.response) ? data.response : [];
    const [oddsEvents, historicalStrengths] = await Promise.all([
      this.getCurrentOddsEvents(date, "basketball"),
      this.getHistoricalBasketballStrengths()
    ]);
    const oddsBackedMatches = oddsBackedBasketballFixturesFromEvents(date, oddsEvents, historicalStrengths);
    if (!games.length) return oddsBackedMatches.length ? oddsBackedMatches : this.fallback.getFixtures(date, "basketball");
    const oddsByEvent = oddsMarketsByEvent(oddsEvents, "basketball");

    const matches = games.flatMap((game) => {
      const homeName = cleanText(game.teams?.home?.name);
      const awayName = cleanText(game.teams?.away?.name);
      if (!homeName || !awayName) return [];
      const country = cleanText(game.league?.country) || "World";
      const leagueName = cleanText(game.league?.name) || "Basketball";
      const strength = leagueStrength(country, leagueName);
      const kickoffTime = basketballKickoff(game);
      const homeId = `api-basketball:${safeId(game.teams?.home?.id, slug(homeName) || "home")}`;
      const awayId = `api-basketball:${safeId(game.teams?.away?.id, slug(awayName) || "away")}`;
      const homeHistorical = getHistoricalBasketballStrength(historicalStrengths, homeName);
      const awayHistorical = getHistoricalBasketballStrength(historicalStrengths, awayName);
      const homeRating = resolveBasketballRating(homeName, strength, historicalStrengths);
      const awayRating = resolveBasketballRating(awayName, strength, historicalStrengths);
      const status = basketballStatus(game.status);
      const homeScore = numberOrNull(game.scores?.home?.total);
      const awayScore = numberOrNull(game.scores?.away?.total);
      const oddsMarkets = oddsByEvent.get(eventKey(homeName, awayName, kickoffTime)) ?? [];
      const directOddsEvent = firstOddsEventForFixture(oddsEvents, homeName, awayName, kickoffTime);

      return [
        {
          id: `api-basketball:${safeId(game.id, `${slug(homeName)}-${slug(awayName)}-${date}`)}`,
          sport: "basketball" as const,
          league: {
            id: `api-basketball:${safeId(game.league?.id, slug(leagueName) || "league")}`,
            name: leagueName,
            country,
            strength
          },
          kickoffTime,
          homeTeam: { id: homeId, name: homeName, rating: homeRating.rating, ratingEvidence: homeRating.evidence },
          awayTeam: { id: awayId, name: awayName, rating: awayRating.rating, ratingEvidence: awayRating.evidence },
          status,
          score:
            status === "scheduled" || homeScore === null || awayScore === null
              ? undefined
              : {
                  home: homeScore,
                  away: awayScore
                },
          oddsMarkets,
          homeForm: basketballFormFromStrength(homeId, homeHistorical, homeRating.rating),
          awayForm: basketballFormFromStrength(awayId, awayHistorical, awayRating.rating),
          dataQualityScore: basketballDataQuality(game),
          providerContextSignals: [
            basketballHistoricalRestSignal(safeId(game.id, "game"), homeName, awayName, homeHistorical, awayHistorical)
          ].filter((signal): signal is MatchContextSignal => signal !== null),
          dataSource: {
            kind: "provider" as const,
            fixtureProvider: "api-basketball",
            fixtureProviderId: String(game.id ?? "") || undefined,
            oddsProvider: oddsMarkets.length ? "the-odds-api" : undefined,
            oddsProviderEventId: oddsMarkets.length ? cleanText(directOddsEvent?.id) || undefined : undefined,
            formProvider: homeRating.historical || awayRating.historical ? "supabase-basketball-historical-strength-v1" : undefined,
            strengthProvider: combinedHistoricalStrengthProvider(homeRating, awayRating),
            fetchedAt: new Date().toISOString(),
            notes: [
              "Live basketball fixtures are provider-backed.",
              ...(oddsMarkets.length ? ["Basketball moneyline/spread/total odds are provider-backed."] : ["No matching basketball odds snapshot was found."]),
              homeRating.historical || awayRating.historical
                ? "Team strength, pace, efficiency, form, and rest use the latest real stored basketball feature rows where each team matched."
                : "Stored basketball strength did not match these teams, so ratings use a league baseline.",
              "Current basketball injuries, rotations, and lineups still require provider-specific feeds before value publication."
            ]
          }
        } satisfies Match
      ];
    });

    const apiBasketballKeys = new Set(matches.flatMap(matchEventKeys));
    const unmatchedOddsBackedMatches = oddsBackedMatches.filter((match) => !matchEventKeys(match).some((key) => apiBasketballKeys.has(key)));
    const mergedMatches = [...matches, ...unmatchedOddsBackedMatches];

    return mergedMatches.length ? mergedMatches : this.fallback.getFixtures(date, "basketball");
  }

  private async getTennisFixtures(date: string): Promise<Match[]> {
    const apiKey = firstEnv(this.env, ["API_TENNIS_KEY", "SPORTS_API_KEY"]);
    if (!apiKey) {
      const [oddsEvents, historicalStrengths] = await Promise.all([
        this.getCurrentOddsEvents(date, "tennis"),
        this.getHistoricalTennisStrengths()
      ]);
      const oddsBackedMatches = oddsBackedTennisFixturesFromEvents(date, oddsEvents, historicalStrengths);
      return oddsBackedMatches.length ? oddsBackedMatches : this.fallback.getFixtures(date, "tennis");
    }

    const endpoint = new URL("https://api.api-tennis.com/tennis/");
    endpoint.searchParams.set("method", "get_events");
    endpoint.searchParams.set("date_start", date);
    endpoint.searchParams.set("date_stop", date);
    endpoint.searchParams.set("APIkey", apiKey);
    const data = (await fetchJson(this.fetchImpl, endpoint)) as ApiTennisResponse | null;
    const events = Array.isArray(data?.result) ? data.result : Array.isArray(data?.response) ? data.response : [];
    const [oddsEvents, historicalStrengths] = await Promise.all([
      this.getCurrentOddsEvents(date, "tennis"),
      this.getHistoricalTennisStrengths()
    ]);
    const oddsBackedMatches = oddsBackedTennisFixturesFromEvents(date, oddsEvents, historicalStrengths);
    if (!events.length) return oddsBackedMatches.length ? oddsBackedMatches : this.fallback.getFixtures(date, "tennis");
    const oddsByEvent = oddsMarketsByEvent(oddsEvents, "tennis");

    const matches = events.flatMap((event) => {
      const homeName = cleanText(event.event_first_player);
      const awayName = cleanText(event.event_second_player);
      if (!homeName || !awayName) return [];
      const tournamentName = cleanText(event.tournament_name || event.league_name) || "Tennis";
      const surface = tennisSurface(event.surface || event.event_surface);
      const strength = surface === "unknown" || !surface ? 0.8 : 0.84;
      const eventId = safeId(event.event_key ?? event.id, `${slug(homeName)}-${slug(awayName)}-${date}`);
      const homeId = `api-tennis:${safeId(event.first_player_key, slug(homeName) || "home")}`;
      const awayId = `api-tennis:${safeId(event.second_player_key, slug(awayName) || "away")}`;
      const homeHistorical = (surface ? getHistoricalTennisStrength(historicalStrengths, homeName, surface) : undefined) ?? getHistoricalTennisStrength(historicalStrengths, homeName);
      const awayHistorical = (surface ? getHistoricalTennisStrength(historicalStrengths, awayName, surface) : undefined) ?? getHistoricalTennisStrength(historicalStrengths, awayName);
      const homeRating = resolveTennisRating(homeName, surface, strength, historicalStrengths);
      const awayRating = resolveTennisRating(awayName, surface, strength, historicalStrengths);
      const status = tennisStatus(event.event_status);
      const score = parseTennisScore(event.event_final_result || event.event_game_result);
      const kickoffTime = tennisKickoff(event);
      const oddsMarkets = oddsByEvent.get(eventKey(homeName, awayName, kickoffTime)) ?? [];
      const directOddsEvent = firstOddsEventForFixture(oddsEvents, homeName, awayName, kickoffTime);

      return [
        {
          id: `api-tennis:${eventId}`,
          sport: "tennis" as const,
          league: {
            id: `api-tennis:${safeId(event.tournament_key ?? event.league_key, slug(tournamentName) || "tournament")}`,
            name: cleanText(event.tournament_round) ? `${tournamentName} ${cleanText(event.tournament_round)}` : tournamentName,
            country: "World",
            strength
          },
          kickoffTime,
          homeTeam: { id: homeId, name: homeName, rating: homeRating.rating, ratingEvidence: homeRating.evidence },
          awayTeam: { id: awayId, name: awayName, rating: awayRating.rating, ratingEvidence: awayRating.evidence },
          status,
          score:
            status === "scheduled" || score.home === null || score.away === null
              ? undefined
              : {
                  home: score.home,
                  away: score.away
                },
          oddsMarkets,
          homeForm: tennisFormFromStrength(homeId, homeHistorical, homeRating.rating),
          awayForm: tennisFormFromStrength(awayId, awayHistorical, awayRating.rating),
          dataQualityScore: tennisDataQuality(event),
          providerContextSignals: [
            providerSignal({
              id: `${eventId}-api-tennis-surface`,
              category: "surface",
              label: surface ? "API-Tennis surface loaded" : "API-Tennis event loaded",
              detail: surface
                ? `${tournamentName} provider event includes ${surface} surface context for ${homeName} vs ${awayName}.`
                : `${tournamentName} provider event loaded; surface, player injury, and odds enrichment remain incomplete.`,
              quality: surface ? "acceptable" : "thin",
              impact: "neutral",
              confidence: surface ? 0.66 : 0.5,
              weight: 0,
              source: "api-tennis-events"
            })
          ],
          dataSource: {
            kind: "provider" as const,
            fixtureProvider: "api-tennis",
            fixtureProviderId: eventId,
            oddsProvider: oddsMarkets.length ? "the-odds-api" : undefined,
            oddsProviderEventId: oddsMarkets.length ? cleanText(directOddsEvent?.id) || undefined : undefined,
            formProvider: homeRating.historical || awayRating.historical ? "supabase-tennis-historical-strength-v1" : undefined,
            strengthProvider: combinedHistoricalStrengthProvider(homeRating, awayRating),
            fetchedAt: new Date().toISOString(),
            notes: [
              "Live tennis fixtures are provider-backed.",
              ...(oddsMarkets.length ? ["Tennis match-winner and total-games odds are provider-backed where available."] : ["No matching tennis odds snapshot was found."]),
              homeRating.historical || awayRating.historical
                ? "Player Elo, surface strength, historical form, rank, and rest use the latest real stored tennis feature rows where each player matched."
                : "Stored tennis strength did not match these players, so ratings use a tournament baseline.",
              "Current fitness, injuries, travel, and head-to-head context still require deeper provider feeds before value publication."
            ]
          }
        } satisfies Match
      ];
    });

    const apiTennisKeys = new Set(matches.flatMap(matchEventKeys));
    const unmatchedOddsBackedMatches = oddsBackedMatches.filter((match) => !matchEventKeys(match).some((key) => apiTennisKeys.has(key)));
    const mergedMatches = [...matches, ...unmatchedOddsBackedMatches];
    return mergedMatches.length ? mergedMatches : this.fallback.getFixtures(date, "tennis");
  }

  async getMatch(matchId: string): Promise<Match | null> {
    const cached = this.matchCache.get(matchId);
    if (cached && cached.expiresAt > Date.now()) return cached.match;

    if (matchId.startsWith("api-football:")) {
      const apiKey = firstEnv(this.env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
      const fixtureId = matchId.replace("api-football:", "");
      if (!apiKey || !fixtureId) return this.fallback.getMatch(matchId);
      const endpoint = new URL("https://v3.football.api-sports.io/fixtures");
      endpoint.searchParams.set("id", fixtureId);
      endpoint.searchParams.set("timezone", "UTC");
      const data = (await fetchJson(this.fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } })) as ApiFootballResponse | null;
      const kickoffDate = data?.response?.[0]?.fixture?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
      const matches = await this.getFixtures(kickoffDate, "football");
      return matches.find((match) => match.id === matchId) ?? null;
    }

    if (matchId.startsWith("api-basketball:")) {
      const apiKey = firstEnv(this.env, ["API_BASKETBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
      const gameId = matchId.replace("api-basketball:", "");
      if (!apiKey || !gameId) return null;
      const endpoint = new URL("https://v1.basketball.api-sports.io/games");
      endpoint.searchParams.set("id", gameId);
      const data = (await fetchJson(this.fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } })) as ApiBasketballResponse | null;
      const game = data?.response?.[0];
      if (!game) return null;
      const matches = await this.getFixtures(basketballKickoff(game).slice(0, 10), "basketball");
      return matches.find((match) => match.id === matchId) ?? null;
    }

    if (matchId.startsWith("api-tennis:")) {
      const apiKey = firstEnv(this.env, ["API_TENNIS_KEY", "SPORTS_API_KEY"]);
      const eventId = matchId.replace("api-tennis:", "");
      if (!apiKey || !eventId) return null;
      const endpoint = new URL("https://api.api-tennis.com/tennis/");
      endpoint.searchParams.set("method", "get_events");
      endpoint.searchParams.set("event_key", eventId);
      endpoint.searchParams.set("APIkey", apiKey);
      const data = (await fetchJson(this.fetchImpl, endpoint)) as ApiTennisResponse | null;
      const events = Array.isArray(data?.result) ? data.result : Array.isArray(data?.response) ? data.response : [];
      const event = events[0];
      if (!event) return null;
      const matches = await this.getFixtures(tennisKickoff(event).slice(0, 10), "tennis");
      return matches.find((match) => match.id === matchId) ?? null;
    }

    if (matchId.startsWith("the-odds-api:")) {
      const eventId = matchId.replace("the-odds-api:", "");
      if (!firstEnv(this.env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]) || !eventId) return null;
      const event = await this.getOddsEventById(eventId);
      if (!event) return null;
      const date = cleanText(event.commence_time).slice(0, 10) || new Date().toISOString().slice(0, 10);
      const sport = sportForOddsEvent(event);
      const matches =
        sport === "basketball"
          ? oddsBackedBasketballFixturesFromEvents(date, [event], await this.getHistoricalBasketballStrengths())
          : sport === "tennis"
            ? oddsBackedTennisFixturesFromEvents(date, [event], await this.getHistoricalTennisStrengths())
            : oddsBackedFootballFixturesFromEvents(date, [event], await this.getHistoricalFootballRatings());
      const match = matches.find((candidate) => candidate.id === matchId) ?? null;
      if (match) this.matchCache.set(matchId, { expiresAt: Date.now() + oddsCacheTtlMs(this.env), match });
      return match;
    }

    return this.fallback.getMatch(matchId);
  }

  async getLiveScores(date: string, sport: Sport): Promise<Match[]> {
    const matches = await this.getFixtures(date, sport);
    return matches.filter((match) => match.status === "live" || match.status === "finished" || match.status === "scheduled");
  }

  async getOdds(matchId: string): Promise<OddsMarket[]> {
    const match = await this.getMatch(matchId);
    return match?.oddsMarkets ?? [];
  }

  async getTeamForm(teamId: string): Promise<TeamForm> {
    return this.fallback.getTeamForm(teamId);
  }

  private async getOddsBackedFootballFixtures(date: string): Promise<Match[]> {
    const [events, historicalRatings] = await Promise.all([
      this.getCurrentOddsEvents(date, "football"),
      this.getHistoricalFootballRatings()
    ]);
    return oddsBackedFootballFixturesFromEvents(date, events, historicalRatings);
  }

  private async getHistoricalFootballRatings(): Promise<HistoricalFootballEloMap> {
    return this.options.historicalFootballEloLoader?.() ?? loadHistoricalFootballElo(this.env);
  }

  private async getHistoricalBasketballStrengths(): Promise<HistoricalBasketballStrengthMap> {
    return this.options.historicalBasketballStrengthLoader?.() ?? loadHistoricalBasketballStrength(this.env);
  }

  private async getHistoricalTennisStrengths(): Promise<HistoricalTennisStrengthMap> {
    return this.options.historicalTennisStrengthLoader?.() ?? loadHistoricalTennisStrength(this.env);
  }

  private async getRecentFootballFormByTeam(fixtures: ApiFootballFixture[]): Promise<Map<string, TeamForm>> {
    const apiKey = firstEnv(this.env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
    if (!apiKey) return new Map();

    const teamIds = Array.from(
      new Set(
        fixtures.flatMap((fixture) => [
          fixture.teams?.home?.id ? `api-football:${String(fixture.teams?.home?.id)}` : "",
          fixture.teams?.away?.id ? `api-football:${String(fixture.teams?.away?.id)}` : ""
        ])
      )
    ).filter(Boolean);

    const entries = await mapWithConcurrency(teamIds, providerRequestConcurrency(this.env), async (teamId) => {
        const endpoint = new URL("https://v3.football.api-sports.io/fixtures");
        endpoint.searchParams.set("team", teamId.replace("api-football:", ""));
        endpoint.searchParams.set("last", "8");
        endpoint.searchParams.set("timezone", "UTC");
        const data = (await fetchJson(this.fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } })) as ApiFootballResponse | null;
        const recentFixtures = Array.isArray(data?.response) ? data.response : [];
        const form = providerFormFromRecentFixtures(teamId, recentFixtures);
        return form ? ([teamId, form] as const) : null;
      });

    return new Map(entries.filter((entry): entry is [string, TeamForm] => Boolean(entry)));
  }

  private async getCurrentOddsByEvent(date: string, sport: Extract<Sport, "football" | "basketball" | "tennis">): Promise<Map<string, OddsMarket[]>> {
    const events = await this.getCurrentOddsEvents(date, sport);
    return oddsMarketsByEvent(events, sport);
  }

  private async getOddsEventById(eventId: string): Promise<OddsApiEvent | null> {
    const apiKey = firstEnv(this.env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]);
    if (!apiKey) return null;
    const sports: Array<Extract<Sport, "football" | "basketball" | "tennis">> = ["football", "basketball", "tennis"];
    const candidates = sports.flatMap((sport) => configuredOddsSportKeys(this.env, sport).map((sportKey) => ({ sport, sportKey })));
    const cacheKey = `event:${eventId}:${candidates.map(({ sportKey }) => sportKey).join(",")}`;
    const cached = this.oddsEventsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return (await cached.events)[0] ?? null;

    const events = (async () => {
      for (const { sport, sportKey } of candidates) {
        const endpoint = new URL(
          `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/events/${encodeURIComponent(eventId)}/odds`
        );
        endpoint.searchParams.set("apiKey", apiKey);
        endpoint.searchParams.set("regions", this.env.ODDS_API_REGIONS?.trim() || defaultOddsRegionsForSport(sport));
        endpoint.searchParams.set("markets", sport === "football" ? "h2h,totals" : "h2h,spreads,totals");
        endpoint.searchParams.set("oddsFormat", "decimal");
        endpoint.searchParams.set("dateFormat", "iso");
        const event = (await fetchJson(this.fetchImpl, endpoint)) as OddsApiEvent | null;
        if (cleanText(event?.id) === eventId) return [{ ...event, sport_key: cleanText(event?.sport_key) || sportKey }];
      }
      return [];
    })();
    this.oddsEventsCache.set(cacheKey, { expiresAt: Date.now() + oddsCacheTtlMs(this.env), events });
    return (await events)[0] ?? null;
  }

  private async getCurrentOddsEvents(date: string, sport: Extract<Sport, "football" | "basketball" | "tennis">): Promise<OddsApiEvent[]> {
    const apiKey = firstEnv(this.env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]);
    if (!apiKey) return [];
    const sportKeys = configuredOddsSportKeys(this.env, sport);
    const regions = this.env.ODDS_API_REGIONS?.trim() || defaultOddsRegionsForSport(sport);
    const markets = sport === "football" ? "h2h,totals" : "h2h,spreads,totals";
    const footballEventMarkets = (this.env.ODDS_API_FOOTBALL_EVENT_MARKETS?.trim() || "btts")
      .split(",")
      .map((market) => market.trim().toLowerCase())
      .filter((market) => market === "btts")
      .join(",");
    const historicalEnabled = enabledEnvFlag(this.env.ODDS_API_ALLOW_HISTORICAL_RUNTIME);
    const cacheKey = [sport, sportKeys.join(","), date, regions, markets, footballEventMarkets, historicalEnabled ? "historical" : "current"].join(":");
    const cached = this.oddsEventsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.events;

    const events = mapWithConcurrency(sportKeys, Math.min(4, providerRequestConcurrency(this.env)), async (sportKey) => {
      const [oddsRows, scoreRows] = await Promise.all([
        this.fetchOddsEvents({ apiKey, date, sportKey, regions, markets, historicalEnabled }),
        sport === "football" ? Promise.resolve([]) : this.fetchOddsScoreEvents({ apiKey, date, sportKey })
      ]);
      const rows = mergeOddsAndScoreEvents(oddsRows, scoreRows);
      return sport === "football" && footballEventMarkets
        ? this.enrichFootballEventMarkets({ events: rows, apiKey, date, sportKey, regions, markets: footballEventMarkets })
        : rows;
    }).then((eventLists) => {
      const byId = new Map<string, OddsApiEvent>();
      for (const event of eventLists.flat()) {
        const id = cleanText(event.id) || `${cleanText(event.sport_key)}:${cleanText(event.home_team)}:${cleanText(event.away_team)}:${cleanText(event.commence_time)}`;
        if (!byId.has(id)) byId.set(id, event);
      }
      return [...byId.values()].sort((left, right) =>
        cleanText(left.commence_time).localeCompare(cleanText(right.commence_time)) || cleanText(left.id).localeCompare(cleanText(right.id))
      );
    });
    this.oddsEventsCache.set(cacheKey, { expiresAt: Date.now() + oddsCacheTtlMs(this.env), events });
    return events;
  }

  private async fetchOddsScoreEvents({ apiKey, date, sportKey }: { apiKey: string; date: string; sportKey: string }): Promise<OddsApiEvent[]> {
    const target = Date.parse(`${date}T00:00:00Z`);
    const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const ageDays = Number.isFinite(target) ? Math.floor((today - target) / (24 * 60 * 60 * 1000)) : Number.POSITIVE_INFINITY;
    if (ageDays < 0 || ageDays > 3) return [];
    const endpoint = new URL(`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/scores/`);
    endpoint.searchParams.set("apiKey", apiKey);
    endpoint.searchParams.set("daysFrom", "3");
    endpoint.searchParams.set("dateFormat", "iso");
    const scores = (await fetchJson(this.fetchImpl, endpoint)) as OddsApiEvent[] | null;
    return Array.isArray(scores)
      ? scores.filter((event) => cleanText(event.commence_time).startsWith(date) && cleanText(event.home_team) && cleanText(event.away_team))
      : [];
  }

  private async fetchOddsEvents({
    apiKey,
    date,
    sportKey,
    regions,
    markets,
    historicalEnabled
  }: {
    apiKey: string;
    date: string;
    sportKey: string;
    regions: string;
    markets: string;
    historicalEnabled: boolean;
  }): Promise<OddsApiEvent[]> {
    const endpoint = new URL(`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/odds/`);
    endpoint.searchParams.set("apiKey", apiKey);
    endpoint.searchParams.set("regions", regions);
    endpoint.searchParams.set("markets", markets);
    endpoint.searchParams.set("oddsFormat", "decimal");
    endpoint.searchParams.set("dateFormat", "iso");
    const events = (await fetchJson(this.fetchImpl, endpoint)) as OddsApiEvent[] | null;
    const sameDateEvents = Array.isArray(events)
      ? events.filter((event) => cleanText(event.commence_time).startsWith(date) && cleanText(event.home_team) && cleanText(event.away_team))
      : [];
    if (sameDateEvents.length) return sameDateEvents;
    if (!historicalEnabled) return [];

    const snapshotTime = this.env.ODDS_API_SNAPSHOT_TIME?.trim() || "12:00:00Z";
    const historicalEndpoint = new URL(`https://api.the-odds-api.com/v4/historical/sports/${encodeURIComponent(sportKey)}/odds/`);
    historicalEndpoint.searchParams.set("apiKey", apiKey);
    historicalEndpoint.searchParams.set("regions", regions);
    historicalEndpoint.searchParams.set("markets", markets);
    historicalEndpoint.searchParams.set("oddsFormat", "decimal");
    historicalEndpoint.searchParams.set("dateFormat", "iso");
    historicalEndpoint.searchParams.set("date", `${date}T${snapshotTime}`);
    const historical = (await fetchJson(this.fetchImpl, historicalEndpoint)) as OddsApiHistoricalResponse | null;
    const snapshotEvents = Array.isArray(historical?.data) ? historical.data : [];
    return snapshotEvents.filter((event) => cleanText(event.commence_time).startsWith(date) && cleanText(event.home_team) && cleanText(event.away_team));
  }

  private async enrichFootballEventMarkets({
    events,
    apiKey,
    date,
    sportKey,
    regions,
    markets
  }: {
    events: OddsApiEvent[];
    apiKey: string;
    date: string;
    sportKey: string;
    regions: string;
    markets: string;
  }): Promise<OddsApiEvent[]> {
    if (!events.length || date < new Date().toISOString().slice(0, 10)) return events;
    const configuredLimit = Number(this.env.ODDS_API_FOOTBALL_EVENT_MARKET_LIMIT);
    const limit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.min(20, Math.floor(configuredLimit)) : 10;
    const enriched = await mapWithConcurrency(events.slice(0, limit), Math.min(4, providerRequestConcurrency(this.env)), async (event) => {
      const eventId = cleanText(event.id);
      if (!eventId) return event;
      const endpoint = new URL(
        `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/events/${encodeURIComponent(eventId)}/odds`
      );
      endpoint.searchParams.set("apiKey", apiKey);
      endpoint.searchParams.set("regions", regions);
      endpoint.searchParams.set("markets", markets);
      endpoint.searchParams.set("oddsFormat", "decimal");
      endpoint.searchParams.set("dateFormat", "iso");
      const additional = (await fetchJson(this.fetchImpl, endpoint)) as OddsApiEvent | null;
      if (!additional?.bookmakers?.length) return event;
      return {
        ...event,
        bookmakers: [...(event.bookmakers ?? []), ...additional.bookmakers]
      };
    });
    const enrichedById = new Map(enriched.map((event) => [cleanText(event.id), event]));
    return events.map((event) => enrichedById.get(cleanText(event.id)) ?? event);
  }

  private async getFootballContextByFixture(fixtures: ApiFootballFixture[]): Promise<Map<string, MatchContextSignal[]>> {
    const apiKey = firstEnv(this.env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
    if (!apiKey) return new Map();

    const now = this.now();
    const standingsByLeagueSeason = await this.getStandingsByLeagueSeason(fixtures);
    const entries = await mapWithConcurrency(fixtures, providerRequestConcurrency(this.env), async (fixture) => {
        const fixtureId = String(fixture.fixture?.id ?? "");
        if (!fixtureId) return [fixtureId, [] as MatchContextSignal[]] as const;
        const policy = footballContextFetchPolicy(fixture, this.env, now);
        const [lineups, injuries, events, weatherSignal, newsSignal] = await Promise.all([
          policy.lineups ? this.fetchFixtureLineups(fixtureId, apiKey) : Promise.resolve([]),
          policy.injuries ? this.fetchFixtureInjuries(fixtureId, apiKey) : Promise.resolve([]),
          policy.events ? this.fetchFixtureEvents(fixtureId, apiKey) : Promise.resolve([]),
          policy.weather ? this.fetchWeatherSignal(fixture) : Promise.resolve(null),
          policy.news ? this.fetchNewsSignal(fixture) : Promise.resolve(null)
        ]);
        const leagueSeasonKey = `${fixture.league?.id ?? ""}:${fixture.league?.season ?? ""}`;
        const standings = standingsByLeagueSeason.get(leagueSeasonKey) ?? [];
        const contextSignals = this.buildProviderContextSignals({ fixture, lineups, injuries, events, standings });
        if (weatherSignal) contextSignals.push(weatherSignal);
        if (newsSignal) contextSignals.push(newsSignal);
        return [fixtureId, contextSignals] as const;
      });

    return new Map(entries.filter(([fixtureId]) => fixtureId));
  }

  private async fetchFixtureLineups(fixtureId: string, apiKey: string): Promise<ApiFootballLineup[]> {
    const endpoint = new URL("https://v3.football.api-sports.io/fixtures/lineups");
    endpoint.searchParams.set("fixture", fixtureId);
    const data = (await fetchJson(this.fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } })) as ApiFootballLineupResponse | null;
    return Array.isArray(data?.response) ? data.response : [];
  }

  private async fetchFixtureInjuries(fixtureId: string, apiKey: string): Promise<ApiFootballInjury[]> {
    const endpoint = new URL("https://v3.football.api-sports.io/injuries");
    endpoint.searchParams.set("fixture", fixtureId);
    const data = (await fetchJson(this.fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } })) as ApiFootballInjuryResponse | null;
    return Array.isArray(data?.response) ? data.response : [];
  }

  private async fetchFixtureEvents(fixtureId: string, apiKey: string): Promise<ApiFootballEvent[]> {
    const endpoint = new URL("https://v3.football.api-sports.io/fixtures/events");
    endpoint.searchParams.set("fixture", fixtureId);
    const data = (await fetchJson(this.fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } })) as ApiFootballEventResponse | null;
    return Array.isArray(data?.response) ? data.response : [];
  }

  private async getStandingsByLeagueSeason(fixtures: ApiFootballFixture[]): Promise<Map<string, ApiFootballStanding[]>> {
    const apiKey = firstEnv(this.env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
    const uniqueLeagueSeasons = Array.from(
      new Set(
        fixtures
          .map((fixture) => `${fixture.league?.id ?? ""}:${fixture.league?.season ?? ""}`)
          .filter((value) => !value.endsWith(":") && !value.startsWith(":"))
      )
    );
    const entries = await mapWithConcurrency(uniqueLeagueSeasons, providerRequestConcurrency(this.env), async (key) => {
        const [league, season] = key.split(":");
        const endpoint = new URL("https://v3.football.api-sports.io/standings");
        endpoint.searchParams.set("league", league);
        endpoint.searchParams.set("season", season);
        const data = (await fetchJson(this.fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } })) as ApiFootballStandingsResponse | null;
        const standings = data?.response?.[0]?.league?.standings?.[0] ?? [];
        return [key, standings] as const;
      });
    return new Map(entries);
  }

  private async fetchWeatherSignal(fixture: ApiFootballFixture): Promise<MatchContextSignal | null> {
    const apiKey = firstEnv(this.env, ["WEATHER_API_KEY", "OPENWEATHER_API_KEY"]);
    const city = cleanText(fixture.fixture?.venue?.city);
    const kickoff = cleanText(fixture.fixture?.date);
    if (!city || !kickoff) return null;

    if (!apiKey) {
      const forecast = await fetchOpenMeteoForecast({ city, kickoffAt: kickoff, fetchImpl: this.fetchImpl });
      if (!forecast) return null;
      const adverse = forecast.impactScore < 0;
      const temperature = forecast.temperatureC === null ? "temperature unavailable" : `${Math.round(forecast.temperatureC)}C`;
      const windSpeed = forecast.windKph === null ? 0 : forecast.windKph / 3.6;
      const precipitationProbability = forecast.precipitationProbability === null ? 0 : forecast.precipitationProbability / 100;
      return providerSignal({
        id: `${fixture.fixture?.id ?? "fixture"}-provider-weather`,
        category: "weather",
        label: adverse ? "Adverse weather tempo check" : "Weather check",
        detail: `${forecast.location} forecast near kickoff: ${forecast.condition}, ${temperature}, wind ${windSpeed.toFixed(1)} m/s, precipitation probability ${Math.round(
          precipitationProbability * 100
        )}%.`,
        quality: "acceptable",
        impact: adverse ? "tempo-down" : "neutral",
        confidence: adverse ? 0.7 : 0.58,
        weight: adverse ? Math.min(0.026, Math.abs(forecast.impactScore) * 0.12) : 0,
        source: "open-meteo-forecast"
      });
    }

    const endpoint = new URL("https://api.openweathermap.org/data/2.5/forecast");
    endpoint.searchParams.set("q", city);
    endpoint.searchParams.set("appid", apiKey);
    endpoint.searchParams.set("units", "metric");
    const data = (await fetchJson(this.fetchImpl, endpoint)) as OpenWeatherForecastResponse | null;
    const forecasts = Array.isArray(data?.list) ? data.list : [];
    if (!forecasts.length) return null;

    const kickoffMs = new Date(kickoff).getTime();
    const closest = forecasts
      .filter((item) => item.dt || item.dt_txt)
      .map((item) => {
        const itemMs = item.dt ? item.dt * 1000 : new Date(item.dt_txt ?? "").getTime();
        return { item, distance: Math.abs(itemMs - kickoffMs) };
      })
      .sort((a, b) => a.distance - b.distance)[0]?.item;
    if (!closest) return null;

    const condition = cleanText(closest.weather?.[0]?.main).toLowerCase();
    const description = cleanText(closest.weather?.[0]?.description) || condition || "weather update";
    const windSpeed = typeof closest.wind?.speed === "number" ? closest.wind.speed : 0;
    const precipitationMm = (closest.rain?.["3h"] ?? 0) + (closest.snow?.["3h"] ?? 0);
    const precipitationProbability = typeof closest.pop === "number" ? closest.pop : precipitationMm > 0 ? 0.6 : 0;
    const adverse = precipitationMm > 0 || precipitationProbability >= 0.45 || windSpeed >= 8 || condition.includes("rain") || condition.includes("snow") || condition.includes("storm");
    const temperature = typeof closest.main?.temp === "number" ? `${Math.round(closest.main.temp)}C` : "temperature unavailable";

    return providerSignal({
      id: `${fixture.fixture?.id ?? "fixture"}-provider-weather`,
      category: "weather",
      label: adverse ? "Adverse weather tempo check" : "Weather check",
      detail: `${city} forecast near kickoff: ${description}, ${temperature}, wind ${windSpeed.toFixed(1)} m/s, precipitation probability ${Math.round(
        precipitationProbability * 100
      )}%.`,
      quality: "acceptable",
      impact: adverse ? "tempo-down" : "neutral",
      confidence: adverse ? 0.7 : 0.58,
      weight: adverse ? Math.min(0.026, 0.012 + precipitationProbability * 0.012 + Math.max(0, windSpeed - 6) * 0.0015) : 0,
      source: "openweather-forecast"
    });
  }

  private async fetchNewsSignal(fixture: ApiFootballFixture): Promise<MatchContextSignal | null> {
    const apiKey = firstEnv(this.env, ["NEWS_API_KEY"]);
    const homeName = cleanText(fixture.teams?.home?.name);
    const awayName = cleanText(fixture.teams?.away?.name);
    const kickoff = cleanText(fixture.fixture?.date);
    if (!apiKey || !homeName || !awayName || !kickoff) return null;

    const endpoint = new URL("https://newsapi.org/v2/everything");
    endpoint.searchParams.set("q", `"${homeName}" OR "${awayName}" football`);
    endpoint.searchParams.set("searchIn", "title,description");
    endpoint.searchParams.set("language", this.env.NEWS_API_LANGUAGE?.trim() || "en");
    endpoint.searchParams.set("sortBy", "publishedAt");
    endpoint.searchParams.set("pageSize", this.env.NEWS_API_PAGE_SIZE?.trim() || "5");
    const from = new Date(kickoff);
    if (Number.isFinite(from.getTime())) {
      from.setUTCDate(from.getUTCDate() - 3);
      endpoint.searchParams.set("from", from.toISOString());
    }

    const data = (await fetchJson(this.fetchImpl, endpoint, { headers: { "X-Api-Key": apiKey } })) as NewsApiResponse | null;
    const articles = Array.isArray(data?.articles) ? data.articles.filter((article) => articleText(article)) : [];
    if (!articles.length) return null;

    const homeAdverse = articles.filter((article) => mentionsTeam(article, homeName) && hasAdverseNewsLanguage(article)).length;
    const awayAdverse = articles.filter((article) => mentionsTeam(article, awayName) && hasAdverseNewsLanguage(article)).length;
    const adverseDelta = homeAdverse - awayAdverse;
    const topArticle = articles[0];
    const sourceName = cleanText(topArticle?.source?.name) || "news source";
    const headline = cleanText(topArticle?.title) || "latest team news";
    const impact = adverseDelta > 0 ? "home-negative" : adverseDelta < 0 ? "away-negative" : "neutral";
    const adverseCount = homeAdverse + awayAdverse;

    return providerSignal({
      id: `${fixture.fixture?.id ?? "fixture"}-provider-news`,
      category: "news",
      label: adverseCount ? "Provider team-news risk" : "Provider news scan",
      detail: `${articles.length} recent article${articles.length === 1 ? "" : "s"} scanned for ${homeName} vs ${awayName}; adverse mentions ${homeName}: ${homeAdverse}, ${awayName}: ${awayAdverse}. Top source: ${sourceName}; headline: ${headline}.`,
      quality: adverseCount ? "acceptable" : articles.length >= 3 ? "acceptable" : "thin",
      impact,
      confidence: adverseCount ? Math.min(0.78, 0.58 + adverseCount * 0.06) : 0.52,
      weight: adverseDelta ? Math.min(0.026, 0.012 + Math.abs(adverseDelta) * 0.006) : 0,
      source: "newsapi-everything",
      publishedAt: cleanText(topArticle?.publishedAt) || undefined
    });
  }

  private buildProviderContextSignals({
    fixture,
    lineups,
    injuries,
    events,
    standings
  }: {
    fixture: ApiFootballFixture;
    lineups: ApiFootballLineup[];
    injuries: ApiFootballInjury[];
    events: ApiFootballEvent[];
    standings: ApiFootballStanding[];
  }): MatchContextSignal[] {
    const fixtureId = String(fixture.fixture?.id ?? "fixture");
    const homeName = cleanText(fixture.teams?.home?.name);
    const awayName = cleanText(fixture.teams?.away?.name);
    const signals: MatchContextSignal[] = [];
    const homeLineup = lineups.find((lineup) => sameTeam(cleanText(lineup.team?.name), homeName));
    const awayLineup = lineups.find((lineup) => sameTeam(cleanText(lineup.team?.name), awayName));

    if (homeLineup || awayLineup) {
      const homeCount = homeLineup?.startXI?.length ?? 0;
      const awayCount = awayLineup?.startXI?.length ?? 0;
      signals.push(
        providerSignal({
          id: `${fixtureId}-provider-lineups`,
          category: "lineup",
          label: homeLineup && awayLineup ? "Confirmed lineups loaded" : "Partial lineup feed loaded",
          detail: `${homeName || "Home"} starters: ${homeCount || "unknown"}; ${awayName || "Away"} starters: ${awayCount || "unknown"}.`,
          quality: homeLineup && awayLineup && homeCount >= 10 && awayCount >= 10 ? "strong" : "acceptable",
          impact: "neutral",
          confidence: homeLineup && awayLineup ? 0.82 : 0.64,
          weight: 0,
          source: "api-football-lineups"
        })
      );
    }

    const homeInjuries = injuries.filter((item) => sameTeam(cleanText(item.team?.name), homeName) && !isSuspension(item));
    const awayInjuries = injuries.filter((item) => sameTeam(cleanText(item.team?.name), awayName) && !isSuspension(item));
    const injuryDelta = homeInjuries.length - awayInjuries.length;
    if (homeInjuries.length || awayInjuries.length) {
      signals.push(
        providerSignal({
          id: `${fixtureId}-provider-injuries`,
          category: "injury",
          label: "Provider injury report",
          detail: `${homeName || "Home"} injuries: ${homeInjuries.length}; ${awayName || "Away"} injuries: ${awayInjuries.length}.`,
          quality: "acceptable",
          impact: injuryDelta > 0 ? "home-negative" : injuryDelta < 0 ? "away-negative" : "unknown",
          confidence: 0.72,
          weight: Math.min(0.026, 0.012 + Math.abs(injuryDelta) * 0.004),
          source: "api-football-injuries"
        })
      );
    }

    const homeSuspensions = injuries.filter((item) => sameTeam(cleanText(item.team?.name), homeName) && isSuspension(item));
    const awaySuspensions = injuries.filter((item) => sameTeam(cleanText(item.team?.name), awayName) && isSuspension(item));
    const suspensionDelta = homeSuspensions.length - awaySuspensions.length;
    if (homeSuspensions.length || awaySuspensions.length) {
      signals.push(
        providerSignal({
          id: `${fixtureId}-provider-suspensions`,
          category: "suspension",
          label: "Provider suspension report",
          detail: `${homeName || "Home"} suspensions: ${homeSuspensions.length}; ${awayName || "Away"} suspensions: ${awaySuspensions.length}.`,
          quality: "acceptable",
          impact: suspensionDelta > 0 ? "home-negative" : suspensionDelta < 0 ? "away-negative" : "unknown",
          confidence: 0.76,
          weight: Math.min(0.024, 0.012 + Math.abs(suspensionDelta) * 0.005),
          source: "api-football-injuries"
        })
      );
    } else if (homeInjuries.length || awayInjuries.length) {
      signals.push(
        providerSignal({
          id: `${fixtureId}-provider-suspension-clearance`,
          category: "suspension",
          label: "Provider suspension clearance",
          detail: `${homeName || "Home"} and ${awayName || "Away"} have no provider-reported suspensions in the availability feed.`,
          quality: "acceptable",
          impact: "neutral",
          confidence: 0.68,
          weight: 0,
          source: "api-football-injuries"
        })
      );
    }

    const homeStanding = standings.find((item) => sameTeam(cleanText(item.team?.name), homeName));
    const awayStanding = standings.find((item) => sameTeam(cleanText(item.team?.name), awayName));
    if (homeStanding || awayStanding) {
      const rankDiff = (awayStanding?.rank ?? 0) - (homeStanding?.rank ?? 0);
      const pointsDiff = (homeStanding?.points ?? 0) - (awayStanding?.points ?? 0);
      signals.push(
        providerSignal({
          id: `${fixtureId}-provider-standings`,
          category: "standings",
          label: "League standings context",
          detail: `${homeName || "Home"} rank ${homeStanding?.rank ?? "unknown"}, ${homeStanding?.points ?? "unknown"} pts; ${awayName || "Away"} rank ${awayStanding?.rank ?? "unknown"}, ${awayStanding?.points ?? "unknown"} pts.`,
          quality: homeStanding && awayStanding ? "acceptable" : "thin",
          impact: pointsDiff > 3 || rankDiff > 4 ? "home-positive" : pointsDiff < -3 || rankDiff < -4 ? "away-positive" : "neutral",
          confidence: 0.62,
          weight: Math.min(0.018, Math.max(0.006, Math.abs(pointsDiff) * 0.0015)),
          source: "api-football-standings"
        })
      );
    }

    const fixtureStatus = matchStatus(fixture.fixture?.status?.short);
    if (fixtureStatus !== "scheduled" && events.length) {
      const homeGoals = countTeamEvents(events, homeName, isGoalEvent);
      const awayGoals = countTeamEvents(events, awayName, isGoalEvent);
      const homeRedCards = countTeamEvents(events, homeName, isRedCardEvent);
      const awayRedCards = countTeamEvents(events, awayName, isRedCardEvent);
      const substitutions = events.filter(isSubstitutionEvent).length;
      const redCardDelta = homeRedCards - awayRedCards;
      const goalDelta = homeGoals - awayGoals;
      const minute = latestEventMinute(events);
      const impact =
        redCardDelta > 0
          ? "home-negative"
          : redCardDelta < 0
            ? "away-negative"
            : goalDelta > 0
              ? "home-positive"
              : goalDelta < 0
                ? "away-positive"
                : "neutral";
      const weight =
        redCardDelta !== 0
          ? Math.min(0.035, 0.018 + Math.abs(redCardDelta) * 0.01)
          : goalDelta !== 0
            ? Math.min(0.018, 0.008 + Math.abs(goalDelta) * 0.005)
            : 0;
      signals.push(
        providerSignal({
          id: `${fixtureId}-provider-events`,
          category: "live-event",
          label: redCardDelta !== 0 ? "Provider live event risk" : "Provider match events loaded",
          detail: `${homeName || "Home"} events: ${homeGoals} goals, ${homeRedCards} red cards; ${awayName || "Away"} events: ${awayGoals} goals, ${awayRedCards} red cards; substitutions tracked: ${substitutions}${
            minute ? `; latest event ${minute}'.` : "."
          }`,
          quality: events.length >= 3 || homeRedCards + awayRedCards > 0 ? "acceptable" : "thin",
          impact,
          confidence: redCardDelta !== 0 ? 0.84 : events.length >= 3 ? 0.72 : 0.62,
          weight,
          source: "api-football-events"
        })
      );
    }

    return signals;
  }
}

export const providerBackedSportsDataProvider = new ProviderBackedSportsDataProvider();
