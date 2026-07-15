import { firstConfiguredEnv } from "@/lib/env";
import { fetchOpenMeteoForecast } from "@/lib/sports/providers/openMeteo";
import {
  ingestHistoricalFootballFixtures,
  type HistoricalFootballAvailabilityInput,
  type HistoricalFootballEventInput,
  type HistoricalFootballFixtureInput,
  type HistoricalFootballIngestResult,
  type HistoricalFootballLineupInput,
  type HistoricalFootballNewsInput,
  type HistoricalFootballStandingInput,
  type HistoricalFootballWeatherInput
} from "./historicalIngestion";
import {
  storePlayerMatchPerformances,
  type PlayerMatchPerformance,
  type PlayerPerformanceStoreResult
} from "./playerPerformance";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type TrainingSyncSport = "football" | "basketball" | "tennis";
export type ProviderName = "api-football" | "api-basketball" | "api-tennis" | "the-odds-api";
type ProviderSyncStatus = "stored" | "dry-run" | "not-configured" | "provider-error" | "invalid-response" | "failed";

type EnvMap = Record<string, string | undefined>;

export type ProviderSyncRequest = {
  provider: ProviderName;
  dryRun?: boolean;
  league?: string;
  team?: string;
  season?: string;
  date?: string;
  from?: string;
  to?: string;
  sportKey?: string;
  regions?: string;
  bookmakers?: string;
  includeEvents?: boolean;
  includeNews?: boolean;
  includeContext?: boolean;
  includeStandings?: boolean;
  includeAvailability?: boolean;
  includeLineups?: boolean;
  includePlayerStats?: boolean;
  includeWeather?: boolean;
  maxEventFixtures?: number;
  maxContextFixtures?: number;
  limit?: number;
};

export type ProviderSyncResult = {
  status: ProviderSyncStatus;
  configured: boolean;
  provider: ProviderName;
  dryRun: boolean;
  endpoint: string | null;
  fetched: number;
  normalized: number;
  eventFetched?: number;
  eventNormalized?: number;
  eventErrors?: string[];
  newsFetched?: number;
  newsNormalized?: number;
  newsErrors?: string[];
  standingsFetched?: number;
  standingsNormalized?: number;
  standingsErrors?: string[];
  availabilityFetched?: number;
  availabilityNormalized?: number;
  availabilityErrors?: string[];
  lineupsFetched?: number;
  lineupsNormalized?: number;
  lineupsErrors?: string[];
  playerPerformancesFetched?: number;
  playerPerformancesNormalized?: number;
  playerPerformanceFixturesRequested?: number;
  playerPerformanceFixturesCovered?: number;
  playerPerformancesStored?: number;
  playerPerformancesVerified?: number;
  playerPerformancesErrors?: string[];
  weatherFetched?: number;
  weatherNormalized?: number;
  weatherErrors?: string[];
  ingestion?: HistoricalFootballIngestResult;
  reason?: string;
};

type ApiFootballFixtureResponse = {
  fixture?: {
    id?: number | string;
    date?: string;
    status?: {
      short?: string;
      long?: string;
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
    round?: string;
  };
  teams?: {
    home?: { id?: number | string; name?: string };
    away?: { id?: number | string; name?: string };
  };
  goals?: {
    home?: number | null;
    away?: number | null;
  };
  score?: {
    extratime?: { home?: number | null; away?: number | null };
    penalty?: { home?: number | null; away?: number | null };
  };
};

type ApiFootballResponse = {
  response?: ApiFootballFixtureResponse[];
  errors?: unknown;
};

type ApiBasketballGameResponse = {
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
  response?: ApiBasketballGameResponse[];
  errors?: unknown;
};

type ApiTennisEventResponse = {
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
  result?: ApiTennisEventResponse[];
  response?: ApiTennisEventResponse[];
  errors?: unknown;
  error?: string;
  success?: number;
};

type ApiFootballEventResponse = {
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

type ApiFootballEventsResponse = {
  response?: ApiFootballEventResponse[];
  errors?: unknown;
};

type ApiFootballStandingResponse = {
  rank?: number;
  team?: {
    id?: number | string;
    name?: string;
  };
  points?: number;
  goalsDiff?: number;
  group?: string;
  form?: string;
  all?: {
    played?: number;
    win?: number;
    draw?: number;
    lose?: number;
    goals?: {
      for?: number;
      against?: number;
    };
  };
};

type ApiFootballStandingsResponse = {
  response?: Array<{
    league?: {
      standings?: ApiFootballStandingResponse[][];
    };
  }>;
  errors?: unknown;
};

type ApiFootballInjuryResponse = {
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

type ApiFootballInjuriesResponse = {
  response?: ApiFootballInjuryResponse[];
  errors?: unknown;
};

type ApiFootballLineupResponse = {
  team?: {
    id?: number | string;
    name?: string;
  };
  formation?: string;
  startXI?: Array<{
    player?: {
      id?: number | string;
      name?: string;
      number?: number;
      pos?: string;
      grid?: string | null;
    };
  }>;
  substitutes?: Array<{
    player?: {
      id?: number | string;
      name?: string;
      number?: number;
      pos?: string;
      grid?: string | null;
    };
  }>;
};

type ApiFootballLineupsResponse = {
  response?: ApiFootballLineupResponse[];
  errors?: unknown;
};

type ApiFootballPlayerStatistics = {
  games?: {
    minutes?: number | string | null;
    number?: number | string | null;
    position?: string | null;
    rating?: number | string | null;
    captain?: boolean;
    substitute?: boolean;
  };
  offsides?: number | null;
  shots?: { total?: number | null; on?: number | null };
  goals?: { total?: number | null; conceded?: number | null; assists?: number | null; saves?: number | null };
  passes?: { total?: number | null; key?: number | null; accuracy?: number | string | null };
  tackles?: { total?: number | null; blocks?: number | null; interceptions?: number | null };
  duels?: { total?: number | null; won?: number | null };
  dribbles?: { attempts?: number | null; success?: number | null; past?: number | null };
  fouls?: { drawn?: number | null; committed?: number | null };
  cards?: { yellow?: number | null; red?: number | null };
  penalty?: { won?: number | null; commited?: number | null; scored?: number | null; missed?: number | null; saved?: number | null };
};

type ApiFootballFixturePlayerResponse = {
  team?: { id?: number | string; name?: string };
  players?: Array<{
    player?: { id?: number | string; name?: string };
    statistics?: ApiFootballPlayerStatistics[];
  }>;
};

type ApiFootballFixturePlayersResponse = {
  response?: ApiFootballFixturePlayerResponse[];
  errors?: unknown;
};

type OddsApiOutcome = {
  name?: string;
  price?: number;
};

type OddsApiMarket = {
  key?: string;
  last_update?: string;
  outcomes?: OddsApiOutcome[];
};

type OddsApiBookmaker = {
  key?: string;
  title?: string;
  last_update?: string;
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
};

type OddsApiHistoricalResponse = {
  timestamp?: string;
  data?: OddsApiEvent[];
  message?: string;
};

type OddsApiLiveResponse = OddsApiEvent[];

type NewsApiArticle = {
  source?: {
    name?: string | null;
  };
  title?: string | null;
  description?: string | null;
  url?: string | null;
  publishedAt?: string | null;
};

type NewsApiResponse = {
  status?: string;
  totalResults?: number;
  articles?: NewsApiArticle[];
  message?: string;
};

type OpenWeatherForecastItem = {
  dt?: number;
  dt_txt?: string;
  main?: {
    temp?: number;
    humidity?: number;
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
  message?: string;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstEnv(env: EnvMap, keys: string[]): string {
  return firstConfiguredEnv(env, keys);
}

function limited<T>(items: T[], limit?: number): T[] {
  if (!limit || limit <= 0) return items;
  return items.slice(0, limit);
}

function boundedOptionalInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function cappedFixtureSlice(
  fixtures: HistoricalFootballFixtureInput[],
  limit: number,
  label: string,
  errors: string[],
  paramName: string
): HistoricalFootballFixtureInput[] {
  const selected = fixtures.slice(0, limit);
  if (fixtures.length > selected.length) {
    errors.push(`${label} enrichment capped at ${selected.length}/${fixtures.length} fixture(s); pass ${paramName} to raise the cap after quota review.`);
  }
  return selected;
}

type ProviderFetchEvidenceKey = "events" | "standings" | "availability" | "lineups" | "weather" | "news";

function withProviderFetchEvidence(
  fixture: HistoricalFootballFixtureInput,
  key: ProviderFetchEvidenceKey,
  evidence: { attempted: true; succeeded: boolean; rows: number; error: string | null }
): HistoricalFootballFixtureInput["metadata"] {
  const metadata = fixture.metadata ?? {};
  const current = metadata.providerFetchEvidence;
  const providerFetchEvidence = current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
  return {
    ...metadata,
    providerFetchEvidence: {
      ...providerFetchEvidence,
      [key]: evidence
    }
  };
}

function providerErrorSummary(errors: unknown): string | null {
  if (!errors) return null;
  if (typeof errors === "string") return cleanText(errors) || null;
  if (Array.isArray(errors)) return errors.map((item) => cleanText(String(item))).filter(Boolean).join("; ") || null;
  if (typeof errors === "object") {
    const entries = Object.entries(errors as Record<string, unknown>);
    return (
      entries
        .map(([key, value]) => {
          const detail = typeof value === "string" ? cleanText(value) : JSON.stringify(value);
          return detail ? `${key}: ${detail}` : key;
        })
        .filter(Boolean)
        .join("; ") || null
    );
  }
  return cleanText(String(errors)) || null;
}

function apiFootballStatus(shortStatus: string | undefined): HistoricalFootballFixtureInput["status"] {
  if (["FT", "AET", "PEN"].includes(shortStatus ?? "")) return "finished";
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(shortStatus ?? "")) return "live";
  if (["PST", "CANC", "ABD", "AWD", "WO"].includes(shortStatus ?? "")) return shortStatus === "PST" ? "postponed" : "cancelled";
  return "scheduled";
}

function apiBasketballStatus(status: ApiBasketballGameResponse["status"]): HistoricalFootballFixtureInput["status"] {
  const raw = typeof status === "string" ? status : cleanText(status?.short || status?.long);
  const value = raw.toUpperCase();
  if (["FT", "AOT", "AP", "F", "FINISHED"].includes(value)) return "finished";
  if (["Q1", "Q2", "Q3", "Q4", "OT", "HT", "LIVE", "IN PLAY"].includes(value)) return "live";
  if (["POSTPONED", "PST", "CANCELLED", "CANCELED", "CAN", "ABD"].includes(value)) return value.includes("POST") || value === "PST" ? "postponed" : "cancelled";
  return "scheduled";
}

function apiTennisStatus(status: string | undefined): HistoricalFootballFixtureInput["status"] {
  const value = cleanText(status).toLowerCase();
  if (["finished", "after penalties", "retired", "walkover"].some((term) => value.includes(term))) return "finished";
  if (["in progress", "live", "set"].some((term) => value.includes(term))) return "live";
  if (value.includes("postpon")) return "postponed";
  if (value.includes("cancel") || value.includes("abandon")) return "cancelled";
  return "scheduled";
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function intOrNull(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function toIsoDate(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function kickoffFromBasketballDate(date: ApiBasketballGameResponse["date"], fallbackTime?: string): string {
  if (typeof date === "string") return toIsoDate(date);
  if (typeof date?.timestamp === "number") return new Date(date.timestamp * 1000).toISOString();
  const day = cleanText(date?.date);
  if (!day) return "";
  const time = cleanText(date?.time || fallbackTime) || "00:00";
  return toIsoDate(`${day}T${time.length === 5 ? `${time}:00` : time}Z`);
}

function kickoffFromTennisEvent(event: ApiTennisEventResponse): string {
  const day = cleanText(event.event_date);
  if (!day) return "";
  const time = cleanText(event.event_time) || "00:00";
  return toIsoDate(`${day}T${time.length === 5 ? `${time}:00` : time}Z`);
}

function parseScorePair(text: string): { homeScore: number | null; awayScore: number | null } {
  const match = cleanText(text).match(/(\d+)\s*[-:]\s*(\d+)/);
  return {
    homeScore: match ? Number(match[1]) : null,
    awayScore: match ? Number(match[2]) : null
  };
}

function sportFromProvider(provider: ProviderName, sportKey?: string): TrainingSyncSport {
  if (provider === "api-basketball") return "basketball";
  if (provider === "api-tennis") return "tennis";
  const key = cleanText(sportKey).toLowerCase();
  if (key.startsWith("basketball_")) return "basketball";
  if (key.startsWith("tennis_")) return "tennis";
  return "football";
}

function marketTitleForSport(sport: TrainingSyncSport): string {
  if (sport === "basketball") return "The Odds API basketball";
  if (sport === "tennis") return "The Odds API tennis";
  return "The Odds API football";
}

function providerKeyForSport(sport: TrainingSyncSport): string {
  if (sport === "basketball") return "api_basketball";
  if (sport === "tennis") return "api_tennis";
  return "api_football";
}

function roundProbability(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function dataQualityForApiFootball(fixture: ApiFootballFixtureResponse): number {
  let score = 0.55;
  if (fixture.fixture?.id) score += 0.08;
  if (fixture.fixture?.date) score += 0.08;
  if (fixture.league?.id && fixture.league?.name) score += 0.08;
  if (fixture.teams?.home?.id && fixture.teams?.away?.id) score += 0.08;
  if (typeof fixture.goals?.home === "number" && typeof fixture.goals?.away === "number") score += 0.08;
  return Math.min(0.92, roundProbability(score));
}

function eventValueForApiFootballEvent(event: ApiFootballEventResponse): number | null {
  const type = cleanText(event.type).toLowerCase();
  const detail = cleanText(event.detail).toLowerCase();
  if (type.includes("goal") && !detail.includes("missed") && !detail.includes("disallowed") && !detail.includes("cancelled")) return 1;
  if (type.includes("card") && detail.includes("red")) return -1;
  if (type.includes("card") && detail.includes("yellow")) return -0.25;
  if (type.includes("subst")) return 0;
  return null;
}

function safeId(value: unknown, prefix: string): string {
  const text = String(value ?? "").trim();
  return text || `${prefix}-unknown`;
}

function slugId(value: string, fallback: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || fallback;
}

function normalizedTeamName(value: string): string {
  return value.toLowerCase().replace(/\b(fc|cf|afc|sc|ac)\b/g, "").replace(/[^a-z0-9]+/g, "");
}

function redactedUrl(url: URL, secret?: string): string {
  const text = url.toString();
  return secret ? text.replace(secret, "REDACTED") : text;
}

function articleText(article: NewsApiArticle): string {
  return `${cleanText(article.title)} ${cleanText(article.description)}`.trim();
}

function hasAnyTerm(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function newsSignalType(article: NewsApiArticle): HistoricalFootballNewsInput["signalType"] {
  const text = articleText(article);
  if (hasAnyTerm(text, ["injury", "injured", "fitness", "illness", "ruled out", "doubtful"])) return "injury";
  if (hasAnyTerm(text, ["lineup", "starting xi", "team news", "rotation", "rested"])) return "lineup";
  if (hasAnyTerm(text, ["formation", "tactical", "manager", "press conference"])) return "tactical";
  if (hasAnyTerm(text, ["transfer", "loan", "signing"])) return "transfer";
  return "other";
}

function newsImpactScore(article: NewsApiArticle): number {
  const text = articleText(article);
  if (hasAnyTerm(text, ["injury", "injured", "suspended", "ban", "ruled out", "doubtful", "setback", "illness", "absent"])) return -0.2;
  if (hasAnyTerm(text, ["returns", "fit", "available", "boost", "cleared"])) return 0.12;
  return 0;
}

function availabilityStatus(item: ApiFootballInjuryResponse): HistoricalFootballAvailabilityInput["status"] {
  const text = `${cleanText(item.player?.type)} ${cleanText(item.player?.reason)}`.toLowerCase();
  if (hasAnyTerm(text, ["suspend", "red card", "ban"])) return "suspended";
  if (hasAnyTerm(text, ["doubt", "questionable", "fitness"])) return "doubtful";
  if (hasAnyTerm(text, ["injur", "illness", "knock", "strain", "fracture", "out"])) return "injured";
  return "unknown";
}

function availabilityImpact(status: HistoricalFootballAvailabilityInput["status"]): number {
  if (status === "suspended") return -0.18;
  if (status === "injured") return -0.14;
  if (status === "doubtful") return -0.08;
  return 0;
}

function apiFootballTeamExternalId(value: unknown, fallback: string): string {
  return `api-football:${safeId(value, fallback)}`;
}

function forecastTimestamp(item: OpenWeatherForecastItem): number | null {
  if (typeof item.dt === "number") return item.dt * 1000;
  const text = cleanText(item.dt_txt);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function precipitationMm(item: OpenWeatherForecastItem): number {
  return Number(((item.rain?.["3h"] ?? 0) + (item.snow?.["3h"] ?? 0)).toFixed(3));
}

function weatherImpactScore(item: OpenWeatherForecastItem): number {
  const condition = cleanText(item.weather?.[0]?.main).toLowerCase();
  const windKph = (item.wind?.speed ?? 0) * 3.6;
  const precipitation = precipitationMm(item);
  const precipitationProbability = typeof item.pop === "number" ? item.pop : precipitation > 0 ? 0.5 : 0;
  const adverse = precipitation > 0 || precipitationProbability >= 0.45 || windKph >= 28 || condition.includes("rain") || condition.includes("snow") || condition.includes("storm");
  if (!adverse) return 0;
  return -roundProbability(Math.min(0.22, 0.08 + precipitationProbability * 0.08 + Math.max(0, windKph - 28) * 0.002));
}

export function normalizeApiFootballFixtures(
  response: ApiFootballResponse,
  { limit, eventsByFixtureId = new Map<string, HistoricalFootballEventInput[]>() }: { limit?: number; eventsByFixtureId?: Map<string, HistoricalFootballEventInput[]> } = {}
): HistoricalFootballFixtureInput[] {
  const fixtures = Array.isArray(response.response) ? response.response : [];

  return limited(fixtures, limit)
    .map((item) => {
      const fixtureId = safeId(item.fixture?.id, "api-football-fixture");
      const kickoffAt = cleanText(item.fixture?.date);
      const rawStatus = apiFootballStatus(item.fixture?.status?.short);
      const homeScore = typeof item.goals?.home === "number" ? item.goals.home : null;
      const awayScore = typeof item.goals?.away === "number" ? item.goals.away : null;
      const status = rawStatus === "finished" && (homeScore === null || awayScore === null) ? "scheduled" : rawStatus;

      return {
        externalId: `api-football:${fixtureId}`,
        kickoffAt,
        league: {
          externalId: `api-football:${safeId(item.league?.id, "league")}`,
          name: cleanText(item.league?.name) || "Unknown league",
          country: cleanText(item.league?.country) || null
        },
        season: item.league?.season === undefined ? null : String(item.league.season),
        round: cleanText(item.league?.round) || null,
        status,
        homeTeam: {
          externalId: `api-football:${safeId(item.teams?.home?.id, "home-team")}`,
          name: cleanText(item.teams?.home?.name) || "Home team",
          country: cleanText(item.league?.country) || null
        },
        awayTeam: {
          externalId: `api-football:${safeId(item.teams?.away?.id, "away-team")}`,
          name: cleanText(item.teams?.away?.name) || "Away team",
          country: cleanText(item.league?.country) || null
        },
        homeScore,
        awayScore,
        venue: item.fixture?.venue?.name ?? null,
        country: cleanText(item.league?.country) || null,
        dataQuality: dataQualityForApiFootball(item),
        events: eventsByFixtureId.get(`api-football:${fixtureId}`) ?? eventsByFixtureId.get(fixtureId) ?? [],
        metadata: {
          venueCity: item.fixture?.venue?.city ?? null,
          providerStatus: item.fixture?.status ?? null,
          extraTime: item.score?.extratime ?? null,
          penalties: item.score?.penalty ?? null
        }
      } satisfies HistoricalFootballFixtureInput;
    })
    .filter((fixture) => fixture.kickoffAt);
}

function basketballDataQuality(game: ApiBasketballGameResponse): number {
  let score = 0.54;
  if (game.id) score += 0.08;
  if (game.date) score += 0.08;
  if (game.league?.id && game.league?.name) score += 0.08;
  if (game.teams?.home?.id && game.teams?.away?.id) score += 0.08;
  if (intOrNull(game.scores?.home?.total) !== null && intOrNull(game.scores?.away?.total) !== null) score += 0.08;
  return Math.min(0.92, roundProbability(score));
}

export function normalizeApiBasketballGames(response: ApiBasketballResponse, { limit }: { limit?: number } = {}): HistoricalFootballFixtureInput[] {
  const games = Array.isArray(response.response) ? response.response : [];

  return limited(games, limit)
    .map((game) => {
      const gameId = safeId(game.id, "api-basketball-game");
      const kickoffAt = kickoffFromBasketballDate(game.date, game.time);
      const homeScore = intOrNull(game.scores?.home?.total);
      const awayScore = intOrNull(game.scores?.away?.total);
      const rawStatus = apiBasketballStatus(game.status);
      const status = rawStatus === "finished" && (homeScore === null || awayScore === null) ? "scheduled" : rawStatus;
      const country = cleanText(game.league?.country) || null;

      return {
        sport: "basketball",
        externalId: `api-basketball:${gameId}`,
        kickoffAt,
        league: {
          externalId: `api-basketball:${safeId(game.league?.id, "league")}`,
          name: cleanText(game.league?.name) || "Unknown basketball league",
          country
        },
        season: game.league?.season === undefined ? null : String(game.league.season),
        status,
        homeTeam: {
          externalId: `api-basketball:${safeId(game.teams?.home?.id, "home-team")}`,
          name: cleanText(game.teams?.home?.name) || "Home team",
          country
        },
        awayTeam: {
          externalId: `api-basketball:${safeId(game.teams?.away?.id, "away-team")}`,
          name: cleanText(game.teams?.away?.name) || "Away team",
          country
        },
        homeScore,
        awayScore,
        country,
        dataQuality: basketballDataQuality(game),
        homeFeatures: {
          metadata: {
            source: "api-basketball",
            featureStatus: "box-score features pending",
            teamRole: "home"
          }
        },
        awayFeatures: {
          metadata: {
            source: "api-basketball",
            featureStatus: "box-score features pending",
            teamRole: "away"
          }
        },
        metadata: {
          providerStatus: game.status ?? null,
          source: "api-basketball"
        }
      } satisfies HistoricalFootballFixtureInput;
    })
    .filter((fixture) => fixture.kickoffAt);
}

function tennisSurface(value: string | undefined): string | null {
  const raw = cleanText(value).toLowerCase();
  if (!raw) return null;
  if (raw.includes("clay")) return "clay";
  if (raw.includes("grass")) return "grass";
  if (raw.includes("indoor")) return "indoor";
  if (raw.includes("hard")) return "hard";
  return raw;
}

function tennisDataQuality(event: ApiTennisEventResponse): number {
  let score = 0.52;
  if (event.event_key || event.id) score += 0.08;
  if (event.event_date) score += 0.08;
  if (event.tournament_key || event.league_key || event.tournament_name || event.league_name) score += 0.08;
  if (event.event_first_player && event.event_second_player) score += 0.08;
  if (event.event_final_result || event.event_game_result) score += 0.08;
  return Math.min(0.9, roundProbability(score));
}

export function normalizeApiTennisEvents(response: ApiTennisResponse, { limit }: { limit?: number } = {}): HistoricalFootballFixtureInput[] {
  const events = Array.isArray(response.result) ? response.result : Array.isArray(response.response) ? response.response : [];

  return limited(events, limit)
    .map((event) => {
      const eventId = safeId(event.event_key ?? event.id, "api-tennis-event");
      const kickoffAt = kickoffFromTennisEvent(event);
      const score = parseScorePair(event.event_final_result || event.event_game_result || "");
      const rawStatus = apiTennisStatus(event.event_status);
      const status = rawStatus === "finished" && (score.homeScore === null || score.awayScore === null) ? "scheduled" : rawStatus;
      const tournamentId = event.tournament_key ?? event.league_key;
      const tournamentName = cleanText(event.tournament_name || event.league_name) || "Unknown tennis tournament";
      const surface = tennisSurface(event.surface || event.event_surface);

      return {
        sport: "tennis",
        externalId: `api-tennis:${eventId}`,
        kickoffAt,
        league: {
          externalId: `api-tennis:${safeId(tournamentId, "tournament")}`,
          name: tournamentName,
          country: "World"
        },
        season: cleanText(event.tournament_season) || null,
        round: cleanText(event.tournament_round) || null,
        status,
        homeTeam: {
          externalId: `api-tennis:${safeId(event.first_player_key, slugId(cleanText(event.event_first_player), `first-${eventId}`))}`,
          name: cleanText(event.event_first_player) || "Player one",
          country: null
        },
        awayTeam: {
          externalId: `api-tennis:${safeId(event.second_player_key, slugId(cleanText(event.event_second_player), `second-${eventId}`))}`,
          name: cleanText(event.event_second_player) || "Player two",
          country: null
        },
        homeScore: score.homeScore,
        awayScore: score.awayScore,
        dataQuality: tennisDataQuality(event),
        homeFeatures: {
          metadata: {
            source: "api-tennis",
            featureStatus: "surface Elo features pending",
            surface,
            playerRole: "first"
          }
        },
        awayFeatures: {
          metadata: {
            source: "api-tennis",
            featureStatus: "surface Elo features pending",
            surface,
            playerRole: "second"
          }
        },
        metadata: {
          source: "api-tennis",
          providerStatus: event.event_status ?? null,
          finalResult: event.event_final_result ?? null,
          gameResult: event.event_game_result ?? null,
          surface
        }
      } satisfies HistoricalFootballFixtureInput;
    })
    .filter((fixture) => fixture.kickoffAt);
}

export function normalizeApiFootballEvents(
  response: ApiFootballEventsResponse,
  { fixtureExternalId, limit }: { fixtureExternalId: string; limit?: number }
): HistoricalFootballEventInput[] {
  const events = Array.isArray(response.response) ? response.response : [];

  return limited(events, limit).flatMap((event, index) => {
    const eventType = cleanText(event.type) || cleanText(event.detail);
    if (!eventType) return [];
    const rawMinute = typeof event.time?.elapsed === "number" ? event.time.elapsed : null;
    const rawStoppageMinute = typeof event.time?.extra === "number" ? event.time.extra : null;
    const minute = rawMinute !== null && Number.isInteger(rawMinute) && rawMinute >= 0 && rawMinute <= 130 ? rawMinute : null;
    const stoppageMinute = rawStoppageMinute !== null && Number.isInteger(rawStoppageMinute) && rawStoppageMinute >= 0
      ? rawStoppageMinute
      : null;
    const teamExternalId = event.team?.id === undefined ? null : `api-football:${event.team.id}`;
    const playerExternalId = event.player?.id === undefined ? null : `api-football:${event.player.id}`;
    const detail = cleanText(event.detail) || null;
    const eventHash = `${fixtureExternalId}:${index}:${minute ?? ""}:${teamExternalId ?? ""}:${playerExternalId ?? ""}:${eventType}:${detail ?? ""}`;

    return {
      eventExternalId: `api-football-event:${slugId(eventHash, `event-${index}`)}`,
      minute,
      stoppageMinute,
      teamExternalId,
      playerExternalId,
      eventType,
      eventValue: eventValueForApiFootballEvent(event),
      metadata: {
        detail,
        rawMinute: rawMinute !== minute ? rawMinute : null,
        rawStoppageMinute: rawStoppageMinute !== stoppageMinute ? rawStoppageMinute : null,
        comments: event.comments ?? null,
        teamName: cleanText(event.team?.name) || null,
        playerName: cleanText(event.player?.name) || null,
        assistExternalId: event.assist?.id === undefined ? null : `api-football:${event.assist.id}`,
        assistName: cleanText(event.assist?.name) || null
      }
    };
  });
}

export function normalizeApiFootballStandingsForFixture(
  response: ApiFootballStandingsResponse,
  fixture: HistoricalFootballFixtureInput,
  { snapshotAt = fixture.kickoffAt, limit }: { snapshotAt?: string; limit?: number } = {}
): HistoricalFootballStandingInput[] {
  const standings = response.response?.[0]?.league?.standings?.flat() ?? [];
  const fixtureTeamIds = new Set([fixture.homeTeam.externalId, fixture.awayTeam.externalId]);

  return limited(standings, limit).flatMap((standing) => {
    const teamExternalId = apiFootballTeamExternalId(standing.team?.id, slugId(cleanText(standing.team?.name), "team"));
    if (!fixtureTeamIds.has(teamExternalId)) return [];
    const form = cleanText(standing.form)
      .split("")
      .filter(Boolean);

    return {
      teamExternalId,
      snapshotAt,
      position: typeof standing.rank === "number" ? standing.rank : null,
      played: typeof standing.all?.played === "number" ? standing.all.played : null,
      points: typeof standing.points === "number" ? standing.points : null,
      wins: typeof standing.all?.win === "number" ? standing.all.win : null,
      draws: typeof standing.all?.draw === "number" ? standing.all.draw : null,
      losses: typeof standing.all?.lose === "number" ? standing.all.lose : null,
      goalsFor: typeof standing.all?.goals?.for === "number" ? standing.all.goals.for : null,
      goalsAgainst: typeof standing.all?.goals?.against === "number" ? standing.all.goals.against : null,
      form,
      metadata: {
        teamName: cleanText(standing.team?.name) || null,
        group: cleanText(standing.group) || null,
        goalsDiff: typeof standing.goalsDiff === "number" ? standing.goalsDiff : null,
        source: "api-football-standings"
      }
    };
  });
}

export function normalizeApiFootballInjuriesForFixture(
  response: ApiFootballInjuriesResponse,
  fixture: HistoricalFootballFixtureInput,
  { limit }: { limit?: number } = {}
): HistoricalFootballAvailabilityInput[] {
  const injuries = Array.isArray(response.response) ? response.response : [];
  const fixtureTeamIds = new Set([fixture.homeTeam.externalId, fixture.awayTeam.externalId]);

  return limited(injuries, limit).flatMap((item) => {
    const teamExternalId = apiFootballTeamExternalId(item.team?.id, slugId(cleanText(item.team?.name), "team"));
    const playerName = cleanText(item.player?.name);
    if (!fixtureTeamIds.has(teamExternalId) || !playerName) return [];
    const status = availabilityStatus(item);

    return {
      teamExternalId,
      playerExternalId: item.player?.id === undefined ? null : apiFootballTeamExternalId(item.player.id, "player"),
      playerName,
      status,
      impactScore: availabilityImpact(status),
      reason: cleanText(item.player?.reason) || cleanText(item.player?.type) || null,
      observedAt: fixture.kickoffAt,
      metadata: {
        teamName: cleanText(item.team?.name) || null,
        playerType: cleanText(item.player?.type) || null,
        source: "api-football-injuries"
      }
    };
  });
}

export function normalizeApiFootballLineupsForFixture(
  response: ApiFootballLineupsResponse,
  fixture: HistoricalFootballFixtureInput,
  { limit }: { limit?: number } = {}
): HistoricalFootballLineupInput[] {
  const lineups = Array.isArray(response.response) ? response.response : [];
  const fixtureTeamIds = new Set([fixture.homeTeam.externalId, fixture.awayTeam.externalId]);

  return limited(lineups, limit).flatMap((lineup) => {
    const teamExternalId = apiFootballTeamExternalId(lineup.team?.id, slugId(cleanText(lineup.team?.name), "team"));
    if (!fixtureTeamIds.has(teamExternalId)) return [];
    const starters =
      lineup.startXI?.flatMap((item) => {
        const name = cleanText(item.player?.name);
        if (!name) return [];
        return {
          id: item.player?.id === undefined ? null : apiFootballTeamExternalId(item.player.id, "player"),
          name,
          number: item.player?.number ?? null,
          position: cleanText(item.player?.pos) || null,
          grid: item.player?.grid ?? null,
          starter: true
        };
      }) ?? [];
    const substitutes =
      lineup.substitutes?.flatMap((item) => {
        const name = cleanText(item.player?.name);
        if (!name) return [];
        return {
          id: item.player?.id === undefined ? null : apiFootballTeamExternalId(item.player.id, "player"),
          name,
          number: item.player?.number ?? null,
          position: cleanText(item.player?.pos) || null,
          grid: item.player?.grid ?? null,
          starter: false
        };
      }) ?? [];

    return {
      teamExternalId,
      lineupStatus: starters.length >= 10 ? "confirmed" : "predicted",
      formation: cleanText(lineup.formation) || null,
      players: [...starters, ...substitutes],
      observedAt: fixture.kickoffAt,
      metadata: {
        teamName: cleanText(lineup.team?.name) || null,
        starters: starters.length,
        substitutes: substitutes.length,
        source: "api-football-lineups"
      }
    };
  });
}

function percentageNumber(value: unknown): number | null {
  const normalized = typeof value === "string" ? value.replace("%", "").trim() : value;
  const parsed = finiteNumber(normalized);
  return parsed === null ? null : Math.min(100, Math.max(0, parsed));
}

function playerPerformanceDataQuality({
  playerId,
  teamId,
  minutes,
  rating,
  statistics
}: {
  playerId: unknown;
  teamId: unknown;
  minutes: number;
  rating: number | null;
  statistics: ApiFootballPlayerStatistics;
}): number {
  let score = 0.45;
  if (playerId !== undefined && playerId !== null) score += 0.1;
  if (teamId !== undefined && teamId !== null) score += 0.1;
  if (minutes > 0) score += 0.1;
  if (rating !== null) score += 0.1;
  if (statistics.shots || statistics.passes || statistics.tackles || statistics.goals) score += 0.1;
  return Number(Math.min(0.95, score).toFixed(4));
}

const MINIMUM_PLAYER_ROWS_PER_TEAM = 11;

function playerPerformanceCoverage(
  fixture: HistoricalFootballFixtureInput,
  performances: PlayerMatchPerformance[]
): { complete: boolean; homeRows: number; awayRows: number } {
  const activeRows = performances.filter((row) => row.minutes > 0);
  const homeRows = activeRows.filter((row) => row.teamExternalId === fixture.homeTeam.externalId).length;
  const awayRows = activeRows.filter((row) => row.teamExternalId === fixture.awayTeam.externalId).length;
  return {
    complete: homeRows >= MINIMUM_PLAYER_ROWS_PER_TEAM && awayRows >= MINIMUM_PLAYER_ROWS_PER_TEAM,
    homeRows,
    awayRows
  };
}

export function normalizeApiFootballPlayerPerformancesForFixture(
  response: ApiFootballFixturePlayersResponse,
  fixture: HistoricalFootballFixtureInput,
  { observedAt = new Date().toISOString() }: { observedAt?: string } = {}
): PlayerMatchPerformance[] {
  const teams = Array.isArray(response.response) ? response.response : [];
  const fixtureTeamIds = new Set([fixture.homeTeam.externalId, fixture.awayTeam.externalId]);

  return teams.flatMap((team) => {
    const teamName = cleanText(team.team?.name);
    const teamExternalId = apiFootballTeamExternalId(team.team?.id, slugId(teamName, "team"));
    if (!fixtureTeamIds.has(teamExternalId)) return [];
    return (team.players ?? []).flatMap((entry) => {
      const playerName = cleanText(entry.player?.name);
      const statistics = entry.statistics?.[0];
      if (!playerName || !statistics) return [];
      const minutes = Math.min(200, Math.max(0, intOrNull(statistics.games?.minutes) ?? 0));
      const rating = finiteNumber(statistics.games?.rating);
      const playerExternalId = apiFootballTeamExternalId(entry.player?.id, slugId(`${teamExternalId}-${playerName}`, "player"));
      return [{
        sport: "football" as const,
        provider: "api_football",
        sourceKind: "real" as const,
        fixtureExternalId: fixture.externalId,
        fixtureKickoffAt: fixture.kickoffAt,
        teamExternalId,
        playerExternalId,
        playerName,
        position: cleanText(statistics.games?.position) || null,
        shirtNumber: intOrNull(statistics.games?.number),
        minutes,
        started: statistics.games?.substitute === false,
        captain: statistics.games?.captain === true,
        rating: rating === null ? null : Math.min(10, Math.max(0, rating)),
        goals: Math.max(0, intOrNull(statistics.goals?.total) ?? 0),
        assists: Math.max(0, intOrNull(statistics.goals?.assists) ?? 0),
        shotsTotal: Math.max(0, intOrNull(statistics.shots?.total) ?? 0),
        shotsOnTarget: Math.max(0, intOrNull(statistics.shots?.on) ?? 0),
        passesTotal: Math.max(0, intOrNull(statistics.passes?.total) ?? 0),
        keyPasses: Math.max(0, intOrNull(statistics.passes?.key) ?? 0),
        passAccuracy: percentageNumber(statistics.passes?.accuracy),
        tackles: Math.max(0, intOrNull(statistics.tackles?.total) ?? 0),
        interceptions: Math.max(0, intOrNull(statistics.tackles?.interceptions) ?? 0),
        saves: Math.max(0, intOrNull(statistics.goals?.saves) ?? 0),
        yellowCards: Math.max(0, intOrNull(statistics.cards?.yellow) ?? 0),
        redCards: Math.max(0, intOrNull(statistics.cards?.red) ?? 0),
        dataQuality: playerPerformanceDataQuality({ playerId: entry.player?.id, teamId: team.team?.id, minutes, rating, statistics }),
        metrics: {
          offsides: statistics.offsides ?? null,
          goalsConceded: statistics.goals?.conceded ?? null,
          blocks: statistics.tackles?.blocks ?? null,
          duels: statistics.duels ?? null,
          dribbles: statistics.dribbles ?? null,
          fouls: statistics.fouls ?? null,
          penalty: statistics.penalty ?? null,
          teamName,
          source: "api-football-fixtures-players"
        },
        observedAt
      } satisfies PlayerMatchPerformance];
    });
  });
}

export function normalizeOpenWeatherForecastForFixture(
  response: OpenWeatherForecastResponse,
  fixture: HistoricalFootballFixtureInput
): HistoricalFootballWeatherInput[] {
  const forecasts = Array.isArray(response.list) ? response.list : [];
  const kickoffMs = Date.parse(fixture.kickoffAt);
  if (!Number.isFinite(kickoffMs) || !forecasts.length) return [];
  const closest = forecasts
    .flatMap((item) => {
      const timestamp = forecastTimestamp(item);
      return timestamp === null ? [] : [{ item, timestamp, distance: Math.abs(timestamp - kickoffMs) }];
    })
    .sort((a, b) => a.distance - b.distance)[0];
  if (!closest) return [];

  const condition = cleanText(closest.item.weather?.[0]?.description) || cleanText(closest.item.weather?.[0]?.main) || null;
  const windKph = typeof closest.item.wind?.speed === "number" ? Number((closest.item.wind.speed * 3.6).toFixed(3)) : null;

  return [
    {
      observedFor: new Date(closest.timestamp).toISOString(),
      temperatureC: typeof closest.item.main?.temp === "number" ? closest.item.main.temp : null,
      precipitationMm: precipitationMm(closest.item),
      windKph,
      humidity: typeof closest.item.main?.humidity === "number" ? closest.item.main.humidity : null,
      condition,
      impactScore: weatherImpactScore(closest.item),
      metadata: {
        forecastDistanceMinutes: Math.round(closest.distance / 60000),
        precipitationProbability: typeof closest.item.pop === "number" ? closest.item.pop : null,
        source: "openweather-forecast"
      }
    }
  ];
}

export function normalizeNewsApiArticlesForFixture(
  response: NewsApiResponse,
  fixture: HistoricalFootballFixtureInput,
  { limit }: { limit?: number } = {}
): HistoricalFootballNewsInput[] {
  const articles = Array.isArray(response.articles) ? response.articles : [];
  const homeName = cleanText(fixture.homeTeam.name);
  const awayName = cleanText(fixture.awayTeam.name);
  const normalizedHome = normalizedTeamName(homeName);
  const normalizedAway = normalizedTeamName(awayName);

  return limited(articles, limit).flatMap((article) => {
    const summary = articleText(article);
    if (!summary) return [];
    const normalizedText = normalizedTeamName(summary);
    const mentionsHome = Boolean(normalizedHome && normalizedText.includes(normalizedHome));
    const mentionsAway = Boolean(normalizedAway && normalizedText.includes(normalizedAway));
    const impactScore = newsImpactScore(article);

    return {
      sourceName: cleanText(article.source?.name) || "newsapi",
      sourceUrl: cleanText(article.url) || null,
      publishedAt: cleanText(article.publishedAt) || null,
      signalType: newsSignalType(article),
      sentiment: impactScore < 0 ? -0.4 : impactScore > 0 ? 0.3 : 0,
      confidence: impactScore === 0 ? 0.5 : 0.64,
      impactScore,
      summary,
      entities: [
        ...(mentionsHome ? [{ type: "team", side: "home", name: homeName, externalId: fixture.homeTeam.externalId }] : []),
        ...(mentionsAway ? [{ type: "team", side: "away", name: awayName, externalId: fixture.awayTeam.externalId }] : [])
      ],
      raw: {
        title: article.title ?? null,
        description: article.description ?? null,
        totalResults: response.totalResults ?? null
      },
      metadata: {
        provider: "newsapi",
        mentionsHome,
        mentionsAway
      }
    };
  });
}

function outcomeSelection(outcomeName: string | undefined, event: OddsApiEvent): "home" | "draw" | "away" | null {
  const name = cleanText(outcomeName).toLowerCase();
  if (!name) return null;
  if (name === "draw" || name === "tie") return "draw";
  if (name === cleanText(event.home_team).toLowerCase()) return "home";
  if (name === cleanText(event.away_team).toLowerCase()) return "away";
  return null;
}

function normalizeTheOddsApiEvents(
  events: OddsApiEvent[],
  { limit, sportKey, timestamp }: { limit?: number; sportKey?: string; timestamp?: string | null } = {}
): HistoricalFootballFixtureInput[] {
  const sport = sportFromProvider("the-odds-api", sportKey);

  return limited(events, limit)
    .map((event) => {
      const eventId = cleanText(event.id);
      const kickoffAt = cleanText(event.commence_time);
      const homeName = cleanText(event.home_team);
      const awayName = cleanText(event.away_team);
      const odds =
        event.bookmakers?.flatMap((bookmaker) =>
          bookmaker.markets
            ?.filter((market) => market.key === "h2h")
            .flatMap((market) =>
              market.outcomes?.flatMap((outcome) => {
                const selection = outcomeSelection(outcome.name, event);
                if (selection === "draw" && sport !== "football") return [];
                if (!selection || typeof outcome.price !== "number" || outcome.price <= 1) return [];
                return {
                  bookmaker: bookmaker.title || bookmaker.key || "the-odds-api",
                  market: "match_winner" as const,
                  selection,
                  decimalOdds: outcome.price,
                  observedAt: market.last_update ?? bookmaker.last_update ?? timestamp ?? null,
                  metadata: {
                    sportKey: event.sport_key ?? sportKey ?? null,
                    marketKey: market.key ?? null,
                    bookmakerKey: bookmaker.key ?? null
                  }
                };
              }) ?? []
            ) ?? []
        ) ?? [];

      return {
        sport,
        externalId: `the-odds-api:${eventId || `${homeName}-${awayName}-${kickoffAt}`}`,
        kickoffAt,
        league: {
          externalId: `the-odds-api:${event.sport_key ?? sportKey ?? "soccer"}`,
          name: cleanText(event.sport_title) || sportKey || marketTitleForSport(sport),
          country: null
        },
        status: "scheduled",
        homeTeam: {
          externalId: `the-odds-api:${slugId(homeName, `home-${eventId || "unknown"}`)}`,
          name: homeName || "Home team"
        },
        awayTeam: {
          externalId: `the-odds-api:${slugId(awayName, `away-${eventId || "unknown"}`)}`,
          name: awayName || "Away team"
        },
        dataQuality: odds.length >= 3 ? 0.76 : 0.58,
        odds,
        metadata: {
          snapshotTimestamp: timestamp ?? null,
          source: "the-odds-api"
        }
      } satisfies HistoricalFootballFixtureInput;
    })
    .filter((fixture) => fixture.kickoffAt && fixture.odds?.length);
}

export function normalizeTheOddsApiHistoricalOdds(
  response: OddsApiHistoricalResponse,
  { limit, sportKey }: { limit?: number; sportKey?: string } = {}
): HistoricalFootballFixtureInput[] {
  return normalizeTheOddsApiEvents(Array.isArray(response.data) ? response.data : [], {
    limit,
    sportKey,
    timestamp: response.timestamp ?? null
  });
}

export function normalizeTheOddsApiLiveOdds(
  response: OddsApiLiveResponse,
  { limit, sportKey, timestamp }: { limit?: number; sportKey?: string; timestamp?: string | null } = {}
): HistoricalFootballFixtureInput[] {
  return normalizeTheOddsApiEvents(Array.isArray(response) ? response : [], { limit, sportKey, timestamp });
}

function appendSearchParam(url: URL, key: string, value: string | undefined): void {
  if (value) url.searchParams.set(key, value);
}

function providerError(response: Response, body: unknown): string {
  if (body && typeof body === "object" && "message" in body) return String((body as { message?: unknown }).message);
  return `Provider returned HTTP ${response.status}.`;
}

async function fetchJson(fetchImpl: FetchLike, url: URL, init?: RequestInit): Promise<{ data?: unknown; error?: string; status: number }> {
  const response = await fetchImpl(url, init);
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text().catch(() => "");
  if (!response.ok) return { data, error: providerError(response, data), status: response.status };
  return { data, status: response.status };
}

async function fetchApiFootballFixtureEvents({
  fixtureExternalId,
  apiKey,
  fetchImpl
}: {
  fixtureExternalId: string;
  apiKey: string;
  fetchImpl: FetchLike;
}): Promise<{ endpoint: string; fetched: number; events: HistoricalFootballEventInput[]; error?: string }> {
  const fixtureId = fixtureExternalId.replace("api-football:", "");
  const endpoint = new URL("https://v3.football.api-sports.io/fixtures/events");
  endpoint.searchParams.set("fixture", fixtureId);
  const { data, error } = await fetchJson(fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } });
  if (error) return { endpoint: endpoint.toString(), fetched: 0, events: [], error };
  const response = data as ApiFootballEventsResponse;
  const fetched = Array.isArray(response.response) ? response.response.length : 0;
  return {
    endpoint: endpoint.toString(),
    fetched,
    events: normalizeApiFootballEvents(response, { fixtureExternalId })
  };
}

async function fetchApiFootballFixtureLineups({
  fixture,
  apiKey,
  fetchImpl
}: {
  fixture: HistoricalFootballFixtureInput;
  apiKey: string;
  fetchImpl: FetchLike;
}): Promise<{ endpoint: string; fetched: number; lineups: HistoricalFootballLineupInput[]; error?: string }> {
  const fixtureId = fixture.externalId.replace("api-football:", "");
  const endpoint = new URL("https://v3.football.api-sports.io/fixtures/lineups");
  endpoint.searchParams.set("fixture", fixtureId);
  const { data, error } = await fetchJson(fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } });
  if (error) return { endpoint: endpoint.toString(), fetched: 0, lineups: [], error };
  const response = data as ApiFootballLineupsResponse;
  const fetched = Array.isArray(response.response) ? response.response.length : 0;
  return {
    endpoint: endpoint.toString(),
    fetched,
    lineups: normalizeApiFootballLineupsForFixture(response, fixture)
  };
}

async function fetchApiFootballFixturePlayerPerformances({
  fixture,
  apiKey,
  fetchImpl
}: {
  fixture: HistoricalFootballFixtureInput;
  apiKey: string;
  fetchImpl: FetchLike;
}): Promise<{ endpoint: string; fetched: number; performances: PlayerMatchPerformance[]; error?: string }> {
  const fixtureId = fixture.externalId.replace("api-football:", "");
  const endpoint = new URL("https://v3.football.api-sports.io/fixtures/players");
  endpoint.searchParams.set("fixture", fixtureId);
  const { data, error } = await fetchJson(fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } });
  if (error) return { endpoint: endpoint.toString(), fetched: 0, performances: [], error };
  const response = data as ApiFootballFixturePlayersResponse;
  const fetched = Array.isArray(response.response)
    ? response.response.reduce((sum, team) => sum + (team.players?.length ?? 0), 0)
    : 0;
  return {
    endpoint: endpoint.toString(),
    fetched,
    performances: normalizeApiFootballPlayerPerformancesForFixture(response, fixture)
  };
}

async function fetchApiFootballFixtureInjuries({
  fixture,
  apiKey,
  fetchImpl
}: {
  fixture: HistoricalFootballFixtureInput;
  apiKey: string;
  fetchImpl: FetchLike;
}): Promise<{ endpoint: string; fetched: number; availability: HistoricalFootballAvailabilityInput[]; error?: string }> {
  const fixtureId = fixture.externalId.replace("api-football:", "");
  const endpoint = new URL("https://v3.football.api-sports.io/injuries");
  endpoint.searchParams.set("fixture", fixtureId);
  const { data, error } = await fetchJson(fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } });
  if (error) return { endpoint: endpoint.toString(), fetched: 0, availability: [], error };
  const response = data as ApiFootballInjuriesResponse;
  const fetched = Array.isArray(response.response) ? response.response.length : 0;
  return {
    endpoint: endpoint.toString(),
    fetched,
    availability: normalizeApiFootballInjuriesForFixture(response, fixture)
  };
}

async function fetchApiFootballFixtureStandings({
  fixture,
  apiKey,
  fetchImpl,
  responseCache
}: {
  fixture: HistoricalFootballFixtureInput;
  apiKey: string;
  fetchImpl: FetchLike;
  responseCache?: Map<
    string,
    Promise<{ endpoint: string; fetched: number; response: ApiFootballStandingsResponse | null; error?: string }>
  >;
}): Promise<{ endpoint: string; fetched: number; standings: HistoricalFootballStandingInput[]; error?: string }> {
  const league = fixture.league.externalId.replace("api-football:", "");
  const cacheKey = `${league}:${fixture.season ?? ""}`;
  let pending = responseCache?.get(cacheKey);
  const ownsRequest = !pending;
  if (!pending) {
    pending = (async () => {
      const endpoint = new URL("https://v3.football.api-sports.io/standings");
      endpoint.searchParams.set("league", league);
      if (fixture.season) endpoint.searchParams.set("season", fixture.season);
      const { data, error } = await fetchJson(fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } });
      if (error) return { endpoint: endpoint.toString(), fetched: 0, response: null, error };
      const response = data as ApiFootballStandingsResponse;
      return {
        endpoint: endpoint.toString(),
        fetched: response.response?.[0]?.league?.standings?.flat().length ?? 0,
        response
      };
    })();
    responseCache?.set(cacheKey, pending);
  }

  const result = await pending;
  if (result.error || !result.response) {
    return { endpoint: result.endpoint, fetched: ownsRequest ? result.fetched : 0, standings: [], error: result.error ?? "Standings response was empty." };
  }
  return {
    endpoint: result.endpoint,
    fetched: ownsRequest ? result.fetched : 0,
    standings: normalizeApiFootballStandingsForFixture(result.response, fixture)
  };
}

async function fetchOpenWeatherFixtureWeather({
  fixture,
  apiKey,
  fetchImpl
}: {
  fixture: HistoricalFootballFixtureInput;
  apiKey: string;
  fetchImpl: FetchLike;
}): Promise<{ endpoint: string | null; fetched: number; weather: HistoricalFootballWeatherInput[]; error?: string }> {
  const metadata = fixture.metadata ?? {};
  const city = cleanText(metadata.venueCity) || cleanText(fixture.venue) || cleanText(fixture.country);
  if (!city) return { endpoint: null, fetched: 0, weather: [], error: "Fixture does not include a venue city for weather lookup." };

  const endpoint = new URL("https://api.openweathermap.org/data/2.5/forecast");
  endpoint.searchParams.set("q", city);
  endpoint.searchParams.set("appid", apiKey);
  endpoint.searchParams.set("units", "metric");
  const { data, error } = await fetchJson(fetchImpl, endpoint);
  if (error) return { endpoint: redactedUrl(endpoint, apiKey), fetched: 0, weather: [], error };
  const response = data as OpenWeatherForecastResponse;
  const fetched = Array.isArray(response.list) ? response.list.length : 0;
  return {
    endpoint: redactedUrl(endpoint, apiKey),
    fetched,
    weather: normalizeOpenWeatherForecastForFixture(response, fixture)
  };
}

async function fetchOpenMeteoFixtureWeather({
  fixture,
  fetchImpl
}: {
  fixture: HistoricalFootballFixtureInput;
  fetchImpl: FetchLike;
}): Promise<{ endpoint: string | null; fetched: number; weather: HistoricalFootballWeatherInput[]; error?: string }> {
  const metadata = fixture.metadata ?? {};
  const city = cleanText(metadata.venueCity) || cleanText(fixture.venue) || cleanText(fixture.country);
  if (!city) return { endpoint: null, fetched: 0, weather: [], error: "Fixture does not include a venue city for weather lookup." };
  const forecast = await fetchOpenMeteoForecast({ city, kickoffAt: fixture.kickoffAt, fetchImpl });
  if (!forecast) return { endpoint: null, fetched: 0, weather: [], error: "Open-Meteo did not return a forecast close enough to kickoff." };
  return {
    endpoint: forecast.endpoint,
    fetched: 1,
    weather: [
      {
        observedFor: forecast.observedFor,
        temperatureC: forecast.temperatureC,
        precipitationMm: forecast.precipitationMm,
        windKph: forecast.windKph,
        humidity: forecast.humidity,
        condition: forecast.condition,
        impactScore: forecast.impactScore,
        metadata: {
          forecastDistanceMinutes: forecast.forecastDistanceMinutes,
          precipitationProbability: forecast.precipitationProbability === null ? null : forecast.precipitationProbability / 100,
          weatherCode: forecast.weatherCode,
          location: forecast.location,
          source: "open-meteo-forecast"
        }
      }
    ]
  };
}

async function fetchNewsApiFixtureNews({
  fixture,
  apiKey,
  env,
  fetchImpl
}: {
  fixture: HistoricalFootballFixtureInput;
  apiKey: string;
  env: EnvMap;
  fetchImpl: FetchLike;
}): Promise<{ endpoint: string; fetched: number; news: HistoricalFootballNewsInput[]; error?: string }> {
  const endpoint = new URL("https://newsapi.org/v2/everything");
  endpoint.searchParams.set("q", `"${fixture.homeTeam.name}" OR "${fixture.awayTeam.name}" football`);
  endpoint.searchParams.set("searchIn", "title,description");
  endpoint.searchParams.set("language", env.NEWS_API_LANGUAGE?.trim() || "en");
  endpoint.searchParams.set("sortBy", "publishedAt");
  endpoint.searchParams.set("pageSize", env.NEWS_API_PAGE_SIZE?.trim() || "5");
  const from = new Date(fixture.kickoffAt);
  if (Number.isFinite(from.getTime())) {
    from.setUTCDate(from.getUTCDate() - 7);
    endpoint.searchParams.set("from", from.toISOString());
  }

  const { data, error } = await fetchJson(fetchImpl, endpoint, { headers: { "X-Api-Key": apiKey } });
  if (error) return { endpoint: endpoint.toString(), fetched: 0, news: [], error };
  const response = data as NewsApiResponse;
  const fetched = Array.isArray(response.articles) ? response.articles.length : 0;
  return {
    endpoint: endpoint.toString(),
    fetched,
    news: normalizeNewsApiArticlesForFixture(response, fixture)
  };
}

async function syncApiFootballFixtures({
  request,
  env,
  fetchImpl
}: {
  request: ProviderSyncRequest;
  env: EnvMap;
  fetchImpl: FetchLike;
}): Promise<ProviderSyncResult> {
  const apiKey = firstEnv(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
  const endpoint = new URL("https://v3.football.api-sports.io/fixtures");
  const team = request.team?.trim();
  appendSearchParam(endpoint, "league", request.league);
  if (team && /^\d+$/.test(team)) appendSearchParam(endpoint, "team", team);
  appendSearchParam(endpoint, "season", request.season);
  appendSearchParam(endpoint, "date", request.date);
  appendSearchParam(endpoint, "from", request.from);
  appendSearchParam(endpoint, "to", request.to);
  endpoint.searchParams.set("timezone", "UTC");

  if (team && !/^\d+$/.test(team)) {
    return {
      status: "invalid-response",
      configured: Boolean(apiKey),
      provider: "api-football",
      dryRun: request.dryRun ?? true,
      endpoint: endpoint.toString(),
      fetched: 0,
      normalized: 0,
      reason: "team must be a numeric API-Football team ID."
    };
  }

  if (!apiKey) {
    return {
      status: "not-configured",
      configured: false,
      provider: "api-football",
      dryRun: request.dryRun ?? true,
      endpoint: endpoint.toString(),
      fetched: 0,
      normalized: 0,
      reason: "Missing API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY."
    };
  }

  const { data, error } = await fetchJson(fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } });
  if (error) {
    return {
      status: "provider-error",
      configured: true,
      provider: "api-football",
      dryRun: request.dryRun ?? true,
      endpoint: endpoint.toString(),
      fetched: 0,
      normalized: 0,
      reason: error
    };
  }

  let normalized = normalizeApiFootballFixtures(data as ApiFootballResponse, { limit: request.limit });
  const includeStandings = Boolean(request.includeContext || request.includeStandings);
  const includeAvailability = Boolean(request.includeContext || request.includeAvailability);
  const includeLineups = Boolean(request.includeContext || request.includeLineups);
  const includePlayerStats = Boolean(request.includePlayerStats);
  const includeWeather = Boolean(request.includeContext || request.includeWeather);
  const contextFixtureLimit = boundedOptionalInteger(request.maxContextFixtures, request.dryRun === false ? 24 : 8, 1, 120);
  let eventFetched = 0;
  let eventNormalized = 0;
  const eventErrors: string[] = [];
  let newsFetched = 0;
  let newsNormalized = 0;
  const newsErrors: string[] = [];
  let standingsFetched = 0;
  let standingsNormalized = 0;
  const standingsErrors: string[] = [];
  let availabilityFetched = 0;
  let availabilityNormalized = 0;
  const availabilityErrors: string[] = [];
  let lineupsFetched = 0;
  let lineupsNormalized = 0;
  const lineupsErrors: string[] = [];
  let playerPerformancesFetched = 0;
  let playerPerformancesNormalized = 0;
  let playerPerformanceFixturesRequested = 0;
  let playerPerformanceFixturesCovered = 0;
  const playerPerformancesErrors: string[] = [];
  let playerPerformances: PlayerMatchPerformance[] = [];
  let weatherFetched = 0;
  let weatherNormalized = 0;
  const weatherErrors: string[] = [];

  if (request.includeEvents && normalized.length) {
    const eventFixtureLimit = boundedOptionalInteger(request.maxEventFixtures, request.dryRun === false ? 12 : 6, 1, 50);
    const eventFixtures = cappedFixtureSlice(normalized, eventFixtureLimit, "Event", eventErrors, "maxEventFixtures");
    const eventEntries = await Promise.all(
      eventFixtures.map(async (fixture) => {
        const result = await fetchApiFootballFixtureEvents({
          fixtureExternalId: fixture.externalId,
          apiKey,
          fetchImpl
        });
        eventFetched += result.fetched;
        eventNormalized += result.events.length;
        if (result.error) eventErrors.push(`${fixture.externalId}: ${result.error}`);
        return [fixture.externalId, { rows: result.events, error: result.error ?? null }] as const;
      })
    );
    const eventsByFixtureId = new Map(eventEntries);
    normalized = normalized.map((fixture) => {
      const fetchedEvents = eventsByFixtureId.get(fixture.externalId);
      return {
        ...fixture,
        events: fetchedEvents?.rows ?? [],
        metadata: fetchedEvents
          ? withProviderFetchEvidence(fixture, "events", {
              attempted: true,
              succeeded: fetchedEvents.error === null,
              rows: fetchedEvents.rows.length,
              error: fetchedEvents.error
            })
          : fixture.metadata
      };
    });
  }

  if (includeStandings && normalized.length) {
    const selectedFixtures = cappedFixtureSlice(normalized, contextFixtureLimit, "Standings", standingsErrors, "maxContextFixtures");
    const standingsResponseCache = new Map<
      string,
      Promise<{ endpoint: string; fetched: number; response: ApiFootballStandingsResponse | null; error?: string }>
    >();
    const standingsEntries = await Promise.all(
      selectedFixtures.map(async (fixture) => {
        const result = await fetchApiFootballFixtureStandings({
          fixture,
          apiKey,
          fetchImpl,
          responseCache: standingsResponseCache
        });
        standingsFetched += result.fetched;
        standingsNormalized += result.standings.length;
        if (result.error) standingsErrors.push(`${fixture.externalId}: ${result.error}`);
        return [fixture.externalId, result.standings] as const;
      })
    );
    const standingsByFixtureId = new Map(standingsEntries);
    normalized = normalized.map((fixture) => ({
      ...fixture,
      standings: standingsByFixtureId.get(fixture.externalId) ?? []
    }));
  }

  if (includeAvailability && normalized.length) {
    const selectedFixtures = cappedFixtureSlice(normalized, contextFixtureLimit, "Availability", availabilityErrors, "maxContextFixtures");
    const availabilityEntries = await Promise.all(
      selectedFixtures.map(async (fixture) => {
        const result = await fetchApiFootballFixtureInjuries({
          fixture,
          apiKey,
          fetchImpl
        });
        availabilityFetched += result.fetched;
        availabilityNormalized += result.availability.length;
        if (result.error) availabilityErrors.push(`${fixture.externalId}: ${result.error}`);
        return [fixture.externalId, { rows: result.availability, error: result.error ?? null }] as const;
      })
    );
    const availabilityByFixtureId = new Map(availabilityEntries);
    normalized = normalized.map((fixture) => {
      const fetchedAvailability = availabilityByFixtureId.get(fixture.externalId);
      return {
        ...fixture,
        availability: fetchedAvailability?.rows ?? [],
        metadata: fetchedAvailability
          ? withProviderFetchEvidence(fixture, "availability", {
              attempted: true,
              succeeded: fetchedAvailability.error === null,
              rows: fetchedAvailability.rows.length,
              error: fetchedAvailability.error
            })
          : fixture.metadata
      };
    });
  }

  if (includeLineups && normalized.length) {
    const selectedFixtures = cappedFixtureSlice(normalized, contextFixtureLimit, "Lineup", lineupsErrors, "maxContextFixtures");
    const lineupEntries = await Promise.all(
      selectedFixtures.map(async (fixture) => {
        const result = await fetchApiFootballFixtureLineups({
          fixture,
          apiKey,
          fetchImpl
        });
        lineupsFetched += result.fetched;
        lineupsNormalized += result.lineups.length;
        if (result.error) lineupsErrors.push(`${fixture.externalId}: ${result.error}`);
        return [fixture.externalId, result.lineups] as const;
      })
    );
    const lineupsByFixtureId = new Map(lineupEntries);
    normalized = normalized.map((fixture) => ({
      ...fixture,
      lineups: lineupsByFixtureId.get(fixture.externalId) ?? []
    }));
  }

  if (includePlayerStats && normalized.length) {
    const finishedFixtures = normalized.filter((fixture) => fixture.status === "finished");
    const selectedFixtures = cappedFixtureSlice(finishedFixtures, contextFixtureLimit, "Player statistics", playerPerformancesErrors, "maxContextFixtures");
    playerPerformanceFixturesRequested = selectedFixtures.length;
    const performanceEntries = await Promise.all(
      selectedFixtures.map(async (fixture) => {
        const result = await fetchApiFootballFixturePlayerPerformances({ fixture, apiKey, fetchImpl });
        playerPerformancesFetched += result.fetched;
        playerPerformancesNormalized += result.performances.length;
        if (result.error) playerPerformancesErrors.push(`${fixture.externalId}: ${result.error}`);
        const coverage = playerPerformanceCoverage(fixture, result.performances);
        if (!result.error && !coverage.complete) {
          playerPerformancesErrors.push(
            `${fixture.externalId}: player statistics covered ${coverage.homeRows} home and ${coverage.awayRows} away participant(s) with minutes; at least ${MINIMUM_PLAYER_ROWS_PER_TEAM} per team are required.`
          );
        }
        if (!coverage.complete) return [];
        playerPerformanceFixturesCovered += 1;
        return result.performances;
      })
    );
    playerPerformances = performanceEntries.flat();
  }

  const weatherApiKey = firstEnv(env, ["WEATHER_API_KEY", "OPENWEATHER_API_KEY"]);
  if (includeWeather && normalized.length) {
    const selectedFixtures = cappedFixtureSlice(normalized, contextFixtureLimit, "Weather", weatherErrors, "maxContextFixtures");
    const weatherEntries = await Promise.all(
      selectedFixtures.map(async (fixture) => {
        const result = weatherApiKey
          ? await fetchOpenWeatherFixtureWeather({ fixture, apiKey: weatherApiKey, fetchImpl })
          : await fetchOpenMeteoFixtureWeather({ fixture, fetchImpl });
        weatherFetched += result.fetched;
        weatherNormalized += result.weather.length;
        if (result.error) weatherErrors.push(`${fixture.externalId}: ${result.error}`);
        return [fixture.externalId, result.weather] as const;
      })
    );
    const weatherByFixtureId = new Map(weatherEntries);
    normalized = normalized.map((fixture) => ({
      ...fixture,
      weather: weatherByFixtureId.get(fixture.externalId) ?? []
    }));
  }

  const newsApiKey = firstEnv(env, ["NEWS_API_KEY"]);
  if (request.includeNews && normalized.length && newsApiKey) {
    const selectedFixtures = cappedFixtureSlice(normalized, contextFixtureLimit, "News", newsErrors, "maxContextFixtures");
    const newsEntries = await Promise.all(
      selectedFixtures.map(async (fixture) => {
        const result = await fetchNewsApiFixtureNews({
          fixture,
          apiKey: newsApiKey,
          env,
          fetchImpl
        });
        newsFetched += result.fetched;
        newsNormalized += result.news.length;
        if (result.error) newsErrors.push(`${fixture.externalId}: ${result.error}`);
        return [fixture.externalId, result.news] as const;
      })
    );
    const newsByFixtureId = new Map(newsEntries);
    normalized = normalized.map((fixture) => ({
      ...fixture,
      news: newsByFixtureId.get(fixture.externalId) ?? []
    }));
  } else if (request.includeNews && !newsApiKey) {
    newsErrors.push("Missing NEWS_API_KEY.");
  }

  const response = data as ApiFootballResponse;
  const fetched = Array.isArray(response.response) ? response.response.length : 0;
  const providerReason = providerErrorSummary(response.errors);
  const ingestion = await ingestHistoricalFootballFixtures({
    provider: "api_football",
    sourceKind: "real",
    dryRun: request.dryRun ?? true,
    fixtures: normalized,
    replaceChildDatasets: [
      ...(request.includeEvents ? ["events" as const] : []),
      ...(request.includeNews && newsApiKey ? ["news" as const] : []),
      ...(includeStandings ? ["standings" as const] : []),
      ...(includeAvailability ? ["availability" as const] : []),
      ...(includeLineups ? ["lineups" as const] : []),
      ...(includeWeather ? ["weather" as const] : [])
    ]
  });
  const ingestionAccepted = ingestion.status === "stored" || ingestion.status === "dry-run";
  const playerPerformanceStorage: PlayerPerformanceStoreResult = includePlayerStats && ingestionAccepted
    ? await storePlayerMatchPerformances(playerPerformances, { dryRun: request.dryRun ?? true })
    : { status: "dry-run", rowsReceived: 0, rowsWritten: 0, rowsVerified: 0, errors: [] };
  if (includePlayerStats && playerPerformanceStorage.errors.length) {
    playerPerformancesErrors.push(...playerPerformanceStorage.errors);
  }
  const emptyDryRun = Boolean((request.dryRun ?? true) && fetched === 0 && normalized.length === 0);
  const playerStorageFailed = includePlayerStats && (
    playerPerformanceStorage.status === "failed" ||
    ((request.dryRun ?? true) === false && playerPerformanceStorage.status === "not-configured")
  );
  const playerCoverageFailed = includePlayerStats && playerPerformanceFixturesRequested > playerPerformanceFixturesCovered;

  return {
    status: playerStorageFailed
      ? "failed"
      : playerCoverageFailed
        ? "invalid-response"
        : ingestion.status === "stored" || ingestion.status === "dry-run"
          ? ingestion.status
          : emptyDryRun
            ? "dry-run"
            : "failed",
    configured: true,
    provider: "api-football",
    dryRun: ingestion.dryRun,
    endpoint: endpoint.toString(),
    fetched,
    normalized: normalized.length,
    eventFetched: request.includeEvents ? eventFetched : undefined,
    eventNormalized: request.includeEvents ? eventNormalized : undefined,
    eventErrors: request.includeEvents && eventErrors.length ? eventErrors : undefined,
    newsFetched: request.includeNews ? newsFetched : undefined,
    newsNormalized: request.includeNews ? newsNormalized : undefined,
    newsErrors: request.includeNews && newsErrors.length ? newsErrors : undefined,
    standingsFetched: includeStandings ? standingsFetched : undefined,
    standingsNormalized: includeStandings ? standingsNormalized : undefined,
    standingsErrors: includeStandings && standingsErrors.length ? standingsErrors : undefined,
    availabilityFetched: includeAvailability ? availabilityFetched : undefined,
    availabilityNormalized: includeAvailability ? availabilityNormalized : undefined,
    availabilityErrors: includeAvailability && availabilityErrors.length ? availabilityErrors : undefined,
    lineupsFetched: includeLineups ? lineupsFetched : undefined,
    lineupsNormalized: includeLineups ? lineupsNormalized : undefined,
    lineupsErrors: includeLineups && lineupsErrors.length ? lineupsErrors : undefined,
    playerPerformancesFetched: includePlayerStats ? playerPerformancesFetched : undefined,
    playerPerformancesNormalized: includePlayerStats ? playerPerformancesNormalized : undefined,
    playerPerformanceFixturesRequested: includePlayerStats ? playerPerformanceFixturesRequested : undefined,
    playerPerformanceFixturesCovered: includePlayerStats ? playerPerformanceFixturesCovered : undefined,
    playerPerformancesStored: includePlayerStats ? playerPerformanceStorage.rowsWritten : undefined,
    playerPerformancesVerified: includePlayerStats ? playerPerformanceStorage.rowsVerified : undefined,
    playerPerformancesErrors: includePlayerStats && playerPerformancesErrors.length ? playerPerformancesErrors : undefined,
    weatherFetched: includeWeather ? weatherFetched : undefined,
    weatherNormalized: includeWeather ? weatherNormalized : undefined,
    weatherErrors: includeWeather && weatherErrors.length ? weatherErrors : undefined,
    ingestion,
    reason:
      providerReason ??
      ingestion.errors[0] ??
      eventErrors[0] ??
      standingsErrors[0] ??
      availabilityErrors[0] ??
      lineupsErrors[0] ??
      playerPerformancesErrors[0] ??
      weatherErrors[0] ??
      newsErrors[0]
  };
}

async function syncApiBasketballGames({
  request,
  env,
  fetchImpl
}: {
  request: ProviderSyncRequest;
  env: EnvMap;
  fetchImpl: FetchLike;
}): Promise<ProviderSyncResult> {
  const apiKey = firstEnv(env, ["API_BASKETBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
  const endpoint = new URL("https://v1.basketball.api-sports.io/games");
  appendSearchParam(endpoint, "league", request.league);
  appendSearchParam(endpoint, "season", request.season);
  appendSearchParam(endpoint, "date", request.date);

  if (!apiKey) {
    return {
      status: "not-configured",
      configured: false,
      provider: "api-basketball",
      dryRun: request.dryRun ?? true,
      endpoint: endpoint.toString(),
      fetched: 0,
      normalized: 0,
      reason: "Missing API_BASKETBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY."
    };
  }

  const { data, error } = await fetchJson(fetchImpl, endpoint, { headers: { "x-apisports-key": apiKey } });
  if (error) {
    return {
      status: "provider-error",
      configured: true,
      provider: "api-basketball",
      dryRun: request.dryRun ?? true,
      endpoint: endpoint.toString(),
      fetched: 0,
      normalized: 0,
      reason: error
    };
  }

  const normalized = normalizeApiBasketballGames(data as ApiBasketballResponse, { limit: request.limit });
  const ingestion = await ingestHistoricalFootballFixtures({
    provider: providerKeyForSport("basketball"),
    sport: "basketball",
    sourceKind: "real",
    dryRun: request.dryRun ?? true,
    fixtures: normalized,
    replaceChildDatasets: []
  });

  return {
    status: ingestion.status === "stored" || ingestion.status === "dry-run" ? ingestion.status : "failed",
    configured: true,
    provider: "api-basketball",
    dryRun: ingestion.dryRun,
    endpoint: endpoint.toString(),
    fetched: Array.isArray((data as ApiBasketballResponse).response) ? (data as ApiBasketballResponse).response!.length : 0,
    normalized: normalized.length,
    ingestion,
    reason: ingestion.errors[0]
  };
}

async function syncApiTennisEvents({
  request,
  env,
  fetchImpl
}: {
  request: ProviderSyncRequest;
  env: EnvMap;
  fetchImpl: FetchLike;
}): Promise<ProviderSyncResult> {
  const apiKey = firstEnv(env, ["API_TENNIS_KEY", "SPORTS_API_KEY"]);
  const endpoint = new URL("https://api.api-tennis.com/tennis/");
  endpoint.searchParams.set("method", "get_events");
  appendSearchParam(endpoint, "date_start", request.from || request.date);
  appendSearchParam(endpoint, "date_stop", request.to || request.date || request.from);
  appendSearchParam(endpoint, "tournament_key", request.league);
  if (apiKey) endpoint.searchParams.set("APIkey", apiKey);

  if (!apiKey) {
    return {
      status: "not-configured",
      configured: false,
      provider: "api-tennis",
      dryRun: request.dryRun ?? true,
      endpoint: redactedUrl(endpoint, apiKey),
      fetched: 0,
      normalized: 0,
      reason: "Missing API_TENNIS_KEY or SPORTS_API_KEY."
    };
  }

  if (!request.date && !request.from) {
    return {
      status: "invalid-response",
      configured: true,
      provider: "api-tennis",
      dryRun: request.dryRun ?? true,
      endpoint: redactedUrl(endpoint, apiKey),
      fetched: 0,
      normalized: 0,
      reason: "API-Tennis historical sync requires date=YYYY-MM-DD or from=YYYY-MM-DD."
    };
  }

  const { data, error } = await fetchJson(fetchImpl, endpoint);
  if (error) {
    return {
      status: "provider-error",
      configured: true,
      provider: "api-tennis",
      dryRun: request.dryRun ?? true,
      endpoint: redactedUrl(endpoint, apiKey),
      fetched: 0,
      normalized: 0,
      reason: error
    };
  }

  const normalized = normalizeApiTennisEvents(data as ApiTennisResponse, { limit: request.limit });
  const ingestion = await ingestHistoricalFootballFixtures({
    provider: providerKeyForSport("tennis"),
    sport: "tennis",
    sourceKind: "real",
    dryRun: request.dryRun ?? true,
    fixtures: normalized,
    replaceChildDatasets: []
  });

  const response = data as ApiTennisResponse;
  const fetched = Array.isArray(response.result) ? response.result.length : Array.isArray(response.response) ? response.response.length : 0;

  return {
    status: ingestion.status === "stored" || ingestion.status === "dry-run" ? ingestion.status : "failed",
    configured: true,
    provider: "api-tennis",
    dryRun: ingestion.dryRun,
    endpoint: redactedUrl(endpoint, apiKey),
    fetched,
    normalized: normalized.length,
    ingestion,
    reason: ingestion.errors[0] ?? response.error
  };
}

async function syncTheOddsApiHistoricalOdds({
  request,
  env,
  fetchImpl
}: {
  request: ProviderSyncRequest;
  env: EnvMap;
  fetchImpl: FetchLike;
}): Promise<ProviderSyncResult> {
  const apiKey = firstEnv(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]);
  const sportKey = request.sportKey || "soccer_epl";
  const sport = sportFromProvider("the-odds-api", sportKey);
  const endpoint = new URL(`https://api.the-odds-api.com/v4/historical/sports/${encodeURIComponent(sportKey)}/odds/`);
  endpoint.searchParams.set("markets", "h2h");
  endpoint.searchParams.set("oddsFormat", "decimal");
  endpoint.searchParams.set("dateFormat", "iso");
  endpoint.searchParams.set("regions", request.regions || "uk,eu");
  appendSearchParam(endpoint, "bookmakers", request.bookmakers);
  appendSearchParam(endpoint, "date", request.date);
  if (apiKey) endpoint.searchParams.set("apiKey", apiKey);

  if (!apiKey) {
    return {
      status: "not-configured",
      configured: false,
      provider: "the-odds-api",
      dryRun: request.dryRun ?? true,
      endpoint: redactedUrl(endpoint, apiKey),
      fetched: 0,
      normalized: 0,
      reason: "Missing THE_ODDS_API_KEY or ODDS_API_KEY."
    };
  }
  if (!request.date) {
    return {
      status: "invalid-response",
      configured: true,
      provider: "the-odds-api",
      dryRun: request.dryRun ?? true,
      endpoint: redactedUrl(endpoint, apiKey),
      fetched: 0,
      normalized: 0,
      reason: "The Odds API historical sync requires date=ISO_TIMESTAMP."
    };
  }

  const { data, error } = await fetchJson(fetchImpl, endpoint);
  if (error) {
    return {
      status: "provider-error",
      configured: true,
      provider: "the-odds-api",
      dryRun: request.dryRun ?? true,
      endpoint: redactedUrl(endpoint, apiKey),
      fetched: 0,
      normalized: 0,
      reason: error
    };
  }

  const normalized = normalizeTheOddsApiHistoricalOdds(data as OddsApiHistoricalResponse, { limit: request.limit, sportKey });
  const ingestion = await ingestHistoricalFootballFixtures({
    provider: "the_odds_api",
    sport,
    sourceKind: "real",
    dryRun: request.dryRun ?? true,
    fixtures: normalized,
    replaceChildDatasets: ["odds"]
  });

  return {
    status: ingestion.status === "stored" || ingestion.status === "dry-run" ? ingestion.status : "failed",
    configured: true,
    provider: "the-odds-api",
    dryRun: ingestion.dryRun,
    endpoint: redactedUrl(endpoint, apiKey),
    fetched: Array.isArray((data as OddsApiHistoricalResponse).data) ? (data as OddsApiHistoricalResponse).data!.length : 0,
    normalized: normalized.length,
    ingestion,
    reason: ingestion.errors[0]
  };
}

async function syncTheOddsApiLiveOdds({
  request,
  env,
  fetchImpl
}: {
  request: ProviderSyncRequest;
  env: EnvMap;
  fetchImpl: FetchLike;
}): Promise<ProviderSyncResult> {
  const apiKey = firstEnv(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]);
  const sportKey = request.sportKey || "soccer_epl";
  const sport = sportFromProvider("the-odds-api", sportKey);
  const endpoint = new URL(`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/odds/`);
  endpoint.searchParams.set("markets", "h2h");
  endpoint.searchParams.set("oddsFormat", "decimal");
  endpoint.searchParams.set("dateFormat", "iso");
  endpoint.searchParams.set("regions", request.regions || "uk,eu");
  appendSearchParam(endpoint, "bookmakers", request.bookmakers);
  if (apiKey) endpoint.searchParams.set("apiKey", apiKey);

  if (!apiKey) {
    return {
      status: "not-configured",
      configured: false,
      provider: "the-odds-api",
      dryRun: request.dryRun ?? true,
      endpoint: redactedUrl(endpoint, apiKey),
      fetched: 0,
      normalized: 0,
      reason: "Missing THE_ODDS_API_KEY or ODDS_API_KEY."
    };
  }

  const { data, error } = await fetchJson(fetchImpl, endpoint);
  if (error) {
    return {
      status: "provider-error",
      configured: true,
      provider: "the-odds-api",
      dryRun: request.dryRun ?? true,
      endpoint: redactedUrl(endpoint, apiKey),
      fetched: 0,
      normalized: 0,
      reason: error
    };
  }

  const events = Array.isArray(data) ? (data as OddsApiLiveResponse) : [];
  const normalized = normalizeTheOddsApiLiveOdds(events, { limit: request.limit, sportKey, timestamp: new Date().toISOString() });
  const ingestion = await ingestHistoricalFootballFixtures({
    provider: "the_odds_api",
    sport,
    sourceKind: "real",
    dryRun: request.dryRun ?? true,
    fixtures: normalized,
    replaceChildDatasets: ["odds"]
  });

  return {
    status: ingestion.status === "stored" || ingestion.status === "dry-run" ? ingestion.status : "failed",
    configured: true,
    provider: "the-odds-api",
    dryRun: ingestion.dryRun,
    endpoint: redactedUrl(endpoint, apiKey),
    fetched: events.length,
    normalized: normalized.length,
    ingestion,
    reason: ingestion.errors[0] ?? (events.length === 0 ? "The Odds API live endpoint returned no upcoming markets for this sport key." : undefined)
  };
}

export async function syncHistoricalFootballProvider({
  request,
  env = process.env,
  fetchImpl = fetch
}: {
  request: ProviderSyncRequest;
  env?: EnvMap;
  fetchImpl?: FetchLike;
}): Promise<ProviderSyncResult> {
  if (request.provider === "api-football") return syncApiFootballFixtures({ request, env, fetchImpl });
  if (request.provider === "api-basketball") return syncApiBasketballGames({ request, env, fetchImpl });
  if (request.provider === "api-tennis") return syncApiTennisEvents({ request, env, fetchImpl });
  if (request.provider === "the-odds-api") {
    return request.date ? syncTheOddsApiHistoricalOdds({ request, env, fetchImpl }) : syncTheOddsApiLiveOdds({ request, env, fetchImpl });
  }

  return {
    status: "failed",
    configured: false,
    provider: request.provider,
    dryRun: request.dryRun ?? true,
    endpoint: null,
    fetched: 0,
    normalized: 0,
    reason: "Unsupported provider."
  };
}
